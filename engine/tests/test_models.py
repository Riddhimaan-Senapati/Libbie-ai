"""Model + storage contract tests."""

from __future__ import annotations

from libbie_engine.models import (
    Edge,
    EdgeStatus,
    EdgeType,
    Graph,
    JobRun,
    Param,
    make_id,
)


def test_make_id_deterministic_and_prefixed():
    a = make_id("param", "reference", "GRCh37")
    b = make_id("param", "reference", "GRCh37")
    assert a == b
    assert a.startswith("param:")
    assert make_id("param", "x") != make_id("param", "y")


def test_graph_dedupes_nodes_by_id():
    g = Graph()
    p = Param(id=make_id("param", "k", "v"), key="k", value="v")
    g.add_node(p)
    g.add_node(Param(id=p.id, key="k", value="v"))
    assert len(g.nodes) == 1


def test_add_edge_keeps_higher_confidence():
    g = Graph()
    e1 = Edge.make("a", "b", EdgeType.used, confidence=0.5)
    e2 = Edge.make("a", "b", EdgeType.used, confidence=0.9)
    g.add_edge(e1)
    g.add_edge(e2)
    assert len(g.edges) == 1
    assert g.edges[0].confidence == 0.9


def test_graph_json_roundtrip_preserves_subtypes():
    g = Graph()
    jr = JobRun(id=make_id("job_run", "1"), job_id="1", exit_code=0)
    g.add_node(jr)
    g.add_edge(Edge.make(jr.id, jr.id, EdgeType.used, status=EdgeStatus.committed))
    restored = Graph.model_validate_json(g.model_dump_json())
    assert isinstance(restored.nodes[jr.id], JobRun)
    assert restored.nodes[jr.id].exit_code == 0
    assert restored.edges[0].type == EdgeType.used
