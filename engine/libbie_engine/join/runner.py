"""Join-layer orchestrator: resolve people -> derive decisions -> commit certain
edges -> generate candidates -> adjudicate -> commit."""

from __future__ import annotations

from ..config import Config
from ..llm.base import LLMBackend
from ..models import Graph
from .candidates import (
    certain_edges,
    derive_decisions,
    generate_candidates,
    resolve_people,
)
from .scoring import score_and_commit


def run_join(graph: Graph, backend: LLMBackend, cfg: Config) -> dict:
    """Resolve edges across artifact classes. Mutates and returns a summary."""
    remap = resolve_people(graph)

    # Decisions are derived from message clusters, then their sourced_from edges
    # are certain by construction.
    decisions, decision_edges = derive_decisions(graph)
    for d in decisions:
        graph.add_node(d)

    # Edges that are true by construction skip LLM scoring.
    for e in certain_edges(graph) + decision_edges:
        graph.add_edge(e)

    # Candidate generation across artifact classes, then adjudication.
    candidates = generate_candidates(graph, cfg.join.time_locality_days)
    summary = score_and_commit(graph, candidates, backend, cfg)

    summary.update(
        {
            "people_merged": len(remap),
            "decisions_derived": len(decisions),
            "certain_edges": len([e for e in graph.edges if e.generator and e.generator.startswith(("ingest:", "derive:"))]),
            "nodes": len(graph.nodes),
            "edges": len(graph.edges),
        }
    )
    return summary
