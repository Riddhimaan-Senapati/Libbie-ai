"""Ingest-parser tests against the bundled hero-scenario sample data."""

from __future__ import annotations

from collections import Counter

from libbie_engine.models import Graph


def _kinds(nodes):
    return Counter(n.kind for n in nodes)


def test_all_classes_produce_expected_node_kinds(ingested: Graph):
    kinds = Counter(n.kind for n in ingested.nodes.values())
    for expected in ("job_run", "param", "pipeline_step", "commit", "file",
                     "message", "person", "paper", "claim", "finding"):
        assert kinds[expected] >= 1, f"missing {expected}: {kinds}"


def test_hpc_extracts_the_cli_params(ingested: Graph):
    params = {p.key: p.value for p in ingested.nodes_of("param")}
    assert params.get("reference", "").endswith("human_g1k_v37.fasta")
    assert params.get("min-base-quality-score") == "20"


def test_jobrun_has_output_and_exit(ingested: Graph):
    runs = ingested.nodes_of("job_run")
    assert len(runs) == 1
    jr = runs[0]
    assert jr.job_id == "48219"
    assert jr.exit_code == 0
    assert any("sample01.vcf" in p for p in jr.output_paths)


def test_conversation_resolves_people_by_email(ingested: Graph):
    people = ingested.nodes_of("person")
    emails = {e for p in people for e in p.emails}
    assert "evasquez@lab.edu" in emails


def test_literature_extracts_paper_and_claims(ingested: Graph):
    assert len(ingested.nodes_of("paper")) >= 1
    claims = ingested.nodes_of("claim")
    assert any("12,048" in c.statement or "12048" in c.statement for c in claims)
