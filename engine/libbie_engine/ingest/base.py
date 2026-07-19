"""Shared ingest helpers -- primarily person resolution.

The same human appears as a git-author email, a Slack user id, an email
From-header, and a paper-author string. We resolve to one ``Person`` node by
preferring email as the canonical id, so any two sources that carry the same
email collapse automatically. Name-only references (paper authors) get a
name-slug id and are linked to email-based identities later, by the join layer's
alias-resolution candidate strategy.
"""

from __future__ import annotations

import re
from typing import Optional

from ..models import Person, Provenance, make_id


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def canonical_person_id(email: Optional[str] = None, name: Optional[str] = None) -> str:
    if email:
        return make_id("person", email.strip().lower())
    if name:
        return make_id("person", "name:" + _slug(name))
    return make_id("person", "unknown")


def person_node(
    source: str,
    email: Optional[str] = None,
    name: Optional[str] = None,
    handle: Optional[str] = None,
    path: Optional[str] = None,
) -> Person:
    """Construct a ``Person`` with a deterministic, de-duplicating id."""
    pid = canonical_person_id(email=email, name=name)
    aliases = [a for a in (name, handle, email) if a]
    return Person(
        id=pid,
        canonical_id=(email or (name and _slug(name)) or "unknown"),
        display_name=name,
        aliases=aliases,
        emails=[email] if email else [],
        handles=[handle] if handle else [],
        provenance=Provenance(source=source, path=path, actor=email or name),
    )
