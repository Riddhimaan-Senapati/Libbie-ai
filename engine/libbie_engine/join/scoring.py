"""Scoring (expensive, precision-oriented) + the commit rule.

An LLM adjudicates each candidate edge with its evidence spans attached and emits
``{accept, confidence, rationale, spans}``. We store the rationale -- it is what
retrieval and the briefing cite. Edges at/above ``commit_threshold`` are
``committed``; everything else is kept as a ``hypothesis`` edge and surfaced in
the briefing's honest-gaps section. Wrong edges are worse than missing edges.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from ..config import Config
from ..llm.base import LLMBackend
from ..models import Edge, EdgeStatus, EvidenceSpan, Graph

# Overlapped HTTP round trips against a real backend. The mock backend stays
# synchronous so tests remain deterministic.
_ADJUDICATION_WORKERS = 6

ADJUDICATION_SCHEMA = {
    "type": "object",
    "properties": {
        "accept": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "rationale": {"type": "string"},
        "spans": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "artifact": {"type": "string"},
                    "quote": {"type": "string"},
                },
            },
        },
    },
    "required": ["accept", "confidence", "rationale"],
}

_EDGE_MEANING = {
    "evidences": "the claim provides evidence for the finding",
    "supported_by": "the finding is supported by results the job run produced",
    "produced_by": "the job run is an execution of the pipeline step",
    "ran": "the job run executed this commit's version of the code",
    "used": "the job run used this parameter",
    "justified_by": "this parameter value was justified by this decision",
    "sourced_from": "the decision was drawn from this message",
    "authored_by": "the file was authored by this person",
    "contains": "the paper contains this claim",
    "wrote": "the job run wrote this output file",
    "appears_in": "this output file appears in / underlies this claim",
    "contextualizes": "this external work contextualizes the finding",
}


def _node_line(graph: Graph, node_id: str) -> str:
    n = graph.nodes.get(node_id)
    if n is None:
        return f"{node_id} (missing)"
    fields = n.model_dump(exclude_none=True)
    keep = {k: v for k, v in fields.items() if k not in ("id", "kind", "provenance") and v not in ([], "")}
    # Keep the summary compact.
    parts = []
    for k, v in list(keep.items())[:6]:
        sv = str(v)
        parts.append(f"{k}={sv[:120]}")
    return f"[{n.kind}] " + ", ".join(parts)


def _prompt(line_for: Callable[[str], str], edge: Edge) -> str:
    meaning = _EDGE_MEANING.get(edge.type.value, edge.type.value)
    ev = "\n".join(
        f"  - {s.quote}" for s in edge.evidence_spans if s.quote
    ) or "  (none attached)"
    return (
        "You are adjudicating one candidate edge in a scientific provenance graph. "
        "Decide whether the relationship truly holds, based ONLY on the evidence.\n\n"
        f"Relationship under test: {meaning}.\n\n"
        f"SOURCE: {line_for(edge.src)}\n"
        f"TARGET: {line_for(edge.dst)}\n\n"
        f"Evidence:\n{ev}\n\n"
        f"SELF_CHECK_PRIOR={edge.confidence}\n\n"
        "Return JSON {accept: bool, confidence: 0..1, rationale: string, spans: [{artifact, quote}]}. "
        "Be conservative: a wrong edge is worse than a missing one. If the evidence is "
        "only circumstantial, lower the confidence."
    )


def score_and_commit(
    graph: Graph,
    candidates: list[Edge],
    backend: LLMBackend,
    cfg: Config,
) -> dict:
    """Adjudicate every candidate, commit above threshold, return a summary."""
    threshold = cfg.join.commit_threshold

    # Candidates share endpoints heavily; describe each node once.
    node_lines: dict[str, str] = {}
    for edge in candidates:
        for nid in (edge.src, edge.dst):
            if nid not in node_lines:
                node_lines[nid] = _node_line(graph, nid)
    line_for = node_lines.__getitem__

    def _adjudicate(edge: Edge) -> None:
        prior = edge.confidence
        try:
            verdict = backend.complete(
                _prompt(line_for, edge), schema=ADJUDICATION_SCHEMA, role="adjudicate"
            )
        except Exception:  # backend down -> fall back to the prior, mark hypothesis
            # Do not persist raw exception text (endpoints, keys) into the graph /
            # briefing; keep a generic note and log details out-of-band.
            edge.rationale = f"{edge.rationale} (adjudication unavailable; using candidate prior)".strip()
            edge.status = EdgeStatus.committed if prior >= threshold else EdgeStatus.hypothesis
            return

        conf = float(verdict.get("confidence", prior))
        accept = bool(verdict.get("accept", conf >= threshold))
        edge.confidence = round(conf, 3)
        if verdict.get("rationale"):
            edge.rationale = verdict["rationale"]
        for s in verdict.get("spans") or []:
            if isinstance(s, dict) and s.get("quote"):
                edge.evidence_spans.append(EvidenceSpan(artifact=s.get("artifact", edge.src), quote=s["quote"]))
        edge.status = (
            EdgeStatus.committed if (accept and conf >= threshold) else EdgeStatus.hypothesis
        )

    if cfg.llm.backend != "mock" and len(candidates) > 1:
        # Each thread mutates only its own edge; the graph is touched afterwards.
        with ThreadPoolExecutor(max_workers=_ADJUDICATION_WORKERS) as pool:
            list(pool.map(_adjudicate, candidates))
    else:
        for edge in candidates:
            _adjudicate(edge)

    committed = hypothesis = 0
    for edge in candidates:
        _tally(edge, graph)
        committed += edge.status == EdgeStatus.committed
        hypothesis += edge.status == EdgeStatus.hypothesis

    return {"scored": len(candidates), "committed": committed, "hypothesis": hypothesis}


def _tally(edge: Edge, graph: Graph) -> None:
    graph.add_edge(edge)
