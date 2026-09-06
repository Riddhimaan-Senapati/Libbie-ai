"""Small text and datetime helpers shared by the join and briefing layers.

``naive`` exists because git commit timestamps are tz-aware while SLURM submit
timestamps are naive; comparing them raised until both sides dropped tzinfo.
"""

from __future__ import annotations

from datetime import datetime


def trim(s: str, n: int) -> str:
    """Collapse whitespace and clip to ``n`` chars (ellipsis-terminated)."""
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def naive(dt):
    """Drop tzinfo so naive and aware timestamps compare; ``None`` passes through."""
    return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo is not None else dt


def min_dt() -> datetime:
    return datetime.min
