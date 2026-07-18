"""Candidate generation (cheap, recall-oriented) + Decision derivation + the
handful of edges that are *certain* by construction and skip LLM scoring.

Candidate strategies (plan section 2):
* path identity   -- JobRun output paths <-> paths cited in claims / figure scripts
* time locality   -- Decision ts within +/-N days of a JobRun submit
* value identity  -- Param value literal appearing in Message text / paper methods
* content hash    -- JobRun script_hash <-> commit tree / repo state at submit
* name/alias      -- Person across git email / Slack handle / paper author (dedup)

A "candidate" is just an ``Edge`` whose ``confidence`` currently holds the *prior*
from its generating strategy; the scorer overwrites that with the adjudicated
confidence. Evidence spans are attached here so the scorer (and later the
briefing) can quote them.
"""

from __future__ import annotations

import os
import re
from datetime import timedelta
from typing import Iterable, Optional

from ..models import (
    Claim,
    Commit,
    Decision,
    EvidenceSpan,
    Edge,
    EdgeStatus,
    EdgeType,
    File,
    Finding,
    Graph,
    JobRun,
    Message,
    Param,
    Person,
    PipelineStep,
    Provenance,
    make_id,
)

# Decision-bearing language: threads without any of these are not turned into Decisions.
_DECISION_CUES = re.compile(
    r"\b(going with|instead|because|decided|chose|choose|we need|default|"
    r"threshold|min-|not\s+\w|rather than|keep|stay|switch)\b",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- #
# name/alias resolution -- collapse the same human across sources
# --------------------------------------------------------------------------- #
def _name_key(name: Optional[str]) -> Optional[tuple[str, str]]:
    """(first-initial, lastname) key for fuzzy person matching."""
    if not name:
        return None
    toks = re.split(r"[^A-Za-z]+", name.strip().lower())
    toks = [t for t in toks if t]
    if not toks:
        return None
    return (toks[0][0], toks[-1])


def resolve_people(graph: Graph) -> dict[str, str]:
    """Merge name-only Person nodes (e.g. a paper author 'E. Vasquez') into the
    email-keyed identity for the same human ('Elena Vasquez'), matched on
    (first-initial, lastname). Returns the id remap that was applied."""
    email_people = [p for p in graph.nodes_of("person") if isinstance(p, Person) and p.emails]
    name_only = [p for p in graph.nodes_of("person") if isinstance(p, Person) and not p.emails]

    by_key: dict[tuple[str, str], Person] = {}
    for p in email_people:
        k = _name_key(p.display_name) or _name_key(p.canonical_id)
        if k:
            by_key.setdefault(k, p)

    remap: dict[str, str] = {}
    for p in name_only:
        k = _name_key(p.display_name)
        target = by_key.get(k) if k else None
        if target and target.id != p.id:
            for a in p.aliases:
                if a not in target.aliases:
                    target.aliases.append(a)
            remap[p.id] = target.id
            del graph.nodes[p.id]
    return remap


# --------------------------------------------------------------------------- #
# certain edges -- true by construction, committed without LLM scoring
# --------------------------------------------------------------------------- #
def certain_edges(graph: Graph) -> list[Edge]:
    edges: list[Edge] = []

    # JobRun --used--> Param  (recorded directly in the job invocation)
    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        for pid in jr.params:
            if pid in graph.nodes:
                edges.append(Edge.make(
                    jr.id, pid, EdgeType.used,
                    confidence=1.0, status=EdgeStatus.committed, generator="ingest:job-invocation",
                    rationale="Parameter appears in the job's own recorded invocation.",
                ))

    # Paper --contains--> Claim  (parsed from the same document)
    for cl in graph.nodes_of("claim"):
        assert isinstance(cl, Claim)
        if cl.paper_ref and cl.paper_ref in graph.nodes:
            edges.append(Edge.make(
                cl.paper_ref, cl.id, EdgeType.contains,
                confidence=1.0, status=EdgeStatus.committed, generator="ingest:paper-structure",
                rationale="Claim extracted from this paper's body.",
            ))

    # File --authored_by--> Person  (git author of every commit touching the file)
    files_by_path: dict[str, File] = {}
    for f in graph.nodes_of("file"):
        assert isinstance(f, File)
        files_by_path[f.path] = f
    person_by_email: dict[str, Person] = {}
    for p in graph.nodes_of("person"):
        assert isinstance(p, Person)
        for e in p.emails:
            person_by_email[e.lower()] = p
    for c in graph.nodes_of("commit"):
        assert isinstance(c, Commit)
        author = (c.author or "").lower()
        person = person_by_email.get(author)
        if not person:
            continue
        for path in c.touched_files:
            f = files_by_path.get(path)
            if f:
                edges.append(Edge.make(
                    f.id, person.id, EdgeType.authored_by,
                    confidence=1.0, status=EdgeStatus.committed, generator="ingest:git-blame",
                    rationale=f"{person.display_name or author} committed changes to this file.",
                ))
    return edges


# --------------------------------------------------------------------------- #
# Decision derivation -- Decisions are derived from Message clusters
# --------------------------------------------------------------------------- #
def derive_decisions(graph: Graph) -> tuple[list[Decision], list[Edge]]:
    """Cluster messages into threads and mint a Decision for each decision-bearing
    thread, plus the (certain) Decision --sourced_from--> Message edges."""
    threads: dict[str, list[Message]] = {}
    for m in graph.nodes_of("message"):
        assert isinstance(m, Message)
        key = m.thread_id or f"{m.channel}:{(m.ts.date().isoformat() if m.ts else 'na')}"
        threads.setdefault(key, []).append(m)

    decisions: list[Decision] = []
    edges: list[Edge] = []
    for key, msgs in threads.items():
        blob = "\n".join(m.text for m in msgs)
        if not _DECISION_CUES.search(blob):
            continue
        msgs_sorted = sorted(msgs, key=lambda m: _as_naive(m.ts) or _min_dt())
        # Statement: the first substantive (decision-cue-bearing) message.
        stmt_msg = next((m for m in msgs_sorted if _DECISION_CUES.search(m.text)), msgs_sorted[0])
        participants = sorted({m.author for m in msgs if m.author})
        spans = [
            EvidenceSpan(artifact=m.id, locator=f"msg {m.ts.isoformat() if m.ts else '?'}", quote=m.text)
            for m in msgs_sorted
        ]
        did = make_id("decision", key)
        decision = Decision(
            id=did,
            statement=_trim(stmt_msg.text, 400),
            ts=msgs_sorted[0].ts,
            participants=participants,
            evidence_spans=spans,
            provenance=Provenance(source="derived", actor=stmt_msg.author),
        )
        decisions.append(decision)
        for m in msgs_sorted:
            edges.append(Edge.make(
                did, m.id, EdgeType.sourced_from,
                confidence=1.0, status=EdgeStatus.committed, generator="derive:message-cluster",
                rationale="Decision was synthesised from this thread.",
                evidence_spans=[EvidenceSpan(artifact=m.id, quote=_trim(m.text, 200))],
            ))
    return decisions, edges


# --------------------------------------------------------------------------- #
# candidate generation
# --------------------------------------------------------------------------- #
def generate_candidates(graph: Graph, time_locality_days: int = 14) -> list[Edge]:
    cands: list[Edge] = []
    cands += _cand_param_justified_by_decision(graph, time_locality_days)
    cands += _cand_output_path_identity(graph)
    cands += _cand_finding_supported_by_jobrun(graph)
    cands += _cand_claim_evidences_finding(graph)
    cands += _cand_jobrun_ran_commit(graph)
    cands += _cand_jobrun_produced_by_step(graph)
    return cands


def _cand_param_justified_by_decision(graph: Graph, days: int) -> list[Edge]:
    """value identity (+ time locality): a Param whose literal value shows up in
    the messages a Decision was drawn from is a candidate for justified_by."""
    out: list[Edge] = []
    params = [p for p in graph.nodes_of("param") if isinstance(p, Param)]
    decisions = [d for d in graph.nodes_of("decision") if isinstance(d, Decision)]
    # jobruns that used each param, for time locality
    jobruns_for_param: dict[str, list[JobRun]] = {}
    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        for pid in jr.params:
            jobruns_for_param.setdefault(pid, []).append(jr)

    for p in params:
        needles = _value_needles(p.value)
        for d in decisions:
            hay = " \n".join(s.quote or "" for s in d.evidence_spans) + " " + d.statement
            hits = [n for n in needles if n and n.lower() in hay.lower()]
            if not hits:
                continue
            prior = _value_match_prior(hits)
            # key token bonus (e.g. "min-base-quality-score" mentioned)
            if p.key and _loose_key(p.key) in _loose_key(hay):
                prior = min(0.95, prior + 0.1)
            # time locality bonus
            if _time_local(jobruns_for_param.get(p.id, []), d, days):
                prior = min(0.97, prior + 0.1)
            span = EvidenceSpan(
                artifact=d.id,
                locator="decision evidence",
                quote=_first_quote_containing(d, hits[0]),
            )
            out.append(Edge.make(
                p.id, d.id, EdgeType.justified_by,
                confidence=round(prior, 3), status=EdgeStatus.hypothesis,
                generator="candidate:value-identity+time-locality",
                rationale=f"Param value {hits[0]!r} appears in the decision's evidence.",
                evidence_spans=[span],
            ))
    return out


def _cand_output_path_identity(graph: Graph) -> list[Edge]:
    """path identity: JobRun output paths -> File(output) [wrote], and that output
    file -> any Claim citing its basename [appears_in]."""
    out: list[Edge] = []
    claims = [c for c in graph.nodes_of("claim") if isinstance(c, Claim)]
    files_by_path = {f.path: f for f in graph.nodes_of("file") if isinstance(f, File)}

    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        for path in jr.output_paths:
            f = files_by_path.get(path)
            if f is None:
                f = File(id=make_id("file", "", path), path=path,
                         provenance=Provenance(source="slurm", path=path))
                graph.add_node(f)
                files_by_path[path] = f
            out.append(Edge.make(
                jr.id, f.id, EdgeType.wrote,
                confidence=0.95, status=EdgeStatus.committed, generator="ingest:job-output",
                rationale="Output path recorded in the job log.",
            ))
            for c in claims:
                if _path_cited(path, c.statement):
                    out.append(Edge.make(
                        f.id, c.id, EdgeType.appears_in,
                        confidence=0.9, status=EdgeStatus.hypothesis,
                        generator="candidate:path-identity",
                        rationale=f"Claim cites output file {os.path.basename(path)!r}.",
                        evidence_spans=[EvidenceSpan(artifact=c.id, quote=c.statement)],
                    ))
    return out


def _cand_finding_supported_by_jobrun(graph: Graph) -> list[Edge]:
    """A Finding is supported_by the JobRun that produced the output its paper cites."""
    out: list[Edge] = []
    findings = [f for f in graph.nodes_of("finding") if isinstance(f, Finding)]
    claims = [c for c in graph.nodes_of("claim") if isinstance(c, Claim)]
    jobruns = [j for j in graph.nodes_of("job_run") if isinstance(j, JobRun)]
    for fnd in findings:
        # Only consider claims from the finding's OWN paper -- otherwise a run
        # whose output is cited by any unrelated paper gets falsely linked.
        paper_claims = [c for c in claims if _same_paper(fnd, c)]
        for jr in jobruns:
            cited = next(
                (os.path.basename(p) for p in jr.output_paths
                 for c in paper_claims if _path_cited(p, c.statement)),
                None,
            )
            if cited:
                out.append(Edge.make(
                    fnd.id, jr.id, EdgeType.supported_by,
                    confidence=0.8, status=EdgeStatus.hypothesis,
                    generator="candidate:path-identity",
                    rationale=f"Finding's paper cites {cited!r}, written by this run.",
                    evidence_spans=[EvidenceSpan(artifact=fnd.id, quote=fnd.statement)],
                ))
    return out


def _cand_claim_evidences_finding(graph: Graph) -> list[Edge]:
    """Within a paper, each Claim is a candidate to evidence that paper's Finding."""
    out: list[Edge] = []
    # map paper -> its finding(s) via shared provenance path
    findings = [f for f in graph.nodes_of("finding") if isinstance(f, Finding)]
    claims = [c for c in graph.nodes_of("claim") if isinstance(c, Claim)]
    for c in claims:
        for fnd in findings:
            if _same_paper(c, fnd):
                out.append(Edge.make(
                    c.id, fnd.id, EdgeType.evidences,
                    confidence=0.7, status=EdgeStatus.hypothesis,
                    generator="candidate:same-document",
                    rationale="Claim and finding are from the same paper.",
                    evidence_spans=[EvidenceSpan(artifact=c.id, quote=c.statement)],
                ))
    return out


def _cand_jobrun_ran_commit(graph: Graph) -> list[Edge]:
    """content hash / repo-state-at-submit: link a JobRun to the latest commit that
    touched its step entrypoint at or before submit time."""
    out: list[Edge] = []
    steps = {s.id: s for s in graph.nodes_of("pipeline_step") if isinstance(s, PipelineStep)}
    commits = [c for c in graph.nodes_of("commit") if isinstance(c, Commit)]
    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        entry_bases = {
            os.path.basename(s.entrypoint) for s in steps.values() if s.entrypoint
        }
        best: Optional[Commit] = None
        submit = _as_naive(jr.submit_ts)
        for c in commits:
            touched = {os.path.basename(t) for t in c.touched_files}
            if entry_bases & touched:
                cts = _as_naive(c.ts)
                # tz-safe: git commit ts is tz-aware, SLURM submit ts is naive.
                if submit and cts and cts > submit:
                    continue  # commit is after the run -> not the state that ran
                if best is None or (cts and _as_naive(best.ts) and cts > _as_naive(best.ts)):
                    best = c
        if best:
            # Repo-state-at-submit (latest commit touching the entrypoint at or
            # before submit) is a strong provenance signal; the time filter above
            # already excludes commits made after the run.
            prior = 0.9 if (jr.script_hash and best.sha.startswith(jr.script_hash[:7])) else 0.78
            out.append(Edge.make(
                jr.id, best.id, EdgeType.ran,
                confidence=prior, status=EdgeStatus.hypothesis,
                generator="candidate:repo-state-at-submit",
                rationale="Latest commit to the step's entrypoint at or before submit time.",
                evidence_spans=[EvidenceSpan(artifact=best.id, quote=best.message or best.sha)],
            ))
    return out


def _cand_jobrun_produced_by_step(graph: Graph) -> list[Edge]:
    """A JobRun is produced_by the PipelineStep whose parameters it ran with
    (via Param.step_ref), or that it shares an output path with, or -- failing
    both -- the sole step."""
    out: list[Edge] = []
    steps = [s for s in graph.nodes_of("pipeline_step") if isinstance(s, PipelineStep)]
    step_ids = {s.id for s in steps}
    if not steps:
        return out
    for jr in graph.nodes_of("job_run"):
        assert isinstance(jr, JobRun)
        matched = False
        # Strongest signal: the params this job ran with belong to a step's script.
        ran_steps = set()
        for pid in jr.params:
            p = graph.nodes.get(pid)
            if isinstance(p, Param) and p.step_ref in step_ids:
                ran_steps.add(p.step_ref)
        for sid in ran_steps:
            out.append(Edge.make(
                jr.id, sid, EdgeType.produced_by,
                confidence=0.9, status=EdgeStatus.hypothesis,
                generator="candidate:shared-params",
                rationale="Job ran with parameters defined by this step's script.",
            ))
            matched = True
        for s in steps:
            if set(jr.output_paths) & set(s.outputs):
                out.append(Edge.make(
                    jr.id, s.id, EdgeType.produced_by,
                    confidence=0.9, status=EdgeStatus.hypothesis,
                    generator="candidate:shared-output",
                    rationale="Job and step share an output path.",
                ))
                matched = True
        if not matched and len(steps) == 1:
            out.append(Edge.make(
                jr.id, steps[0].id, EdgeType.produced_by,
                confidence=0.6, status=EdgeStatus.hypothesis,
                generator="candidate:sole-step",
                rationale="Only one pipeline step is known in this repo.",
            ))
    return out


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _min_dt():
    from datetime import datetime
    return datetime.min


def _as_naive(dt):
    """Drop tzinfo so naive (SLURM ISO) and aware (Slack epoch) timestamps compare."""
    return dt.replace(tzinfo=None) if dt is not None and dt.tzinfo is not None else dt


def _trim(s: str, n: int) -> str:
    s = " ".join(s.split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _loose_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _value_needles(value: str) -> list[str]:
    """Distinctive literals to search for: the value itself, its basename, and any
    build-string component."""
    needles = {value}
    if "/" in value or "\\" in value:
        needles.add(os.path.basename(value))
        for m in re.findall(r"GRCh\d+|hg\d+|human_g1k_v\d+", value):
            needles.add(m)
    return [n for n in needles if n]


def _value_match_prior(hits: list[str]) -> float:
    """Rare/long literals are strong evidence; bare small integers are weak."""
    best = 0.0
    for h in hits:
        if re.fullmatch(r"\d{1,3}", h):
            best = max(best, 0.55)          # e.g. "20" -- common
        elif len(h) >= 4:
            best = max(best, 0.85)          # e.g. "GRCh37", a filename
        else:
            best = max(best, 0.65)
    return best


def _time_local(jobruns: Iterable[JobRun], d: Decision, days: int) -> bool:
    if not d.ts:
        return False
    dts = _as_naive(d.ts)
    for jr in jobruns:
        if jr.submit_ts and abs(_as_naive(jr.submit_ts) - dts) <= timedelta(days=days):
            return True
    return False


def _first_quote_containing(d: Decision, needle: str) -> str:
    for s in d.evidence_spans:
        if s.quote and needle.lower() in s.quote.lower():
            return _trim(s.quote, 240)
    return _trim(d.statement, 240)


def _paths_in(text: str) -> list[str]:
    return re.findall(r"[\w./-]+\.\w{2,5}", text)


def _path_cited(path: str, text: str) -> bool:
    """True if `text` cites this output file -- by full basename (sample01.vcf) OR
    by a distinctive stem (sample01), since papers often drop the extension."""
    t = text.lower()
    base = os.path.basename(path).lower()
    if base and base in t:
        return True
    stem = os.path.splitext(base)[0]
    return bool(stem and len(stem) >= 5 and re.search(rf"\b{re.escape(stem)}\b", t))


def _same_paper(a, b) -> bool:
    pa = a.provenance.path if a.provenance else None
    pb = b.provenance.path if b.provenance else None
    return bool(pa and pb and pa == pb)
