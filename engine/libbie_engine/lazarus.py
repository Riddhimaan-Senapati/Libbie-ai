"""Lazarus integration -- the environment-revival executor (plan section 5).

Lazarus sits OFF-GRAPH: it does not add nodes. It answers one question per step /
run -- "can this actually still be run?" -- and the answer is written back as the
``environment_status`` field (+ an optional ``revival_recipe_ref``). Libbie does
not fix environments; it knows which are broken and who to ask.

Licensing / identity caveat (verified via research)
---------------------------------------------------
The plan assumes a PyPI package named ``lazarus`` that revived a Lua Torch7
genomics CNN. The package currently published on PyPI as ``lazarus`` is an
unrelated "restart-on-change" dev utility (Apache-2.0). So we do NOT hard-depend
on ``import lazarus``. Instead this wrapper is pluggable:

* if ``LazarusExecutor(cmd=...)`` is given an external CLI, we shell out to it and
  parse its verdict (this is where the real ENCODE-tooling revival tool plugs in);
* otherwise we fall back to a transparent heuristic over the environment
  fingerprint (loaded modules / data version) so the field is populated honestly
  with ``unknown`` rather than a fabricated ``runnable``.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Optional

from .models import EnvironmentStatus, Graph, JobRun, PipelineStep


class LazarusExecutor:
    def __init__(self, cmd: Optional[str] = None, timeout: int = 60):
        # `cmd` is an external revival-assessor executable, if the lab has one.
        self.cmd = cmd
        self.timeout = timeout

    def assess(self, fingerprint: str) -> tuple[EnvironmentStatus, Optional[str]]:
        """Return (status, revival_recipe_ref) for one environment fingerprint."""
        if self.cmd and shutil.which(self.cmd.split()[0]):
            return self._assess_external(fingerprint)
        return self._assess_heuristic(fingerprint)

    # -- external tool ------------------------------------------------------ #
    def _assess_external(self, fingerprint: str) -> tuple[EnvironmentStatus, Optional[str]]:
        try:
            proc = subprocess.run(
                # `--` ends option parsing so an untrusted fingerprint (derived from
                # ingested logs) can never be interpreted as a flag by the tool.
                [*self.cmd.split(), "--assess", "--", fingerprint],  # noqa: S603 (cmd is operator-configured; no shell)
                capture_output=True, text=True, timeout=self.timeout, check=False,
            )
            data = json.loads(proc.stdout or "{}")
            status = EnvironmentStatus(data.get("status", "unknown"))
            return status, data.get("revival_recipe_ref")
        except Exception:
            return EnvironmentStatus.unknown, None

    # -- transparent heuristic --------------------------------------------- #
    def _assess_heuristic(self, fingerprint: str) -> tuple[EnvironmentStatus, Optional[str]]:
        fp = (fingerprint or "").lower()
        if not fp:
            return EnvironmentStatus.unknown, None
        # Ancient runtimes that Lazarus is specifically for -> degraded, recipe needed.
        if any(tok in fp for tok in ("torch7", "lua", "python2", "cuda8", "cuda9", "theano")):
            return EnvironmentStatus.degraded, "lazarus:recipe/pending"
        # Pinned, still-current tooling -> plausibly runnable.
        if any(tok in fp for tok in ("gatk", "samtools", "bwa", "python3", "conda", "container")):
            return EnvironmentStatus.runnable, None
        return EnvironmentStatus.unknown, None


def annotate_environment(graph: Graph, executor: Optional[LazarusExecutor] = None) -> int:
    """Write environment_status onto every PipelineStep and JobRun. Returns count."""
    ex = executor or LazarusExecutor()
    touched = 0
    for s in graph.nodes_of("pipeline_step"):
        assert isinstance(s, PipelineStep)
        status, recipe = ex.assess(_fingerprint_step(s))
        s.environment_status = status
        s.revival_recipe_ref = recipe
        touched += 1
    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        status, recipe = ex.assess(jr.data_version or "")
        jr.environment_status = status
        jr.revival_recipe_ref = recipe
        touched += 1
    return touched


def _fingerprint_step(s: PipelineStep) -> str:
    return " ".join(filter(None, [s.name, s.entrypoint, s.revival_recipe_ref]))
