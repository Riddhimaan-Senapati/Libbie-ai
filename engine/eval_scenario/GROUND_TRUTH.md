# eval_scenario — ground-truth-by-construction edge evaluation

A larger, internally-consistent **synthetic computational-genomics lab scenario**
(project "cohortA", 2021) plus a hand-labelled gold edge set, built to satisfy
plan section 2: *"hand-label ~200 edges from one real pipeline. Precision/recall
per edge type. The only metric that matters pre-revenue."*

Because the artifacts **and** the labels were authored together, every gold label
is known-true or known-coincidental **by construction** — this is the point of a
synthetic set: there is no annotator uncertainty.

Nothing under `libbie_engine/**` was modified. The existing test suite and the
bundled `sample_data/` gold set are untouched (21 tests still pass).

---

## 1. The scenario

Four pipelines for one cohort, each with an sbatch entrypoint, `sacct` accounting
rows (multiple JobRuns, with realistic **param drift**), and `slurm-<jobid>.out`
logs carrying the exact CLI invocation + output paths + module lists.

| Pipeline | Step name | Runs | Key params | Output |
|---|---|---|---|---|
| Germline calling | `germline-call` | 51001, 51002 | reference GRCh38, `min-base-quality-score` **20 → 18** (drift), calling-confidence 30 | cohortA_sample01.vcf / sample02.vcf |
| RNA-seq quant | `rnaseq-quant` | 51010 | libType ISR, numBootstraps 100, threads 8 | rnaseq_sampleA_quant.sf |
| Variant annotation | `variant-annotate` | 51020 | cache-version 105, fork 4 | cohortA_annotated.vcf |
| Alignment QC | `align-qc` | 51030 | threads 4, by 500 | cohortA_qc_metrics.txt |

**People** (resolve across git email / Slack handle / paper author):
Priya Nair, Daniel Okafor, Sofia Ramirez, Wei Zhang (`@genomicslab.org`).

**Conversations** (`conversations/`):
- `slack/pipeline-genomics/2021-02-08.json` — chose GRCh38 + mbq 20.
- `slack/pipeline-genomics/2021-02-22.json` — lowered mbq 20 → 18 ("too strict").
- `slack/rnaseq/2021-02-10.json` — libType ISR, numBootstraps 100 (also mentions "105 samples" — a planted coincidence).
- `slack/annotation/2021-02-11.json` — pinned VEP cache 105.
- `slack/ops/2021-02-09.json` — **unrelated** thread: "30 day retention", "8 cores" (planted coincidences).
- `germline_handoff.eml`, `rnaseq_handoff.eml` — email handoffs justifying params.

**Literature** (`literature/`): three papers (germline, rnaseq, annotation), each
with several Claims (Results sentences with figure refs / numbers) and one Finding.
Claims cite output basenames/stems that path-match JobRun outputs.

**Repo** (`repo/`, a real `git init` fixture): commits authored with names/emails
matching the Slack/paper people, back-dated so germline commits straddle the
germline run submit times (02-09 before run1 @ 02-10; 02-20 before run2 @ 02-25).

---

## 2. Planted coincidences (the negatives)

- **Common integer in an unrelated thread:** calling-confidence `30` also appears
  as "30 day retention" in `#ops`; `threads 8` also appears as "8 cores". Neither
  should justify the param.
- **Value matching another pipeline's decision:** VEP `cache-version 105`
  coincides with "105 samples" in the rnaseq thread.
- **Rejected old value:** the 02-22 thread mentions `20` only as the value being
  *replaced* by 18 — so `mbq=20 → "too strict" decision` is wrong.
- **Context mention, not justification:** the VEP-cache decision mentions "GRCh38"
  in passing → `reference → cache decision` is wrong.
- **Cross-paper output citation:** each paper cites only its own output, so any
  `finding → job` link across papers is wrong.
- **Wrong side of time:** the 02-20 mbq-18 commit is after run1's 02-10 submit.

---

## 3. Gold set: 143 labelled edges (88 positive / 55 negative)

| edge type | pos | neg | total |
|---|---|---|---|
| used | 24 | 6 | 30 |
| sourced_from | 16 | 4 | 20 |
| justified_by | 10 | 7 | 17 |
| supported_by | 3 | 12 | 15 |
| contains | 11 | 3 | 14 |
| authored_by | 6 | 6 | 12 |
| wrote | 5 | 4 | 9 |
| appears_in | 3 | 4 | 7 |
| evidences | 4 | 3 | 7 |
| produced_by | 4 | 4 | 8 |
| ran | 2 | 2 | 4 |
| **total** | **88** | **55** | **143** |

(200 was the plan's aspiration; this scenario naturally yields ~143 meaningful,
non-duplicated edges across all 11 edge types. The count is honest, not padded.)

---

## 4. Measured precision / recall

Shipped **deterministic mock backend**, `commit_threshold = 0.75`,
`time_locality_days = 14`. Reproduce with:

```
.venv/Scripts/python.exe -m eval_scenario.run_eval
```

```
edge type                         P      R   TP   FP   FN
appears_in                     1.00   1.00    3    0    0
authored_by                    1.00   1.00    6    0    0
contains                       1.00   1.00   11    0    0
evidences                        -    0.00    0    0    4
justified_by                   0.77   1.00   10    3    0
produced_by                      -    0.00    0    0    4
ran                              -    0.00    0    0    2
sourced_from                   1.00   1.00   16    0    0
supported_by                   0.33   1.00    3    6    0
used                           1.00   1.00   24    0    0
wrote                          1.00   1.00    5    0    0
----------------------------------------------------
TOTAL                          0.90   0.89   78    9   10
```

The numbers are honest — they were **not** tuned to 1.0. Every FP/FN is a
documented, by-construction case (see §5).

---

## 5. Genuine engine limitations this richer data exposed

All are in the **as-shipped** engine; none were fixed (per task constraint).

1. **`ran` candidate generator crashes on any real git repo.**
   `libbie_engine/join/candidates.py:339` (and `:341`) compare
   `Commit.ts > jr.submit_ts` **without** normalising tz. Git commit timestamps
   are timezone-aware (`_coerce_dt` keeps the offset); SLURM `Submit` timestamps
   are naive. Every other datetime comparison in the module uses the `_as_naive()`
   helper — this function forgot. When any commit touches a file whose basename
   matches a pipeline entrypoint, the comparison raises
   `TypeError: can't compare offset-naive and offset-aware datetimes`, which
   propagates out of `generate_candidates` and **aborts the entire join** — so
   `libbie join` cannot complete on this (realistic) dataset. The bundled
   `sample_data` never triggers it only because the real Libbie repo has 11
   commits and none touch `germline_call.sbatch`. Fix: wrap both comparisons with
   `_as_naive(...)` as the rest of the module does.
   *(The measurement harness `run_eval.py` wraps only this generator in
   try/except so the other 10 types can be scored; `ran` never commits anyway —
   see #4.)*

2. **`ran` never commits even when it runs.** Prior is `0.7` unless
   `Commit.sha` starts with `JobRun.script_hash[:7]` — but `script_hash` is a
   SHA-1 of the sbatch text, unrelated to the git SHA, so the 0.9 branch is
   unreachable. `0.7 < 0.75` ⇒ hypothesis. `ran` recall is structurally 0.
   (candidates.py:344)

3. **`produced_by` is never generated with more than one pipeline step.**
   `_cand_jobrun_produced_by_step` (candidates.py:355) only fires the 0.9
   shared-output candidate when `set(jr.output_paths) & set(step.outputs)` is
   non-empty — but the SLURM ingester **never populates `PipelineStep.outputs`**
   (`slurm.py` builds every `PipelineStep` with an empty `outputs`). The only
   other branch (0.6 sole-step fallback) requires exactly one step *and* 0.6 is
   below threshold anyway. With 4 steps, **zero** produced_by candidates are
   emitted ⇒ recall 0. Fix: populate `PipelineStep.outputs` at ingest, or match
   JobRun→Step by job-name/script-hash.

4. **`evidences` never commits.** Same-paper Claim→Finding candidates get a fixed
   prior of `0.7` (candidates.py:318) < `0.75` ⇒ always hypothesis. Recall 0 for
   a relationship that is certain-by-construction (the claim and finding are
   parsed from the same document). Fix: raise the prior for same-paper evidence,
   or treat it as a certain edge.

5. **`supported_by` over-links across unrelated papers (precision 0.33).**
   `_cand_finding_supported_by_jobrun` (candidates.py:281) links a Finding to a
   JobRun if that run wrote *any* file cited by *any* claim in the whole corpus —
   not just claims in the finding's own paper. With 3 papers × 3 cited runs it
   emits 9 edges (all committed at 0.8), only the 3 diagonal ones correct ⇒ 6
   false positives. Fix: scope the citation check to claims of the finding's own
   paper (via shared provenance path).

6. **`justified_by` value-identity has no semantics (precision 0.77).** Three
   genuine false positives, all committed:
   - `reference → VEP-cache decision` — the decision only *mentions* "GRCh38".
   - `mbq=20 → "too strict" decision` — that decision cites 20 as the *rejected*
     old value while choosing 18.
   - `output path → email` — a filename appearing in a handoff email is not a
     parameter justification.
   The value-identity + time-locality heuristic (candidates.py:206) can't tell a
   *chosen* value from a *mentioned* or *rejected* one. (The bare-integer prior of
   0.55 correctly keeps the pure coincidences — `30`/`8`/`105` in unrelated
   threads — below threshold, which is why precision is 0.77 and not worse.)

7. **Minor: SLURM run owners all collapse to one `person:unknown` node.**
   `slurm.py:761` calls `person_node(handle=owner)` with no email/name, so
   `canonical_person_id()` returns `person:unknown` for *every* owner. Harmless
   for this eval (authored_by uses git email identities) but means the run-owner
   Person is unusable for resolution. Pre-existing; present in `sample_data` too.

---

## 6. Files

```
eval_scenario/
  hpc/            germline_call.sbatch, rnaseq_quant.sbatch, variant_annotate.sbatch,
                  align_qc.sbatch, sacct.txt, slurm-5100{1,2}.out, slurm-510{10,20,30}.out
  conversations/  slack/users.json, slack/<channel>/<date>.json (5 threads),
                  germline_handoff.eml, rnaseq_handoff.eml
  literature/     nair2021_germline.txt, ramirez2021_rnaseq.txt, okafor2021_annotation.txt
  repo/           git fixture (7 authored, back-dated commits)
  gold_edges.json 143 labelled edges
  eval_config.yaml  mock backend + isolated store
  run_eval.py     reproducible end-to-end measurement harness
  GROUND_TRUTH.md this file
```
