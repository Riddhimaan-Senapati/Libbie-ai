"""Conversation ingester -- Slack exports and ``.eml`` email files.

This parser turns human conversation artifacts into typed ``Message`` and
``Person`` nodes. Conversations are where design *rationale* lives ("we use
GRCh37 on purpose, do not upgrade"), so preserving them verbatim -- with author,
timestamp and thread -- lets the join layer later derive ``Decision`` nodes and
wire them to the params/steps they justify.

We deliberately emit **only** ``Message`` and ``Person`` nodes here. ``Decision``
nodes are *not* created by ingest: they are inferred downstream by the join
layer, which has the cross-artifact context to know which message actually
constitutes a decision. Ingest's job is to be a faithful, lossless, permissive
reader.

Two artifact shapes are handled:

* **Slack export** -- a ``slack/`` subdirectory containing ``users.json`` (a map
  of ``user_id -> {real_name, profile: {email, display_name}}``) and one
  subdirectory per channel holding per-day JSON files. Each per-day file is a
  JSON *array* of message objects.
* **``.eml`` files** -- any ``*.eml`` anywhere under ``conv_dir``, parsed with the
  stdlib :mod:`email` package using the modern default policy.

Everything is defensive: missing fields, extra fields, malformed timestamps and
unreadable files are tolerated so one bad artifact never sinks the whole ingest.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping, Optional

from ..models import Message, Node, Provenance, make_id
from .base import person_node

if TYPE_CHECKING:  # avoid a hard runtime dependency on the store module
    from ..store import ArtifactStore


# --------------------------------------------------------------------------- #
# Small, defensive helpers
# --------------------------------------------------------------------------- #
def _ts_from_slack(ts: Any) -> Optional[datetime]:
    """Convert a Slack ``ts`` (unix float seconds, e.g. ``"1676280000.000200"``)
    to a timezone-aware UTC ``datetime``. Returns ``None`` if unparseable."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc)
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _put(
    store: "Optional[ArtifactStore]",
    data: bytes | str,
    *,
    source: str,
    path: Optional[str],
    actor: Optional[str] = None,
) -> Optional[str]:
    """Persist a raw blob if a store is supplied; return the artifact sha (for
    ``Provenance.hash``) or ``None``. Never raises -- persistence is best-effort."""
    if store is None:
        return None
    try:
        aid = store.put(data, source=source, path=path, actor=actor)
        # ``put`` returns "artifact:<sha256[:16]>"; strip the prefix for the hash.
        return aid.split(":", 1)[1] if ":" in aid else aid
    except Exception:  # pragma: no cover - store failures must not break ingest
        return None


# --------------------------------------------------------------------------- #
# Slack export
# --------------------------------------------------------------------------- #
def _load_slack_users(users_path: Path) -> dict[str, dict[str, Any]]:
    """Read ``users.json`` into a ``user_id -> user record`` map. Tolerates a
    missing/malformed file by returning an empty map."""
    try:
        raw = json.loads(users_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if isinstance(raw, dict):
        # Standard shape for this export: {user_id: {...}}.
        return {str(k): v for k, v in raw.items() if isinstance(v, dict)}
    if isinstance(raw, list):
        # Slack's own official export uses a list of user records with "id".
        out: dict[str, dict[str, Any]] = {}
        for rec in raw:
            if isinstance(rec, dict) and rec.get("id"):
                out[str(rec["id"])] = rec
        return out
    return {}


def slack_user_email(user_rec: dict[str, Any]) -> Optional[str]:
    """Extract an email from a Slack user record, tolerant of a missing profile.

    Shared with the live Slack connector in ``libbie_engine.slack``."""
    profile = user_rec.get("profile") or {}
    if isinstance(profile, dict):
        email = profile.get("email")
        if email:
            return str(email)
    return None


def _ingest_slack(
    slack_dir: Path,
    store: "Optional[ArtifactStore]",
) -> list[Node]:
    """Parse a Slack export directory into ``Person`` + ``Message`` nodes."""
    nodes: list[Node] = []

    # 1) People come from users.json ---------------------------------------- #
    users_path = slack_dir / "users.json"
    users = _load_slack_users(users_path)
    for user_id, rec in users.items():
        email = slack_user_email(rec)
        real_name = rec.get("real_name") or rec.get("name")
        profile = rec.get("profile") or {}
        display_name = (
            profile.get("display_name") if isinstance(profile, dict) else None
        )
        nodes.append(
            person_node(
                source="slack",
                email=email,
                name=real_name,
                handle=display_name,
                path=str(users_path),
            )
        )

    # 2) Messages come from per-channel, per-day JSON arrays ----------------- #
    for channel_dir in sorted(p for p in slack_dir.iterdir() if p.is_dir()):
        channel = channel_dir.name
        for day_file in sorted(channel_dir.glob("*.json")):
            try:
                payload = json.loads(day_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue  # skip unreadable/invalid day files
            if not isinstance(payload, list):
                continue  # per-day files are arrays of message objects

            # Persist the raw day file once (best effort) for provenance.hash.
            blob_hash = _put(
                store,
                day_file.read_bytes() if day_file.exists() else b"",
                source="slack",
                path=str(day_file),
            )

            for msg in payload:
                if not isinstance(msg, dict):
                    continue
                if msg.get("type", "message") != "message":
                    continue  # ignore channel_join / bot / other subtypes

                user_id = msg.get("user")
                user_rec = users.get(str(user_id)) if user_id is not None else None
                # Resolve author to an email when we can; otherwise the user id.
                author = None
                if user_rec:
                    author = slack_user_email(user_rec) or user_id
                else:
                    author = user_id

                ts_raw = msg.get("ts")
                ts = _ts_from_slack(ts_raw)
                text = msg.get("text") or ""
                thread_ts = msg.get("thread_ts")

                # Deterministic id: channel + Slack ts uniquely identify a message.
                mid = make_id("message", "slack", channel, str(ts_raw))
                nodes.append(
                    Message(
                        id=mid,
                        ts=ts,
                        author=str(author) if author is not None else None,
                        channel=channel,
                        thread_id=str(thread_ts) if thread_ts else None,
                        text=str(text),
                        provenance=Provenance(
                            source="slack",
                            path=str(day_file),
                            hash=blob_hash,
                            actor=str(author) if author is not None else None,
                        ),
                    )
                )

    return nodes


# --------------------------------------------------------------------------- #
# Email thread-root reconstruction (pure; shared with the live email connector)
# --------------------------------------------------------------------------- #
# An email carries three threading headers: its own ``Message-ID``, the
# ``In-Reply-To`` of the message it answers, and a ``References`` list of every
# ancestor (oldest first). To make a whole reply chain cluster into ONE thread we
# must group by the *root* message id, not by each message's own id. These helpers
# are pure (no I/O) so they are trivially unit-testable and reusable by the live
# Gmail/IMAP connector in ``libbie_engine.email_ingest``.
_MSGID_RE = re.compile(r"<[^<>@\s]+@[^<>@\s]+>|<[^<>\s]+>")


def normalize_message_id(raw: Optional[str]) -> Optional[str]:
    """Return the first ``<...>`` token from a header value, else the stripped
    text, else ``None``. Message-ID / In-Reply-To / References all use the same
    ``<local@host>`` token, so normalizing identically lets them match."""
    if not raw:
        return None
    m = _MSGID_RE.search(str(raw))
    if m:
        return m.group(0)
    text = str(raw).strip()
    return text or None


def parse_references(raw: Optional[str]) -> list[str]:
    """Extract every ``<...>`` id from a ``References`` header, in order."""
    if not raw:
        return []
    return _MSGID_RE.findall(str(raw))


def immediate_parent(
    in_reply_to: Optional[str], references: Optional[str]
) -> Optional[str]:
    """The id of the message this one directly answers: ``In-Reply-To`` when
    present, else the LAST (most recent) id in ``References``, else ``None``."""
    parent = normalize_message_id(in_reply_to)
    if parent:
        return parent
    refs = parse_references(references)
    return refs[-1] if refs else None


def resolve_thread_roots(parents: Mapping[str, Optional[str]]) -> dict[str, str]:
    """Map every message id to its thread ROOT id.

    ``parents`` maps a message id to the id of the message it directly answers
    (or ``None`` for a thread starter). We follow parent pointers transitively:
    a parent that is not itself a key (an ancestor outside this batch) becomes the
    root, so a reply whose ancestors we never saw still clusters under a stable
    id. Cycle-safe: a malformed self/loop reference stops at the first repeat.
    """
    roots: dict[str, str] = {}
    for mid in parents:
        seen: set[str] = set()
        cur = mid
        while True:
            if cur in seen:  # defensive: broken cycle -> treat current as root
                root = cur
                break
            seen.add(cur)
            par = parents.get(cur)
            if not par:  # thread starter
                root = cur
                break
            if par not in parents:  # ancestor outside the batch is the root
                root = par
                break
            cur = par
        roots[mid] = root
    return roots


# --------------------------------------------------------------------------- #
# .eml email files
# --------------------------------------------------------------------------- #
def first_address(header_value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Return ``(display_name, email)`` for the first address in a header, or
    ``(None, None)`` when the header is absent/empty. Shared with the live
    email connector in ``libbie_engine.email_ingest``."""
    if not header_value:
        return None, None
    parsed = getaddresses([str(header_value)])
    for name, email in parsed:
        if email:
            return (name or None), email
    # No parseable email but there was some text -- keep the raw name.
    if parsed:
        name = parsed[0][0]
        return (name or None), None
    return None, None


def eml_body_text(message: Any) -> str:
    """Extract the plain-text body from a parsed email message, defensively.
    Shared with the live email connector in ``libbie_engine.email_ingest``."""
    try:
        if message.is_multipart():
            # Prefer the first text/plain part.
            for part in message.walk():
                if part.get_content_type() == "text/plain":
                    return part.get_content()
            # Fall back to the policy's best-effort body.
            body = message.get_body(preferencelist=("plain", "html"))
            if body is not None:
                return body.get_content()
            return ""
        return message.get_content()
    except Exception:  # pragma: no cover - malformed MIME must not break ingest
        # Last resort: raw payload as a string.
        try:
            payload = message.get_payload(decode=True)
            if isinstance(payload, bytes):
                return payload.decode("utf-8", errors="replace")
            return str(payload or "")
        except Exception:
            return ""


def _ingest_eml_file(
    eml_path: Path, store: "Optional[ArtifactStore]"
) -> tuple[list[Node], Optional[Message], str, Optional[str]]:
    """Parse a single ``.eml`` file.

    Returns ``(nodes, message_node, own_id, parent_id)`` where ``nodes`` holds the
    ``Message`` (and a ``Person`` for the From header) and ``own_id`` / ``parent_id``
    are this message's threading identity, used by the caller's thread-root
    post-pass to set ``thread_id`` to the resolved root. Returns
    ``([], None, "", None)`` if the file cannot be read/parsed.

    ``thread_id`` is set to this message's OWN id here as a safe default; the
    caller overwrites it with the resolved root once the whole batch is known.
    """
    try:
        raw_bytes = eml_path.read_bytes()
    except OSError:
        return [], None, "", None

    try:
        message = BytesParser(policy=policy.default).parsebytes(raw_bytes)
    except Exception:  # pragma: no cover - unparseable file
        return [], None, "", None

    nodes: list[Node] = []

    from_name, from_email = first_address(message.get("From"))
    subject = message.get("Subject") or ""

    # Date -> datetime (tolerant of malformed/missing Date headers).
    ts: Optional[datetime] = None
    date_hdr = message.get("Date")
    if date_hdr:
        try:
            ts = parsedate_to_datetime(str(date_hdr))
        except (TypeError, ValueError):
            ts = None

    # Threading identity. ``own_id`` is the message's own Message-ID (or, absent
    # one, a path-derived synthetic so it still de-duplicates and participates in
    # root resolution). ``parent_id`` is the message it answers (In-Reply-To else
    # last References). If there are NO threading headers at all we leave the
    # thread ungrouped (thread_id stays None -- single-file behavior).
    own_id = normalize_message_id(message.get("Message-ID"))
    parent_id = immediate_parent(message.get("In-Reply-To"), message.get("References"))
    has_headers = bool(own_id or parent_id or message.get("References"))
    key = own_id or f"path:{eml_path}"

    body = eml_body_text(message)
    text = f"{subject}\n{body}" if subject else body

    blob_hash = _put(
        store,
        raw_bytes,
        source="eml",
        path=str(eml_path),
        actor=from_email or from_name,
    )

    # Message id: Message-ID is globally unique; else fall back to path.
    mid = make_id("message", "eml", own_id or str(eml_path))
    msg_node = Message(
        id=mid,
        ts=ts,
        author=from_email or from_name,
        channel=None,  # email has no channel concept
        thread_id=key if has_headers else None,
        text=text,
        provenance=Provenance(
            source="eml",
            path=str(eml_path),
            hash=blob_hash,
            actor=from_email or from_name,
        ),
    )
    nodes.append(msg_node)

    # Person from the From header (skip if we learned nothing about them).
    if from_email or from_name:
        nodes.append(
            person_node(
                source="eml",
                email=from_email,
                name=from_name,
                path=str(eml_path),
            )
        )

    return nodes, (msg_node if has_headers else None), key, parent_id


# --------------------------------------------------------------------------- #
# Public entrypoint
# --------------------------------------------------------------------------- #
def ingest_conversations(
    conv_dir: str | Path,
    store: "Optional[ArtifactStore]" = None,
) -> list[Node]:
    """Ingest a conversations directory into ``Message`` + ``Person`` nodes.

    Parameters
    ----------
    conv_dir:
        Directory holding conversation exports. May contain a ``slack/``
        subdirectory (Slack export) and/or any number of ``*.eml`` files
        (searched recursively).
    store:
        Optional :class:`~libbie_engine.store.ArtifactStore`. When provided, raw
        artifacts are persisted and their sha is recorded in ``Provenance.hash``.

    Returns
    -------
    list[Node]
        Only ``Message`` and ``Person`` nodes -- never edges, never ``Decision``
        nodes (those are derived later by the join layer).
    """
    conv_path = Path(conv_dir)
    nodes: list[Node] = []

    if not conv_path.exists():
        return nodes

    # 1) Slack export (if a slack/ subdir is present) ----------------------- #
    slack_dir = conv_path / "slack"
    if slack_dir.is_dir():
        nodes.extend(_ingest_slack(slack_dir, store))

    # 2) Every .eml under conv_dir (recursively) ---------------------------- #
    #    Parse each file, then run a thread-root post-pass: a reply chain must
    #    cluster into ONE thread, so ``thread_id`` is set to the resolved ROOT
    #    message id (not each message's own Message-ID).
    eml_msgs: list[tuple[Message, str]] = []  # (node, own key)
    parents: dict[str, Optional[str]] = {}
    for eml_path in sorted(conv_path.rglob("*.eml")):
        if not eml_path.is_file():
            continue
        file_nodes, msg_node, key, parent_id = _ingest_eml_file(eml_path, store)
        nodes.extend(file_nodes)
        if msg_node is not None:  # had threading headers -> participates in roots
            eml_msgs.append((msg_node, key))
            parents[key] = parent_id

    if parents:
        roots = resolve_thread_roots(parents)
        for msg_node, key in eml_msgs:
            msg_node.thread_id = roots.get(key, key)

    return nodes
