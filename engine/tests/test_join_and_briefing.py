"""The join layer + eval + briefing -- the parts that are the product."""

from __future__ import annotations

from libbie_engine.briefing import generate_briefing
from libbie_engine.evaluation import run_eval
from libbie_engine.models import EdgeStatus, EdgeType, Graph


def _committed(graph: Graph, etype: EdgeType):
    return [e for e in graph.edges if e.type == etype and e.status == EdgeStatus.committed]


def test_demo_chain_is_committed(built: Graph):
    """claim -> figure/output -> run -> param -> Slack decision -> message."""
    assert _committed(built, EdgeType.used)          # JobRun used Param
    assert _committed(built, EdgeType.justified_by)  # Param justified by Decision
    assert _committed(built, EdgeType.sourced_from)  # Decision from Message
    assert _committed(built, EdgeType.wrote)         # JobRun wrote output
    assert _committed(built, EdgeType.appears_in)    # output appears in Claim


def test_reference_param_links_to_grch37_decision(built: Graph):
    ref_params = [p for p in built.nodes_of("param") if p.key == "reference"]
    assert ref_params
    ref = ref_params[0]
    just = [e for e in built.out_edges(ref.id, EdgeType.justified_by)
            if e.status == EdgeStatus.committed]
    assert just, "reference param should be justified by a committed decision"
    decision = built.nodes[just[0].dst]
    assert "GRCh37" in decision.statement


def test_wrong_confidence_threshold_link_is_not_committed(built: Graph):
    """The '30' in the thread refers to the old base-quality value, not the
    calling-confidence param -- that edge must stay a hypothesis, not commit."""
    bad = [p for p in built.nodes_of("param")
           if p.key == "standard-min-confidence-threshold-for-calling"]
    assert bad
    committed = [e for e in built.out_edges(bad[0].id, EdgeType.justified_by)
                 if e.status == EdgeStatus.committed]
    assert not committed


def test_eval_is_perfect_on_gold(built: Graph):
    report = run_eval(built)
    totals = report.totals()
    assert totals.fp == 0, f"false positives: {report.false_positives}"
    assert totals.fn == 0, f"false negatives: {report.misses}"
    assert totals.precision == 1.0
    assert totals.recall == 1.0


def test_ran_candidate_handles_mixed_tz_without_crashing():
    """Regression: git Commit.ts is tz-aware, SLURM JobRun.submit_ts is naive.
    The ran candidate must compare them tz-safely (previously crashed the join)."""
    from datetime import datetime, timezone

    from libbie_engine.config import Config
    from libbie_engine.join import run_join
    from libbie_engine.llm import build_backend
    from libbie_engine.models import Commit, JobRun, PipelineStep, make_id

    g = Graph()
    step = PipelineStep(id=make_id("step", "s"), name="germline", entrypoint="/repo/run.sbatch")
    jr = JobRun(id=make_id("job_run", "1"), job_id="1",
                submit_ts=datetime(2023, 2, 14, 9, 0, 0))  # naive (SLURM)
    commit = Commit(id=make_id("commit", "c"), sha="abc123",
                    ts=datetime(2023, 2, 10, 12, 0, 0, tzinfo=timezone.utc),  # aware (git)
                    touched_files=["/repo/run.sbatch"])
    for n in (step, jr, commit):
        g.add_node(n)

    run_join(g, build_backend(Config()), Config())  # must not raise
    ran = [e for e in g.edges if e.type == EdgeType.ran]
    assert ran and ran[0].dst == commit.id


def test_briefing_quotes_the_decision(built: Graph):
    doc = generate_briefing(built, pipeline="germline")
    assert "Inheritance Briefing" in doc
    assert "GRCh37" in doc
    assert "Decisions nobody wrote down" in doc
    # the honest-gaps section always exists
    assert "hypothesis edges" in doc.lower()
