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
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

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


def _slack_user_email(user_rec: dict[str, Any]) -> Optional[str]:
    """Extract an email from a user record, tolerant of a missing profile."""
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
        email = _slack_user_email(rec)
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
                    author = _slack_user_email(user_rec) or user_id
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
# .eml email files
# --------------------------------------------------------------------------- #
def _first_address(header_value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Return ``(display_name, email)`` for the first address in a header, or
    ``(None, None)`` when the header is absent/empty."""
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


def _eml_body_text(message: Any) -> str:
    """Extract the plain-text body from a parsed email message, defensively."""
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


def _ingest_eml_file(eml_path: Path, store: "Optional[ArtifactStore]") -> list[Node]:
    """Parse a single ``.eml`` file into a ``Message`` node plus a ``Person`` for
    the From header. Returns an empty list if the file cannot be read."""
    try:
        raw_bytes = eml_path.read_bytes()
    except OSError:
        return []

    try:
        message = BytesParser(policy=policy.default).parsebytes(raw_bytes)
    except Exception:  # pragma: no cover - unparseable file
        return []

    nodes: list[Node] = []

    from_name, from_email = _first_address(message.get("From"))
    subject = message.get("Subject") or ""

    # Date -> datetime (tolerant of malformed/missing Date headers).
    ts: Optional[datetime] = None
    date_hdr = message.get("Date")
    if date_hdr:
        try:
            ts = parsedate_to_datetime(str(date_hdr))
        except (TypeError, ValueError):
            ts = None

    # Thread identity: prefer Message-ID, fall back to In-Reply-To.
    thread_id = message.get("Message-ID") or message.get("In-Reply-To")
    thread_id = str(thread_id) if thread_id else None

    body = _eml_body_text(message)
    text = f"{subject}\n{body}" if subject else body

    blob_hash = _put(
        store,
        raw_bytes,
        source="eml",
        path=str(eml_path),
        actor=from_email or from_name,
    )

    # Message id: Message-ID is globally unique; else fall back to path.
    mid = make_id("message", "eml", thread_id or str(eml_path))
    nodes.append(
        Message(
            id=mid,
            ts=ts,
            author=from_email or from_name,
            channel=None,  # email has no channel concept
            thread_id=thread_id,
            text=text,
            provenance=Provenance(
                source="eml",
                path=str(eml_path),
                hash=blob_hash,
                actor=from_email or from_name,
            ),
        )
    )

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

    return nodes


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
    for eml_path in sorted(conv_path.rglob("*.eml")):
        if eml_path.is_file():
            nodes.extend(_ingest_eml_file(eml_path, store))

    return nodes
