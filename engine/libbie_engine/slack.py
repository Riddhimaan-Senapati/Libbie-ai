"""Slack connector -- connect a user's OWN account and ingest channel history.

Two authentication paths are supported, mirroring the permissive, no-magic stance
of :mod:`libbie_engine.github`:

* **Token paste (primary, no secret in the binary).** The user pastes their own
  ``xoxp-`` user token (or a ``xoxb-`` bot token) which we validate with
  ``auth.test``. Nothing else is needed -- no OAuth app, no client secret.
* **OAuth v2 loopback (optional).** We open the browser to Slack's authorize
  endpoint and catch the ``?code`` redirect on a *fixed* localhost port, then
  exchange it at ``oauth.v2.access``. The user token is
  ``authed_user.access_token`` (NOT the top-level ``access_token``, which is the
  bot token). client id/secret come from ``$LIBBIE_SLACK_CLIENT_ID`` /
  ``$LIBBIE_SLACK_CLIENT_SECRET``.

  GOTCHA (fixed port): Slack does **not** allow arbitrary/random loopback ports --
  the ``redirect_uri`` must exactly match a URL registered on the Slack app. So we
  use a single FIXED port (default 3118, override with
  ``$LIBBIE_SLACK_REDIRECT_PORT``) and the operator must register
  ``http://localhost:3118/callback`` as an allowed redirect URL. Token-paste has
  no such constraint and is the recommended path.

Dependency stance: PERMISSIVE ONLY. We use ``slack_sdk`` (MIT) ``WebClient`` when
it is importable, and otherwise fall back to ``httpx`` (BSD-3, already a dep).
Passing an explicit ``transport`` (an ``httpx`` transport) always forces the httpx
path -- this is the test injection point, so no network is ever touched in tests.

Security notes: tokens are never logged and never placed in a URL or argv. They
are persisted via the OS keyring when available, else a 0600 file under the store
(identical to the GitHub integration).
"""

from __future__ import annotations

import os
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
from pydantic import BaseModel

from .ingest.base import person_node
from .models import Message, Node, Provenance, make_id

# --------------------------------------------------------------------------- #
# Endpoints / constants
# --------------------------------------------------------------------------- #
_API_BASE = "https://slack.com/api"
_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# User scopes needed to read the signed-in user's own history + resolve people.
_USER_SCOPES = (
    "channels:history,groups:history,im:history,mpim:history,"
    "channels:read,groups:read,users:read,users:read.email"
)

# All conversation kinds the user can belong to.
_CONV_TYPES = "public_channel,private_channel,mpim,im"

# Token storage (OS keyring service/account; file fallback name).
_KEYRING_SERVICE = "libbie"
_KEYRING_ACCOUNT = "slack"
_TOKEN_FILENAME = ".slack_token"

# Slack requires a *registered* redirect URL, so the loopback port is FIXED.
_DEFAULT_REDIRECT_PORT = 3118


class SlackError(Exception):
    """Any Slack-connector failure (network, ``ok: false``, or OAuth)."""


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class Channel(BaseModel):
    """A conversation the token can see. Extra API fields are ignored."""

    id: str
    name: Optional[str] = None
    is_private: bool = False
    is_im: bool = False
    is_mpim: bool = False

    @property
    def label(self) -> str:
        """Human label: the name for channels, else the id (IMs have no name)."""
        return self.name or self.id


# --------------------------------------------------------------------------- #
# client id / secret / redirect
# --------------------------------------------------------------------------- #
def get_client_id() -> Optional[str]:
    cid = os.environ.get("LIBBIE_SLACK_CLIENT_ID")
    return cid.strip() if cid else None


def get_client_secret() -> Optional[str]:
    sec = os.environ.get("LIBBIE_SLACK_CLIENT_SECRET")
    return sec.strip() if sec else None


def get_redirect_port() -> int:
    raw = os.environ.get("LIBBIE_SLACK_REDIRECT_PORT")
    try:
        return int(raw) if raw else _DEFAULT_REDIRECT_PORT
    except ValueError:
        return _DEFAULT_REDIRECT_PORT


def redirect_uri(port: Optional[int] = None) -> str:
    return f"http://localhost:{port or get_redirect_port()}/callback"


# --------------------------------------------------------------------------- #
# Low-level Web API call (slack_sdk if importable, else httpx; 429-aware)
# --------------------------------------------------------------------------- #
def _has_slack_sdk() -> bool:
    try:
        import slack_sdk  # noqa: F401  (MIT)

        return True
    except Exception:
        return False


def _call(
    method: str,
    token: str,
    params: Optional[dict[str, Any]] = None,
    *,
    transport: "httpx.BaseTransport | None" = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """One Slack Web API method call, returning the parsed JSON ``dict``.

    Uses ``slack_sdk``'s ``WebClient`` when it is importable AND no explicit
    ``transport`` is given (production). Otherwise -- and always in tests, which
    inject an ``httpx`` transport -- talks to the REST endpoint directly with
    ``httpx``, honoring ``Retry-After`` on HTTP 429. Raises :class:`SlackError`
    when Slack replies ``ok: false``.
    """
    params = {k: v for k, v in (params or {}).items() if v is not None}

    if transport is None and _has_slack_sdk():
        try:
            from slack_sdk import WebClient
            from slack_sdk.errors import SlackApiError

            client = WebClient(token=token)
            resp = client.api_call(method, http_verb="GET", params=params)
            data = dict(resp.data)
        except SlackApiError as exc:  # pragma: no cover - needs live sdk+network
            data = dict(getattr(exc.response, "data", {}) or {})
            if not data:
                raise SlackError(str(exc)) from exc
    else:
        headers = {"Authorization": f"Bearer {token}"}
        with httpx.Client(
            base_url=_API_BASE, headers=headers, transport=transport, timeout=_TIMEOUT
        ) as client:
            while True:
                resp = client.get(f"/{method}", params=params)
                if resp.status_code == 429:
                    # Tier-limited: wait the advertised Retry-After, then retry.
                    # Retry-After may be a number of seconds OR an HTTP-date; only
                    # the numeric form is expected here, so fall back on anything else.
                    try:
                        retry_after = float(resp.headers.get("Retry-After", "1") or "1")
                    except ValueError:
                        retry_after = 5.0
                    sleep(max(retry_after, 1.0))
                    continue
                resp.raise_for_status()
                data = resp.json()
                break

    if not data.get("ok", False):
        raise SlackError(f"slack {method} failed: {data.get('error', 'unknown')}")
    return data


# --------------------------------------------------------------------------- #
# auth.test -- validate a pasted token
# --------------------------------------------------------------------------- #
def validate_token(
    token: str, *, transport: "httpx.BaseTransport | None" = None
) -> dict[str, Any]:
    """Validate a token via ``auth.test``; returns the identity dict
    (``user``, ``user_id``, ``team``, ...). Raises :class:`SlackError` if invalid.
    """
    return _call("auth.test", token, transport=transport)


# --------------------------------------------------------------------------- #
# OAuth v2 loopback (optional)
# --------------------------------------------------------------------------- #
def build_authorize_url(client_id: str, state: str, *, port: Optional[int] = None) -> str:
    """Build the browser authorize URL for the OAuth v2 user-token flow."""
    q = httpx.QueryParams(
        {
            "client_id": client_id,
            "user_scope": _USER_SCOPES,
            "redirect_uri": redirect_uri(port),
            "state": state,
        }
    )
    return f"{_AUTHORIZE_URL}?{q}"


def exchange_code(
    code: str,
    client_id: str,
    client_secret: str,
    *,
    port: Optional[int] = None,
    transport: "httpx.BaseTransport | None" = None,
) -> str:
    """Exchange an OAuth ``code`` for the USER token via ``oauth.v2.access``.

    The user token is ``authed_user.access_token`` -- NOT the top-level
    ``access_token`` (which is the bot token). Raises :class:`SlackError` on any
    non-``ok`` response or a missing user token.
    """
    with httpx.Client(transport=transport, timeout=_TIMEOUT) as client:
        resp = client.post(
            f"{_API_BASE}/oauth.v2.access",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri(port),
            },
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("ok", False):
        raise SlackError(f"oauth.v2.access failed: {data.get('error', 'unknown')}")
    user_token = (data.get("authed_user") or {}).get("access_token")
    if not user_token:
        raise SlackError("oauth.v2.access returned no authed_user.access_token")
    return str(user_token)


def run_oauth_flow(
    client_id: str, client_secret: str, *, port: Optional[int] = None
) -> str:  # pragma: no cover - opens a browser + binds a socket (not unit-tested)
    """Full loopback flow: open the browser, catch the redirect on the FIXED port,
    and exchange the code. Returns the user token. Not covered by unit tests
    (it binds a socket and launches a browser); the code-exchange step is tested
    separately via :func:`exchange_code`.
    """
    import secrets
    import urllib.parse
    import webbrowser
    from http.server import BaseHTTPRequestHandler, HTTPServer

    port = port or get_redirect_port()
    state = secrets.token_urlsafe(16)
    captured: dict[str, Optional[str]] = {"code": None, "state": None}

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            captured["code"] = (params.get("code") or [None])[0]
            captured["state"] = (params.get("state") or [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Libbie: Slack authorization received. You may close this tab.")

        def log_message(self, *_a: Any) -> None:  # silence the default logging
            return

    server = HTTPServer(("localhost", port), _Handler)
    try:
        webbrowser.open(build_authorize_url(client_id, state, port=port))
        server.handle_request()  # serve exactly one request (the redirect)
    finally:
        server.server_close()

    if not captured["code"]:
        raise SlackError("no authorization code received on the loopback redirect")
    if captured["state"] != state:
        raise SlackError("OAuth state mismatch -- possible CSRF; aborting")
    return exchange_code(captured["code"], client_id, client_secret, port=port)


# --------------------------------------------------------------------------- #
# conversations.list (cursor pagination)
# --------------------------------------------------------------------------- #
def _paginate(
    method: str,
    token: str,
    result_key: str,
    params: Optional[dict[str, Any]] = None,
    *,
    transport: "httpx.BaseTransport | None" = None,
    sleep: Callable[[float], None] = time.sleep,
) -> list[dict[str, Any]]:
    """Collect every item across cursor pages (``response_metadata.next_cursor``)."""
    items: list[dict[str, Any]] = []
    cursor: Optional[str] = None
    base = dict(params or {})
    while True:
        page_params = dict(base)
        if cursor:
            page_params["cursor"] = cursor
        data = _call(method, token, page_params, transport=transport, sleep=sleep)
        chunk = data.get(result_key) or []
        if isinstance(chunk, list):
            items.extend(x for x in chunk if isinstance(x, dict))
        cursor = ((data.get("response_metadata") or {}).get("next_cursor") or "").strip()
        if not cursor:
            break
    return items


def list_channels(
    token: str,
    *,
    transport: "httpx.BaseTransport | None" = None,
) -> list[Channel]:
    """List every conversation the token can see (public/private/im/mpim)."""
    raw = _paginate(
        "conversations.list",
        token,
        "channels",
        {"types": _CONV_TYPES, "limit": 1000, "exclude_archived": False},
        transport=transport,
    )
    out: list[Channel] = []
    for c in raw:
        out.append(
            Channel(
                id=str(c.get("id")),
                name=c.get("name") or c.get("name_normalized"),
                is_private=bool(c.get("is_private")),
                is_im=bool(c.get("is_im")),
                is_mpim=bool(c.get("is_mpim")),
            )
        )
    return out


# --------------------------------------------------------------------------- #
# users.list -> id -> (email, real_name, display_name)
# --------------------------------------------------------------------------- #
def _load_users(
    token: str, *, transport: "httpx.BaseTransport | None" = None
) -> dict[str, dict[str, Any]]:
    """Map ``user_id -> user record`` from ``users.list`` (paginated)."""
    members = _paginate("users.list", token, "members", {"limit": 200}, transport=transport)
    return {str(m.get("id")): m for m in members if m.get("id")}


def _user_email(rec: dict[str, Any]) -> Optional[str]:
    profile = rec.get("profile") or {}
    if isinstance(profile, dict):
        email = profile.get("email")
        if email:
            return str(email)
    return None


def _user_display(rec: dict[str, Any]) -> Optional[str]:
    profile = rec.get("profile") or {}
    if isinstance(profile, dict):
        return profile.get("display_name") or profile.get("real_name")
    return None


def _channel_label(
    token: str, channel_id: str, *, transport: "httpx.BaseTransport | None" = None
) -> str:
    """Resolve a channel id to a human label via ``conversations.info``.

    Falls back to the id itself (IMs have no name, or info may be unavailable)."""
    try:
        data = _call(
            "conversations.info", token, {"channel": channel_id}, transport=transport
        )
    except SlackError:
        return channel_id
    info = data.get("channel") or {}
    return info.get("name") or info.get("name_normalized") or channel_id


# --------------------------------------------------------------------------- #
# ingest_channels -> Message + Person nodes
# --------------------------------------------------------------------------- #
def ingest_channels(
    token: str,
    channel_ids: list[str],
    oldest: Optional[float] = None,
    *,
    transport: "httpx.BaseTransport | None" = None,
) -> list[Node]:
    """Ingest ``conversations.history`` for each channel into typed nodes.

    Returns ``Message`` nodes (one per message) plus a ``Person`` for every author
    seen -- matching the shapes emitted by the Slack-export path in
    :mod:`libbie_engine.ingest.conversation`. ``author`` resolves to the user's
    email when ``users.list`` provides one, else the raw user id. ``ts`` is parsed
    from the Slack epoch-seconds string; ``thread_id`` is the ``thread_ts``.

    ``oldest`` (unix seconds) bounds history to messages at or after that time.
    """
    users = _load_users(token, transport=transport)
    nodes: list[Node] = []
    seen_authors: set[str] = set()

    for channel_id in channel_ids:
        label = _channel_label(token, channel_id, transport=transport)
        params: dict[str, Any] = {"channel": channel_id, "limit": 999}
        if oldest is not None:
            params["oldest"] = oldest
        history = _paginate(
            "conversations.history", token, "messages", params, transport=transport
        )
        for msg in history:
            if msg.get("type", "message") != "message":
                continue
            if msg.get("subtype"):  # channel_join / bot_message / etc.
                continue
            user_id = msg.get("user")
            rec = users.get(str(user_id)) if user_id is not None else None
            author = (_user_email(rec) if rec else None) or user_id
            if user_id is not None:
                seen_authors.add(str(user_id))

            ts_raw = msg.get("ts")
            try:
                ts = (
                    datetime.fromtimestamp(float(ts_raw), tz=timezone.utc)
                    if ts_raw is not None
                    else None
                )
            except (TypeError, ValueError, OSError, OverflowError):
                ts = None

            thread_ts = msg.get("thread_ts")
            mid = make_id("message", "slack", label, str(ts_raw))
            nodes.append(
                Message(
                    id=mid,
                    ts=ts,
                    author=str(author) if author is not None else None,
                    channel=label,
                    thread_id=str(thread_ts) if thread_ts else None,
                    text=str(msg.get("text") or ""),
                    provenance=Provenance(
                        source="slack",
                        path=f"slack://{channel_id}",
                        actor=str(author) if author is not None else None,
                    ),
                )
            )

    # People: one Person per author actually seen (email-keyed for dedup).
    for uid in sorted(seen_authors):
        rec = users.get(uid)
        if not rec:
            continue
        nodes.append(
            person_node(
                source="slack",
                email=_user_email(rec),
                name=rec.get("real_name") or rec.get("name"),
                handle=_user_display(rec),
            )
        )
    return nodes


# --------------------------------------------------------------------------- #
# Token storage (OS keyring if available; else a 0600 file under the store)
# --------------------------------------------------------------------------- #
def _token_file(store_root: "str | Path") -> Path:
    return Path(store_root) / _TOKEN_FILENAME


def save_token(token: str, store_root: "str | Path") -> None:
    """Persist the token in the OS keyring if available, else a 0600 file."""
    try:
        import keyring  # optional; MIT

        keyring.set_password(_KEYRING_SERVICE, _KEYRING_ACCOUNT, token)
        return
    except Exception:
        pass

    root = Path(store_root)
    root.mkdir(parents=True, exist_ok=True)
    path = _token_file(root)
    path.write_text(token, encoding="utf-8")
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        pass


def load_token(store_root: "str | Path") -> Optional[str]:
    """Load a stored token (keyring first, then the file), or ``None``."""
    try:
        import keyring  # optional; MIT

        token = keyring.get_password(_KEYRING_SERVICE, _KEYRING_ACCOUNT)
        if token:
            return token
    except Exception:
        pass

    path = _token_file(store_root)
    if path.exists():
        text = path.read_text(encoding="utf-8").strip()
        return text or None
    return None


def clear_token(store_root: "str | Path") -> None:
    """Remove any stored token from both the keyring and the file store."""
    try:
        import keyring  # optional; MIT

        keyring.delete_password(_KEYRING_SERVICE, _KEYRING_ACCOUNT)
    except Exception:
        pass

    path = _token_file(store_root)
    try:
        path.unlink()
    except OSError:
        pass
