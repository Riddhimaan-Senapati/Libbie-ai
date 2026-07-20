#!/usr/bin/env python
"""One-command smoke test for the Libbie engine.

Runs the whole offline pipeline on the bundled sample data (ingest -> join ->
eval -> briefing) with the deterministic mock backend, checks the results, and
prints a PASS/FAIL line. No network, no GPU, no API keys.

Run it after installing the engine (``pip install -e ".[dev,git]"``):

    ./.venv/Scripts/python scripts/smoke_test.py      # Windows
    ./.venv/bin/python     scripts/smoke_test.py      # macOS / Linux

Exit code 0 means every check passed; 1 means something is wrong.
"""

from __future__ import annotations

import sys
from pathlib import Path

from libbie_engine.briefing import generate_briefing
from libbie_engine.config import Config
from libbie_engine.evaluation import run_eval
from libbie_engine.ingest import ingest_conversations, ingest_hpc, ingest_literature
from libbie_engine.join import run_join
from libbie_engine.llm import build_backend
from libbie_engine.models import EdgeStatus, Graph

ENGINE = Path(__file__).resolve().parents[1]
SAMPLE = ENGINE / "sample_data"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((ok, label))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")


def main() -> int:
    print("Libbie engine smoke test (offline mock backend)\n")

    # 1) Ingest the sample HPC + conversation + literature into typed nodes.
    graph = Graph()
    for node in ingest_hpc(str(SAMPLE / "hpc")):
        graph.add_node(node)
    for node in ingest_conversations(str(SAMPLE / "conversations")):
        graph.add_node(node)
    for node in ingest_literature(str(SAMPLE / "literature")):
        graph.add_node(node)

    kinds = {n.kind for n in graph.nodes.values()}
    for kind in ("job_run", "param", "message", "claim", "paper"):
        check(kind in kinds, f"ingested at least one {kind} node")

    # 2) Join: candidate generation -> mock adjudication -> commit.
    cfg = Config()  # backend defaults to mock
    run_join(graph, build_backend(cfg), cfg)
    committed = sum(1 for e in graph.edges if e.status == EdgeStatus.committed)
    check(committed > 0, f"committed at least one edge ({committed} committed)")

    # 3) Eval against the bundled gold set: perfect P/R, and the one planted
    #    wrong edge stays a hypothesis (no false positives).
    report = run_eval(graph)
    totals = report.totals()
    check(totals.fp == 0, f"no wrong edges committed (false positives = {totals.fp})")
    check(totals.fn == 0, f"no gold edges missed (false negatives = {totals.fn})")
    check(totals.precision == 1.0, f"precision = {totals.precision}")
    check(totals.recall == 1.0, f"recall = {totals.recall}")

    # 4) Briefing renders the hero decision chain.
    brief = generate_briefing(graph, build_backend(cfg), cfg, pipeline="germline")
    check("GRCh37" in brief, "briefing cites the GRCh37 decision")
    check("Decisions nobody wrote down" in brief, "briefing has the decisions section")

    passed = sum(1 for ok, _ in results if ok)
    total = len(results)
    print()
    if passed == total:
        print(f"SMOKE TEST PASSED: {passed}/{total} checks green.")
        return 0
    print(f"SMOKE TEST FAILED: {passed}/{total} checks green.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
