# PR 1: engine

The Python provenance engine. Goal: measured speedups on ingest and join, about −460 LOC, fewer
dependencies. Gate before merge: `./.venv/Scripts/python -m pytest -q` (58 tests at the time of
writing).

Context numbers. `libbie_engine` is 5,982 LOC across 31 files. Tests are 1,004 LOC across 9
files. The suite passes in 13.2 s.

## Work items

### 1. Make git ingest subprocess-only

- **Evidence.** `ingest/git_ingest.py:139-236` (`_ingest_with_gitpython`). For each commit,
  `commit.stats` at line 192 spawns a separate `git` subprocess. Measured on the same repo and
  same 352 nodes: GitPython path 2.81 s, `_ingest_with_subprocess` (one `git log --name-only`
  call, lines 245-352) 0.07 s. At the 500-commit cap the GitPython path extrapolates past 40 s.
- **Change.** Delete `_ingest_with_gitpython` and the GitPython import. Keep the subprocess path
  as the only path.
- **Payoff.** 40× on this ingest step. −100 LOC. Removes GitPython from `[git]` extra.
- **Keep green.** `test_ingest.py` asserts node kinds on the sample repo; it runs through the
  subprocess path already.

### 2. Index `Graph.add_edge`

- **Evidence.** `models.py:263-271` does a linear scan of `self.edges` per insert, so bulk joins
  are O(E²). Measured: 2,000 inserts on a 2,590-edge graph took 0.50 s. In the sample join,
  `add_edge` is already 39% of join time (858 calls, 21 ms of 54 ms).
- **Change.** Maintain a `dict[(src, dst, type)] -> index` alongside the edge list. Rebuild it
  lazily after `model_validate`. Keep the "higher-confidence edge wins" dedup semantics.
- **Keep green.** `test_models.py:32-39` pins the dedup semantics.

### 3. Batch `ArtifactStore` flushes

- **Evidence.** `store/artifacts.py:52` calls `_flush()` per `put`; `_flush` (lines 74-77)
  pretty-prints the whole index every time. Measured: 300 puts took 954 ms, quadratic. Ingest
  calls `put` per file, log, and commit message.
- **Change.** Flush on an explicit `close()` or context-manager exit, or after N dirty puts.
  Write the index without `indent=2`.
- **Payoff.** ~100× on artifact writes. About 10 lines change.

### 4. Fix the join candidate generators

All in `join/candidates.py`. The sample graph is small (17 candidates), so these are scaling
fixes, not today's bug.

- `entry_bases` is recomputed inside the per-JobRun loop at lines 335-337. Hoist it out.
- `_cand_param_justified_by_decision` (lines 206-245) lowercases one big `hay` string once per
  needle per (Param, Decision) pair. Lowercase once per decision instead.
- `_cand_output_path_identity`, `_cand_finding_supported_by_jobrun`, and
  `_cand_claim_evidences_finding` (lines 255-324) do nested scans over paths, job runs, findings,
  and claims. Pre-index by basename, path, and paper path once per run.
- **Keep green.** The mock backend pins join outputs in `test_join_and_briefing.py`; candidate
  priors must not change.

### 5. Stop full-graph scans in briefing and eval

- `briefing/generate.py:304-311` scans all Person nodes per call, called per commit, message,
  and participant. Build one `email -> person_id` dict at the top of `generate_briefing`.
- `briefing/generate.py:85,149,162` runs `graph.out_edges(...)` (a full edge scan,
  `models.py:276-280`) inside per-jobrun and per-param loops. Group edges by `src` once.
- `evaluation.py:112-118` scans all edges per gold edge, and `_text_of` (lines 27-34) calls
  `node.model_dump(exclude_none=True)` per node per edge. Pre-dump node text once.
- `join/scoring.py:54-65` calls `model_dump` twice per candidate edge. Cache per node id.

### 6. Deduplicate shared helpers

All duplications verified by reading both sides.

- **Token storage.** `github.py:355-413` and `slack.py:483-541` hold identical keyring-or-file
  logic, ~60 LOC each. Extract one `credentials.py`. Both modules lose ~55 lines.
- **Address and body helpers.** `_first_address` (`ingest/conversation.py:278`,
  `email_ingest.py:77`), `_eml_body_text` vs `_body_text` (`conversation.py:294`,
  `email_ingest.py:99`), `_slack_user_email` vs `_user_email` (`conversation.py:103`,
  `slack.py:364`).
- **Text and datetime helpers.** `_trim`, `_min_dt`/`_min`, `_as_naive`/`_naive` appear in both
  `join/candidates.py` (lines 412-422) and `briefing/generate.py` (lines 339-349). One
  `textutil.py` kills six duplicates.
- **CLI boilerplate.** The load-graph → add-nodes → annotate → save → echo block repeats 6 times
  in `cli.py` (lines 87-96, 266-275, 388-396, 444-450, 482-487, 63-96). One `_persist_nodes`
  helper saves ~40 LOC.
- **Keep green.** The timezone regression test at `test_join_and_briefing.py:54-76` pins
  `_as_naive` behavior; the shared helper must keep it.

### 7. Delete dead code

- `join/candidates.py:472-473` `_paths_in`: defined, never called.
- `pyproject.toml:35` `sentence-transformers`: declared, never imported.
- `llm/local.py:77-80` `_schema_hint`: one-line wrapper over `json.dumps` with one caller.
  Inline it.
- The GitPython path (item 1): −100 LOC more.

### 8. Dependency changes

- Remove `GitPython` and `sentence-transformers`.
- Declare `keyring` as an extra (suggested name `[secrets]`). It is already imported at
  `github.py:365,385,403` and `slack.py:493,513,531`.
- Add `msgspec`. Use `msgspec.json` in `store/graph.py:25,30` and `store/artifacts.py:75` in
  place of stdlib `json`. pydantic stays the schema layer; only serialization moves.
- Optional: add `rapidfuzz` for the hand-rolled name match at `join/candidates.py:55-63`.
- Optional: swap `pypdf` for `pypdfium2` at `ingest/literature.py:63` for 5-10× PDF extraction.

### 9. Parallelize adjudication

- **Evidence.** `join/scoring.py:96-123` does one blocking `backend.complete()` HTTP round trip
  per candidate edge.
- **Change.** For the `api` and `local` backends, run completions on a
  `concurrent.futures.ThreadPoolExecutor` with 4-8 workers. Keep the `mock` backend synchronous
  and deterministic. No new dependency.
- **Payoff.** Join wall time drops roughly by the worker count when the backend is a real LLM.

### 10. Connector I/O fixes

- `email_ingest.py:405-407` fetches each Gmail message with its own `.get().execute()`. Use the
  client's batch request support.
- `email_ingest.py:227-246` does one IMAP `FETCH num (RFC822)` per message. Use a single range
  `FETCH 1:N (RFC822.PEEK[])`.
- `slack.py:156` constructs a new `WebClient` per API call inside `_call`. Build one client per
  ingest run.
- `cli.py:253-258` re-clones the GitHub repo on every run. For repeat ingests, use
  `git fetch --depth 1 origin <branch>` plus `git reset --hard FETCH_HEAD`.

### 11. Memory fixes

- `ingest/slurm.py:466,569-577` keeps each full log's text on `_LogInfo.text`, but only
  `params`, `output_paths`, `build`, and `modules` are read afterwards (lines 715-737). Drop the
  text after `_parse_log` returns.
- `join/candidates.py:168-171` attaches a full-message `EvidenceSpan` per message per decision
  thread. Cap or trim.
- Slack, Gmail, and IMAP ingest have no caps. Add a bounded max-messages setting, matching the
  existing `MAX_COMMITS = 500` precedent in `git_ingest.py:36`.
- `ingest/slurm.py:451-453,770-771` smuggles fields through `run.__dict__["_job_name"]` on a
  pydantic model. Use `PrivateAttr` or return `(run, meta)` tuples.

### 12. Halve the test suite

- **Evidence.** `conftest.py:31-62` builds the graph twice: the `ingested` and `built` fixtures
  each run all four ingesters, including git ingest on the real repo. Fixture setups cost 5.76 s
  and 3.28 s of the 13.2 s total.
- **Change.** Derive `built` from a deep copy of `ingested` via `model_copy(deep=True)`, the
  pattern already used at `test_backends_integration.py:118`.
- **Payoff.** With item 1 done, the suite drops to ~1 s.

## Out of scope

- Rewriting `models.py` to msgspec Struct. The serializer swap in item 8 gets most of the win
  without touching the contract.
- Adding numpy or a graph library. Nothing numerically heavy or algorithmic exists to justify
  either.

## Order inside the PR

Items 1-5 are the measured wins, in impact order. Items 6-8 shrink the code and the dependency
tree. Items 9-11 matter against real (non-mock) backends and large mailboxes. Item 12 makes every
later PR faster to iterate on.
