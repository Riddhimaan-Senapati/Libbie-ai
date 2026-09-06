"""Live email connector -- Gmail (OAuth) and any IMAP mailbox (app password).

This ingests a user's OWN mail into ``Message`` + ``Person`` nodes, matching the
shapes the offline ``.eml`` reader in :mod:`libbie_engine.ingest.conversation`
emits. Both paths reconstruct threads by ROOT: a reply chain (A <- B <- C)
clusters into ONE thread by resolving every message's ``thread_id`` to the root
message id, using the shared pure helpers in ``ingest.conversation``.

Two paths (support BOTH):

* **Gmail** -- ``google-auth-oauthlib``'s ``InstalledAppFlow.run_local_server``
  handles the loopback OAuth (browser + PKCE) with scope
  ``gmail.readonly``. We then ``users().messages().list(q=, labelIds=)`` for ids
  and ``.get(format="full")`` for each. client id/secret come from
  ``$LIBBIE_GMAIL_CLIENT_ID`` / ``$LIBBIE_GMAIL_CLIENT_SECRET`` (Google "installed
  app" secrets are not truly secret). All deps are Apache-2.0.
* **IMAP** -- stdlib ``imaplib`` + ``email`` ONLY (no third-party dep):
  ``IMAP4_SSL(host, port)`` -> ``login(user, app_password)`` -> ``select`` ->
  ``search`` -> ``fetch(RFC822)`` -> ``email.message_from_bytes``.

The Google libraries are imported lazily inside the Gmail function so importing
this module (and running the IMAP path or the tests) never requires them.
"""

from __future__ import annotations

import os
from datetime import datetime
from email import message_from_bytes, policy
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from typing import Any, Optional

from .ingest.base import person_node
from .ingest.conversation import (
    eml_body_text,
    first_address,
    immediate_parent,
    normalize_message_id,
    resolve_thread_roots,
)
from .models import Message, Node, Provenance, make_id

# Gmail read-only scope.
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Mailbox bound when no explicit limit is given (matches MAX_COMMITS in the git
# ingester), and the number of messages fetched per IMAP round trip.
MAX_MESSAGES = 500
_FETCH_CHUNK = 100
_GMAIL_BATCH = 50


class EmailConnectorError(Exception):
    """Any live-email connector failure (auth, IMAP, or API)."""


# --------------------------------------------------------------------------- #
# Parsed-message record (source-agnostic) + thread-root assembly
# --------------------------------------------------------------------------- #
class _ParsedEmail:
    """A source-agnostic parsed email: enough to build nodes + resolve threads."""

    __slots__ = ("own_id", "parent_id", "ts", "from_name", "from_email", "text", "provenance")

    def __init__(
        self,
        own_id: str,
        parent_id: Optional[str],
        ts: Optional[datetime],
        from_name: Optional[str],
        from_email: Optional[str],
        text: str,
        provenance: Provenance,
    ) -> None:
        self.own_id = own_id
        self.parent_id = parent_id
        self.ts = ts
        self.from_name = from_name
        self.from_email = from_email
        self.text = text
        self.provenance = provenance


def _parse_date(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(str(raw))
    except (TypeError, ValueError):
        return None


def _parsed_from_email_message(
    message: EmailMessage, *, source: str, path: str, blob_hash: Optional[str] = None
) -> _ParsedEmail:
    """Build a :class:`_ParsedEmail` from a parsed ``email`` message object."""
    from_name, from_email = first_address(message.get("From"))
    subject = message.get("Subject") or ""
    body = eml_body_text(message)
    text = f"{subject}\n{body}" if subject else body

    own_id = normalize_message_id(message.get("Message-ID")) or f"path:{path}"
    parent_id = immediate_parent(message.get("In-Reply-To"), message.get("References"))
    return _ParsedEmail(
        own_id=own_id,
        parent_id=parent_id,
        ts=_parse_date(message.get("Date")),
        from_name=from_name,
        from_email=from_email,
        text=text,
        provenance=Provenance(
            source=source, path=path, hash=blob_hash, actor=from_email or from_name
        ),
    )


def _nodes_from_parsed(parsed: list[_ParsedEmail], *, source: str) -> list[Node]:
    """Turn parsed emails into ``Message`` + ``Person`` nodes with roots resolved.

    Runs the shared thread-root post-pass so an A<-B<-C reply chain collapses to a
    single ``thread_id`` (the root message id)."""
    roots = resolve_thread_roots({p.own_id: p.parent_id for p in parsed})
    nodes: list[Node] = []
    for p in parsed:
        mid = make_id("message", source, p.own_id)
        # Namespace the thread id by source so mail from one connector/account can
        # never merge into another's thread (or a Slack thread) via a forged
        # In-Reply-To/References header. Within one mailbox we still trust standard
        # threading headers, as every mail client does.
        root = roots.get(p.own_id, p.own_id)
        thread_id = make_id("thread", source, root)
        nodes.append(
            Message(
                id=mid,
                ts=p.ts,
                author=p.from_email or p.from_name,
                channel=None,  # email has no channel concept
                thread_id=thread_id,
                text=p.text,
                provenance=p.provenance,
            )
        )
        if p.from_email or p.from_name:
            nodes.append(
                person_node(
                    source=source,
                    email=p.from_email,
                    name=p.from_name,
                    path=p.provenance.path,
                )
            )
    return nodes


# --------------------------------------------------------------------------- #
# IMAP (stdlib only)
# --------------------------------------------------------------------------- #
def ingest_imap(
    host: str,
    user: str,
    app_password: str,
    *,
    port: int = 993,
    mailbox: str = "INBOX",
    search: str = "ALL",
    limit: Optional[int] = None,
) -> list[Node]:
    """Ingest an IMAP mailbox into ``Message`` + ``Person`` nodes.

    Connects over TLS, logs in with an APP PASSWORD (never the account password),
    fetches messages matching ``search`` (an IMAP search key, default ``ALL``),
    and reconstructs threads by root. ``limit`` keeps only the most recent N
    (default: :data:`MAX_MESSAGES`).
    """
    import imaplib
    import ssl

    # imaplib's DEFAULT SSL context does NOT verify the certificate or hostname
    # (stdlib footgun). Pass an explicit verifying context so a MITM can't harvest
    # the app password / mailbox over hostile networks.
    ssl_context = ssl.create_default_context()
    try:
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl_context)
    except Exception as exc:
        raise EmailConnectorError(f"could not connect to {host}:{port}: {exc}") from exc

    try:
        try:
            conn.login(user, app_password)
        except imaplib.IMAP4.error as exc:
            raise EmailConnectorError(f"IMAP login failed for {user}: {exc}") from exc

        conn.select(mailbox, readonly=True)
        typ, data = conn.search(None, search)
        if typ != "OK" or not data or not data[0]:
            return []
        ids = data[0].split()
        if limit is None:
            limit = MAX_MESSAGES
        if limit >= 0:
            ids = ids[-limit:] if limit else []

        # One ranged FETCH per chunk instead of one round trip per message.
        parsed: list[_ParsedEmail] = []
        for start in range(0, len(ids), _FETCH_CHUNK):
            chunk = ids[start : start + _FETCH_CHUNK]
            typ, msg_data = conn.fetch(b",".join(chunk), "(RFC822.PEEK)")
            if typ != "OK" or not msg_data:
                continue
            for part in msg_data:
                if not (isinstance(part, tuple) and part[1]):
                    continue
                # part[0] looks like b"12 (RFC822.PEEK {4321}"; the leading
                # integer is the message's sequence number.
                seq = part[0].split(b" ", 1)[0]
                uid = seq.decode() if isinstance(seq, bytes) else str(seq)
                try:
                    message = message_from_bytes(part[1], policy=policy.default)
                except Exception:  # pragma: no cover - unparseable message
                    continue
                parsed.append(
                    _parsed_from_email_message(
                        message, source="imap", path=f"imap://{host}/{mailbox}/{uid}"
                    )
                )
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    return _nodes_from_parsed(parsed, source="imap")


# --------------------------------------------------------------------------- #
# Gmail (OAuth loopback, installed app)
# --------------------------------------------------------------------------- #
def get_gmail_client_id() -> Optional[str]:
    cid = os.environ.get("LIBBIE_GMAIL_CLIENT_ID")
    return cid.strip() if cid else None


def get_gmail_client_secret() -> Optional[str]:
    sec = os.environ.get("LIBBIE_GMAIL_CLIENT_SECRET")
    return sec.strip() if sec else None


def _gmail_client_config(client_id: str, client_secret: str) -> dict[str, Any]:
    """The InstalledAppFlow client-config dict (installed-app / loopback shape)."""
    return {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }


def gmail_login(
    client_id: str, client_secret: str, *, port: int = 0
):  # pragma: no cover - opens a browser + binds a socket (not unit-tested)
    """Run the Gmail installed-app OAuth loopback and return live credentials.

    ``run_local_server(port=0)`` picks a free port, opens the browser, and handles
    the redirect + token exchange. Requires the ``connectors`` extra.
    """
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except Exception as exc:
        raise EmailConnectorError(
            "Gmail needs the 'connectors' extra: pip install 'libbie-engine[connectors]'"
        ) from exc

    flow = InstalledAppFlow.from_client_config(
        _gmail_client_config(client_id, client_secret), scopes=GMAIL_SCOPES
    )
    return flow.run_local_server(port=port)


def _gmail_headers(payload: dict[str, Any]) -> dict[str, str]:
    """Lowercased ``header-name -> value`` from a Gmail message payload."""
    out: dict[str, str] = {}
    for h in payload.get("headers", []) or []:
        name = str(h.get("name", "")).lower()
        if name and name not in out:
            out[name] = str(h.get("value", ""))
    return out


def _gmail_body_text(payload: dict[str, Any]) -> str:
    """Extract a plain-text body from a Gmail ``format=full`` payload, defensively."""
    import base64

    def _decode(data: str) -> str:
        try:
            return base64.urlsafe_b64decode(data.encode("ascii")).decode(
                "utf-8", errors="replace"
            )
        except Exception:
            return ""

    def _walk(part: dict[str, Any]) -> Optional[str]:
        mime = part.get("mimeType", "")
        body = part.get("body") or {}
        if mime == "text/plain" and body.get("data"):
            return _decode(body["data"])
        for sub in part.get("parts", []) or []:
            found = _walk(sub)
            if found is not None:
                return found
        # Fall back to any body data on a non-multipart leaf.
        if not part.get("parts") and body.get("data"):
            return _decode(body["data"])
        return None

    return _walk(payload) or ""


def _parsed_from_gmail(msg: dict[str, Any]) -> _ParsedEmail:
    """Build a :class:`_ParsedEmail` from a Gmail ``format=full`` message dict."""
    payload = msg.get("payload") or {}
    hdrs = _gmail_headers(payload)
    from_name, from_email = first_address(hdrs.get("from"))
    subject = hdrs.get("subject", "")
    body = _gmail_body_text(payload)
    text = f"{subject}\n{body}" if subject else body

    own_id = normalize_message_id(hdrs.get("message-id")) or f"gmail:{msg.get('id')}"
    parent_id = immediate_parent(hdrs.get("in-reply-to"), hdrs.get("references"))
    return _ParsedEmail(
        own_id=own_id,
        parent_id=parent_id,
        ts=_parse_date(hdrs.get("date")),
        from_name=from_name,
        from_email=from_email,
        text=text,
        provenance=Provenance(
            source="gmail",
            path=f"gmail://{msg.get('id')}",
            actor=from_email or from_name,
        ),
    )


def ingest_gmail(
    credentials: Any,
    *,
    query: Optional[str] = None,
    label_ids: Optional[list[str]] = None,
    max_results: int = 500,
) -> list[Node]:
    """Ingest Gmail messages into ``Message`` + ``Person`` nodes.

    ``credentials`` is a live ``google.oauth2.credentials.Credentials`` (from
    :func:`gmail_login`). ``query`` is a Gmail search string (e.g.
    ``"from:pi@lab.edu newer_than:1y"``); ``label_ids`` restricts to labels
    (e.g. ``["INBOX"]``). Threads are reconstructed by root.
    """
    try:
        from googleapiclient.discovery import build
    except Exception as exc:
        raise EmailConnectorError(
            "Gmail needs the 'connectors' extra: pip install 'libbie-engine[connectors]'"
        ) from exc

    service = build("gmail", "v1", credentials=credentials, cache_discovery=False)
    msgs_api = service.users().messages()

    # 1) List ids (paginated).
    ids: list[str] = []
    req = msgs_api.list(
        userId="me", q=query, labelIds=label_ids, maxResults=min(max_results, 500)
    )
    while req is not None and len(ids) < max_results:
        resp = req.execute()
        ids.extend(m["id"] for m in resp.get("messages", []) if m.get("id"))
        req = msgs_api.list_next(req, resp)
    ids = ids[:max_results]

    # 2) Fetch full messages in batches (a per-message request made indexing a
    # 500-message mailbox 500 sequential round trips) and parse.
    fetched: dict[str, dict[str, Any]] = {}

    def _on_batch_response(request_id: str, response: Any, exc: Any) -> None:
        if exc is None and response:
            fetched[str(response.get("id"))] = response

    for start in range(0, len(ids), _GMAIL_BATCH):
        batch = service.new_batch_http_request()
        for mid in ids[start : start + _GMAIL_BATCH]:
            batch.add(
                msgs_api.get(userId="me", id=mid, format="full"),
                callback=_on_batch_response,
            )
        batch.execute()

    parsed = [_parsed_from_gmail(fetched[mid]) for mid in ids if mid in fetched]
    return _nodes_from_parsed(parsed, source="gmail")
