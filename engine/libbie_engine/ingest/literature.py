"""Literature ingester -- parse papers into Paper/Claim/Finding/Person nodes.

This parser reads scientific papers from a directory (both ``.pdf`` and ``.txt``
files) and emits typed :class:`~libbie_engine.models.Node` objects only -- never
edges. The join layer is responsible for wiring the ``Paper -> Claim`` (``contains``)
and ``Claim -> Finding`` (``evidences``) relationships; here we just produce the
nodes those edges will connect.

The extraction is deliberately *rule-based* (no LLM): it must run fully offline
against the sample data and any air-gapped mock. The heuristics are:

* A small header block (``Title:``, ``Authors:``, ``Year:``, ``DOI:``) becomes a
  :class:`Paper`, and every author name also becomes a :class:`Person` (via the
  shared :func:`person_node` helper so humans de-duplicate across sources).
* The body is split into sections by bare heading lines (Abstract, Methods,
  Results, Discussion).
* From the Results/Abstract sections we emit a :class:`Claim` per sentence that
  either references a figure ("Figure 2" / "Fig. 2") or makes a quantitative
  statement (contains a number).
* Exactly one :class:`Finding` per paper captures the central result -- the first
  Results sentence, or the Abstract's last sentence when there is no Results.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import Claim, Finding, Node, Paper, Provenance, make_id
from .base import person_node

# Section headings we recognise. A heading is a line whose entire text is just
# one of these words (case-insensitive), optionally with trailing punctuation.
_KNOWN_SECTIONS = ("abstract", "introduction", "methods", "results", "discussion", "conclusion")

# Sentences from these sections are eligible for Claim extraction.
_CLAIM_SECTIONS = ("results", "abstract")

# Header field keys we understand in the leading key/value block.
_HEADER_KEYS = ("title", "authors", "year", "doi")

# Matches a figure reference like "Figure 2" or "Fig. 3" (captures the number).
_FIGURE_RE = re.compile(r"\b(?:figure|fig\.?)\s*(\d+)", re.IGNORECASE)

# Matches any digit -- used as the "quantitative statement" signal.
_NUMBER_RE = re.compile(r"\d")

# A single leading "Key: value" header line.
_HEADER_LINE_RE = re.compile(r"^\s*([A-Za-z]+)\s*:\s*(.*)$")


def _read_text(path: Path) -> str:
    """Return the plain text of a paper file (.pdf via pypdf, else UTF-8 text).

    Defensive: unreadable pages/files degrade to an empty string rather than
    raising, so one bad artifact never aborts a whole ingest run.
    """
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader  # imported lazily; only PDFs need it
        except Exception:  # pragma: no cover - pypdf is a declared dependency
            return ""
        try:
            reader = PdfReader(str(path))
            pages: list[str] = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    # A single malformed page should not kill the document.
                    pages.append("")
            return "\n".join(pages)
        except Exception:
            return ""
    # Plain text (and any other extension we treat as text).
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""


def _parse_header(lines: list[str]) -> tuple[dict[str, str], int]:
    """Parse the leading ``Key: value`` header block.

    Returns the collected header fields (lower-cased keys) and the index of the
    first body line (the line after the header block ends). The header block ends
    at the first blank line or the first line that is not a recognised header
    field, so papers that omit fields or reorder them still parse.
    """
    header: dict[str, str] = {}
    idx = 0
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            # Blank line terminates the header block.
            idx = i + 1
            break
        m = _HEADER_LINE_RE.match(line)
        if not m:
            # First non "Key: value" line -> body starts here.
            idx = i
            break
        key = m.group(1).strip().lower()
        if key not in _HEADER_KEYS:
            # An unrecognised "Word:" line is treated as body, not header.
            idx = i
            break
        header[key] = m.group(2).strip()
        idx = i + 1
    return header, idx


def _split_sections(body_lines: list[str]) -> dict[str, str]:
    """Split body lines into ``{section_name: text}`` by bare heading lines.

    A heading line is one whose entire content is a single recognised section
    word (case-insensitive, ignoring trailing punctuation). Text appearing before
    any heading is stored under the ``""`` (preamble) key.
    """
    sections: dict[str, list[str]] = {"": []}
    current = ""
    for raw in body_lines:
        stripped = raw.strip()
        candidate = stripped.rstrip(":.").strip().lower()
        if stripped and candidate in _KNOWN_SECTIONS:
            current = candidate
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(raw)
    # Collapse each section's lines into a single whitespace-normalised string.
    return {name: " ".join(" ".join(ls).split()) for name, ls in sections.items()}


def _split_sentences(text: str) -> list[str]:
    """Very small sentence splitter -- split on ., ! or ? followed by space.

    Good enough for the rule-based claim heuristics; avoids pulling in NLTK.
    Trailing whitespace/fragments are dropped.
    """
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def _figure_ref(text: str) -> Optional[str]:
    """Return a normalised ``"Figure N"`` if the text references a figure."""
    m = _FIGURE_RE.search(text)
    return f"Figure {m.group(1)}" if m else None


def _parse_authors(raw: str) -> list[str]:
    """Split an authors string ("A. Smith, B. Jones") into clean names."""
    if not raw:
        return []
    # Split on commas and the words "and"/"&" so "A, B and C" all separate.
    parts = re.split(r"\s*(?:,|;|\band\b|&)\s*", raw)
    return [p.strip() for p in parts if p.strip()]


def _parse_year(raw: str) -> Optional[int]:
    """Extract a 4-digit year from the header value, tolerating extra text."""
    m = re.search(r"\b(\d{4})\b", raw or "")
    return int(m.group(1)) if m else None


def ingest_literature(lit_dir: Any = None, store: Any = None) -> list[Node]:
    """Parse papers under ``lit_dir`` into Paper/Claim/Finding/Person nodes.

    Parameters
    ----------
    lit_dir:
        Directory containing ``.pdf``/``.txt`` papers. Defaults to the repo's
        ``sample_data/literature`` directory when omitted.
    store:
        Optional artifact store. If provided, each raw paper blob is persisted
        via ``store.put(...)`` and the returned artifact id/sha is recorded in
        provenance. Duck-typed so this module does not depend on the (possibly
        not-yet-present) store implementation.

    Returns
    -------
    list[Node]
        Typed nodes only (Paper, Claim, Finding, Person) -- no edges.
    """
    # Resolve the default sample directory relative to the repo root
    # (.../engine/libbie_engine/ingest/literature.py -> .../engine/sample_data/literature).
    if lit_dir is None:
        lit_dir = Path(__file__).resolve().parents[2] / "sample_data" / "literature"
    lit_path = Path(lit_dir)

    nodes: list[Node] = []
    if not lit_path.exists():
        return nodes

    # Iterate deterministically so re-runs are stable.
    for path in sorted(lit_path.iterdir()):
        if not path.is_file() or path.suffix.lower() not in (".pdf", ".txt"):
            continue

        text = _read_text(path)
        if not text.strip():
            # Nothing extractable (e.g. a scanned PDF with no text layer).
            continue

        # ---- provenance (with optional raw-blob persistence) ----------------
        try:
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        except Exception:
            mtime = None
        blob_hash: Optional[str] = None
        if store is not None:
            try:
                raw_bytes = path.read_bytes()
                put = getattr(store, "put", None)
                if callable(put):
                    result = put(raw_bytes, source="pdf", path=str(path), actor=None)
                    # Accept a bare id/sha string or an object exposing .hash/.id.
                    blob_hash = (
                        getattr(result, "hash", None)
                        or getattr(result, "id", None)
                        or (result if isinstance(result, str) else None)
                    )
            except Exception:
                # Persistence is best-effort; never fail ingest over it.
                blob_hash = None
        prov = Provenance(source="pdf", path=str(path), mtime=mtime, hash=blob_hash)

        # ---- header -> Paper (+ Person per author) --------------------------
        lines = text.splitlines()
        header, body_start = _parse_header(lines)

        title = header.get("title") or path.stem
        doi = header.get("doi") or None
        authors = _parse_authors(header.get("authors", ""))
        year = _parse_year(header.get("year", ""))

        # Paper id is content-addressed on DOI when present, else title -- so the
        # same paper collapses across ingests regardless of file path.
        paper_id = make_id("paper", doi or title)
        paper = Paper(
            id=paper_id,
            title=title,
            doi=doi,
            authors=authors,
            year=year,
            provenance=prov,
        )
        nodes.append(paper)

        # One Person per author (de-duplicated by the shared helper's id scheme).
        for author in authors:
            nodes.append(person_node(source="paper", name=author, path=str(path)))

        # ---- sections -------------------------------------------------------
        sections = _split_sections(lines[body_start:])

        # ---- Claims from Results/Abstract sentences -------------------------
        for section_name in _CLAIM_SECTIONS:
            section_text = sections.get(section_name, "")
            for sentence in _split_sentences(section_text):
                fig = _figure_ref(sentence)
                has_number = bool(_NUMBER_RE.search(sentence))
                if not (fig or has_number):
                    continue
                # Section name in Title Case for readability (e.g. "Results").
                claim = Claim(
                    id=make_id("claim", paper_id, section_name, sentence),
                    statement=sentence,
                    section=section_name.capitalize(),
                    figure_ref=fig,
                    paper_ref=paper_id,
                    provenance=prov,
                )
                nodes.append(claim)

        # ---- one Finding per paper (central result) -------------------------
        results_sentences = _split_sentences(sections.get("results", ""))
        abstract_sentences = _split_sentences(sections.get("abstract", ""))
        finding_statement: Optional[str] = None
        if results_sentences:
            finding_statement = results_sentences[0]
        elif abstract_sentences:
            finding_statement = abstract_sentences[-1]

        if finding_statement:
            nodes.append(
                Finding(
                    id=make_id("finding", paper_id),
                    statement=finding_statement,
                    figure_ref=_figure_ref(finding_statement),
                    provenance=prov,
                )
            )

    return nodes
