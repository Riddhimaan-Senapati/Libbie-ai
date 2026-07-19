"""Regenerate the eval_scenario git fixture (`repo/.git`) deterministically.

The fixture's *files* are committed to the parent repo as normal tracked files;
its git *history* is not (a nested .git can't live inside the parent repo). This
script replays the exact commit history — authors, back-dated timestamps, and the
two-version germline edit — from those working-tree files, so the git-derived
edges (`authored_by`, `ran` repo-state-at-submit) are fully reproducible on a
fresh clone.

Idempotent: does nothing if `repo/.git` already exists. Run directly, or via
`run_eval` which calls `ensure()` first.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent / "repo"

# (date, author, email, message, [files]) in chronological order.
_HISTORY = [
    ("2021-02-01T10:00:00-05:00", "Priya Nair", "pnair@genomicslab.org",
     "Initial cohortA pipelines repo", ["README.md"]),
    ("2021-02-05T10:00:00-05:00", "Wei Zhang", "wzhang@genomicslab.org",
     "Add figure generation script", ["scripts/make_figures.py"]),
    ("2021-02-06T10:00:00-05:00", "Sofia Ramirez", "sramirez@genomicslab.org",
     "Add RNA-seq salmon quant pipeline (libType ISR, numBootstraps 100)",
     ["pipelines/rnaseq_quant.sbatch"]),
    ("2021-02-07T10:00:00-05:00", "Daniel Okafor", "dokafor@genomicslab.org",
     "Add VEP variant annotation pipeline (cache-version 105)",
     ["pipelines/variant_annotate.sbatch"]),
    ("2021-02-08T10:00:00-05:00", "Wei Zhang", "wzhang@genomicslab.org",
     "Add mosdepth alignment QC pipeline", ["pipelines/align_qc.sbatch"]),
    # germline v1: same file, min-base-quality-score forced back to 20.
    ("2021-02-09T10:00:00-05:00", "Priya Nair", "pnair@genomicslab.org",
     "Add germline HaplotypeCaller pipeline (GRCh38, mbq 20)",
     ["pipelines/germline_call.sbatch@v1"]),
    # germline v2: the working-tree version (mbq 18).
    ("2021-02-20T10:00:00-05:00", "Priya Nair", "pnair@genomicslab.org",
     "Lower germline min-base-quality-score 20 to 18 for low-coverage batch",
     ["pipelines/germline_call.sbatch"]),
]

_GERMLINE = "pipelines/germline_call.sbatch"


def _run(args: list[str], **kw) -> None:
    subprocess.run(args, cwd=REPO, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kw)


def _v1_of(v2_text: str) -> str:
    """Derive the pre-edit germline script (mbq 20) from the working-tree v2 (mbq 18)."""
    return re.sub(r"(--min-base-quality-score\s+)18\b", r"\g<1>20", v2_text)


def ensure() -> None:
    if (REPO / ".git").exists():
        return
    build()


def build() -> None:
    if not REPO.exists():
        raise FileNotFoundError(f"fixture files missing: {REPO}")

    v2_text = (REPO / _GERMLINE).read_text(encoding="utf-8")

    _run(["git", "init", "-q"])
    _run(["git", "config", "commit.gpgsign", "false"])

    for date, name, email, message, files in _HISTORY:
        for f in files:
            if f == f"{_GERMLINE}@v1":
                # germline v1: force min-base-quality-score back to 20.
                (REPO / _GERMLINE).write_text(_v1_of(v2_text), encoding="utf-8")
                _run(["git", "add", "--", _GERMLINE])
            elif f == _GERMLINE:
                # germline v2: the working-tree content (mbq 18) -- write it now so
                # this commit is a real change over v1, not an empty commit.
                (REPO / _GERMLINE).write_text(v2_text, encoding="utf-8")
                _run(["git", "add", "--", f])
            else:
                _run(["git", "add", "--", f])
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_AUTHOR_DATE": date,
            "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "GIT_COMMITTER_DATE": date,
        }
        _run(["git", "commit", "-q", "-m", message], env=env)

    # Restore the working tree to the final (v2) content.
    (REPO / _GERMLINE).write_text(v2_text, encoding="utf-8")


if __name__ == "__main__":
    build() if not (REPO / ".git").exists() else print("repo/.git already exists; nothing to do.")
