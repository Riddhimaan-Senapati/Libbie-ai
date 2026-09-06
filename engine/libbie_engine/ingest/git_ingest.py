"""Git ingester -- turns a repository's history into typed provenance nodes.

This parser reads one git repository and emits ``Commit``, ``File`` and
``Person`` nodes (NODES ONLY -- the join layer is responsible for the
``authored_by`` / ``ran`` edges that connect them). Following the shared
contract:

* Every commit becomes a ``Commit`` node (capped at the ~500 most recent so a
  huge history stays bounded).
* Every distinct path touched anywhere in that window becomes one ``File`` node,
  with a best-effort language guess from its extension.
* Every commit author becomes a ``Person`` node via the shared ``person_node``
  helper, so the same human collapses to one id across git / Slack / email / papers.

The history walk shells out to the ``git`` binary once (``git log --pretty`` +
``--name-only``). An empty repository (0 commits) yields an empty list rather than
an error.
"""

from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from ..models import Commit, File, Node, Provenance, make_id
from .base import person_node

if TYPE_CHECKING:  # pragma: no cover - import only for type checkers
    from ..store import ArtifactStore

# How many of the most-recent commits to walk. Keeps ingest bounded on repos
# with very long histories while still capturing the meaningful recent work.
MAX_COMMITS = 500

# Extension -> language label. Lower-cased extensions (with leading dot).
# Anything not listed maps to ``None`` (unknown language).
_LANG_BY_EXT: dict[str, str] = {
    ".py": "python",
    ".sh": "shell",
    ".sbatch": "shell",
    ".r": "r",
    ".cpp": "c++",
    ".cc": "c++",
    ".cxx": "c++",
    ".hpp": "c++",
    ".c": "c",
    ".js": "javascript",
    ".ts": "typescript",
}


def _infer_lang(path: str) -> Optional[str]:
    """Best-effort language guess from a file path's extension.

    Extension matching is case-insensitive so ``.R`` and ``.r`` both resolve to
    ``"r"`` and ``.PY`` behaves like ``.py``. Returns ``None`` when unknown.
    """
    if not path:
        return None
    _, ext = os.path.splitext(path)
    return _LANG_BY_EXT.get(ext.lower())


def _repo_basename(repo_path: str) -> str:
    """The repo's short name -- the basename of its path.

    Trailing separators are stripped so ``/x/y/`` and ``/x/y`` agree, and a
    ``.git`` suffix (bare-repo style) is removed for a clean label.
    """
    cleaned = str(repo_path).replace("\\", "/").rstrip("/")
    base = os.path.basename(cleaned) or cleaned
    if base.endswith(".git"):
        base = base[: -len(".git")]
    return base or cleaned


def _coerce_dt(value: object) -> Optional[datetime]:
    """Normalise a variety of timestamp shapes into a ``datetime`` (or ``None``).

    Accepts an existing ``datetime`` (returned as-is), an ISO-8601 string (e.g.
    git's ``%cI`` committer date, possibly ending in ``Z``), or a POSIX epoch
    number. Anything unparseable degrades gracefully to ``None`` so a single odd
    commit never sinks the whole ingest.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # ``datetime.fromisoformat`` accepts an explicit offset but historically
        # not a trailing "Z"; swap it for the equivalent "+00:00".
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None
    return None


def _add_file_nodes(
    paths: list[str],
    repo: str,
    provenance: Provenance,
    out: dict[str, Node],
) -> None:
    """Create/de-duplicate a ``File`` node for each touched path.

    File nodes are keyed by their deterministic id in ``out`` so the same path
    seen across many commits collapses to a single node.
    """
    for raw_path in paths:
        path = (raw_path or "").strip()
        if not path:
            continue
        fid = make_id("file", repo, path)
        if fid in out:
            continue
        out[fid] = File(
            id=fid,
            path=path,
            repo=repo,
            lang=_infer_lang(path),
            provenance=provenance,
        )


# Unit / record separators used to make ``git log`` output unambiguous even when
# commit summaries contain spaces, tabs, or other punctuation.
_FS = "\x1f"  # field separator (between commit metadata fields)
_RS = "\x1e"  # record separator (marks the start of each commit block)


def _ingest_with_subprocess(
    repo_path: str,
    repo_name: str,
    store: Optional["ArtifactStore"],
) -> list[Node]:
    """Parse ``git log`` output from the ``git`` binary.

    Uses a record/field-separator pretty format plus ``--name-only`` so we can
    reliably split commit metadata from the list of touched paths. Returns ``[]``
    for an empty repo (git exits non-zero) or if the binary is unavailable.
    """
    # ``%x1e`` starts each record; then sha/name/email/committer-ISO-date/summary
    # separated by ``%x1f``; ``--name-only`` appends touched paths, one per line.
    pretty = f"--pretty=format:{_RS}%H{_FS}%an{_FS}%ae{_FS}%cI{_FS}%s"
    cmd = [
        "git",
        "-C",
        repo_path,
        "log",
        f"--max-count={MAX_COMMITS}",
        "--name-only",
        pretty,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (FileNotFoundError, OSError):
        return []  # no git binary available

    if proc.returncode != 0 or not proc.stdout.strip():
        # Non-zero for a non-repo or an empty (0-commit) repo -> nothing to emit.
        return []

    nodes: dict[str, Node] = {}
    persons: dict[str, Node] = {}
    files: dict[str, Node] = {}

    # Split on the record separator; the first chunk before the first _RS is
    # empty and skipped.
    for block in proc.stdout.split(_RS):
        block = block.strip("\n")
        if not block:
            continue
        lines = block.split("\n")
        header = lines[0]
        fields = header.split(_FS)
        if len(fields) < 5:
            continue  # malformed record; skip defensively
        sha, author_name, author_email, date_iso, summary = fields[:5]
        sha = sha.strip()
        if not sha:
            continue
        author_name = author_name.strip() or None
        author_email = author_email.strip() or None
        summary = summary.strip() or None

        # Remaining non-empty lines are the touched paths.
        touched = [ln.strip() for ln in lines[1:] if ln.strip()]

        ts = _coerce_dt(date_iso)

        if author_email or author_name:
            person = person_node(
                source="github",
                email=author_email,
                name=author_name,
            )
            persons.setdefault(person.id, person)

        commit_prov = Provenance(
            source="github",
            path=repo_path,
            mtime=ts,
            hash=sha,
            actor=author_email or author_name,
        )

        if store is not None and summary:
            try:
                store.put(
                    summary,
                    source="github",
                    path=f"{repo_name}@{sha}",
                    actor=author_email or author_name,
                )
            except Exception:
                pass

        cid = make_id("commit", repo_name, sha)
        nodes[cid] = Commit(
            id=cid,
            sha=sha,
            repo=repo_name,
            ts=ts,
            author=author_email,
            message=summary,
            touched_files=touched,
            provenance=commit_prov,
        )

        _add_file_nodes(touched, repo_name, commit_prov, files)

    return list(nodes.values()) + list(files.values()) + list(persons.values())


def ingest_git(
    repo_path: str,
    store: Optional["ArtifactStore"] = None,
) -> list[Node]:
    """Parse a git repository into ``Commit``, ``File`` and ``Person`` nodes.

    Parameters
    ----------
    repo_path:
        Filesystem path to a git working tree (or repo root).
    store:
        Optional :class:`ArtifactStore`. When supplied, each commit's raw message
        is persisted for later citation; persistence is best-effort and never
        blocks ingest.

    Returns
    -------
    list[Node]
        Typed nodes only (no edges). Commits first, then files, then people.
        An empty / missing / non-git path yields ``[]``.

    Notes
    -----
    The walk is a single ``git log`` subprocess call, bounded to the
    :data:`MAX_COMMITS` most-recent commits.
    """
    repo_name = _repo_basename(repo_path)

    try:
        return _ingest_with_subprocess(repo_path, repo_name, store)
    except Exception:
        return []
