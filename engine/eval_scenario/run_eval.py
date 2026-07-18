"""End-to-end measurement harness for the eval_scenario ground-truth set.

Runs the REAL engine pipeline (ingest -> resolve people -> derive decisions ->
certain edges -> candidate generation -> mock adjudication -> commit) and then
scores committed edges against eval_scenario/gold_edges.json with the engine's
own run_eval.

Nothing under libbie_engine/** is modified. The engine runs exactly as shipped:
the git fixture is regenerated first (see build_repo) so `authored_by` and the
`ran` repo-state-at-submit edges are reproducible on a fresh clone.

Run:  .venv/Scripts/python.exe -m eval_scenario.run_eval
"""
from __future__ import annotations

from pathlib import Path

from libbie_engine.config import Config
from libbie_engine.evaluation import run_eval
from libbie_engine.ingest import (
    ingest_conversations,
    ingest_git,
    ingest_hpc,
    ingest_literature,
)
from libbie_engine.join import run_join
from libbie_engine.llm import build_backend
from libbie_engine.models import EdgeStatus, Graph

from . import build_repo

ENGINE = Path(__file__).resolve().parent.parent
SCEN = ENGINE / "eval_scenario"
GOLD = SCEN / "gold_edges.json"


def build() -> Graph:
    build_repo.ensure()  # regenerate repo/.git from the committed fixture files
    g = Graph()
    for n in ingest_hpc(str(SCEN / "hpc")):
        g.add_node(n)
    for n in ingest_git(str(SCEN / "repo")):
        g.add_node(n)
    for n in ingest_conversations(str(SCEN / "conversations")):
        g.add_node(n)
    for n in ingest_literature(str(SCEN / "literature")):
        g.add_node(n)
    cfg = Config()  # mock backend, commit_threshold 0.75, time_locality_days 14
    run_join(g, build_backend(cfg), cfg)
    return g


def main() -> None:
    g = build()
    committed = sum(1 for e in g.edges if e.status == EdgeStatus.committed)
    print(f"Graph: {len(g.nodes)} nodes, {len(g.edges)} edges "
          f"({committed} committed, {len(g.edges) - committed} hypothesis)")
    print()
    report = run_eval(g, gold_path=str(GOLD))
    print(report.render())


if __name__ == "__main__":
    main()
