# Next steps — handoff backlog

State as of **v0.1.0** (2026-07-19), updated after the cross-surface optimization pass
(2026-09-06, [`optimization/README.md`](optimization/README.md)). Read [`../CLAUDE.md`](../CLAUDE.md)
first for how to build/test and the invariants. This is the prioritized backlog; each item says
*what*, *why*, *where*, and *how to approach*. Nothing here is a known-broken regression — these
are the honest gaps.

## Ground truth: what is real vs. staged
- **Real** (engine + desktop): ingest → join → graph → briefing; local + cloud (OpenAI-compatible +
  Anthropic) inference; HuggingFace model download; token/cost tracking; GitHub/Slack/Gmail/IMAP
  connectors; the provenance knowledge-graph view. 60 engine tests, 50 desktop Rust tests, all
  builds green, CI green on `main`.
- **Staged sample data**: the `libbie/` `/demo` web app (authored fixtures, labeled in the UI). The
  connectors/graph are showcased there as product capabilities, not run live in the browser.
- **Not exercised in default runs**: the LLM `api`/`local` backends work and are integration-tested
  against a mock HTTP transport, but precision has only been measured with the offline `mock`.

## P0 — highest leverage

1. **Measure real join precision with a live LLM backend.**
   *Why:* the semantic edge types (`evidences`, `justified_by`) score below the commit threshold or
   over-commit under the `mock` (mock is value-identity only). The plan's thesis is "adjudicate over
   the API." *Where:* `engine/libbie_engine/join/scoring.py`, `llm/{api,local}.py`, run over
   `engine/eval_scenario/`. *How:* set `llm.backend: api` (+ `$ANTHROPIC_API_KEY`) in `config.yaml`,
   run `libbie join && libbie eval`, and record the P/R delta vs mock and vs a local vLLM. Publish the
   number in `IMPLEMENTATION_REPORT.md`.

2. **Grow the gold eval to ~200 edges from a real pipeline.**
   *Why:* `eval_scenario/gold_edges.json` is ~143 synthetic edges; the plan wants ~200 hand-labeled
   from one real pipeline with per-type negatives. *Where:* `engine/eval_scenario/`. *How:* ingest a
   real repo/Slack/email set (or extend the synthetic scenario), hand-label, keep the negatives.

3. **Code-sign the desktop installers.**
   *Why:* v0.1.0 installers are unsigned → Windows SmartScreen + macOS Gatekeeper warnings. *Where:*
   `.github/workflows/release.yml`. *How:* add Apple Developer ID cert + notarization
   (`APPLE_CERTIFICATE`, `APPLE_ID`, team id) and a Windows Authenticode cert as repo secrets; tauri-action
   supports both via env. Scaffolding can go in before the certs exist.

## P1 — connectors & data quality

4. **Incremental / multi-source indexing (desktop).**
   *Why:* `embed_and_index` **resets** the vector store each run (shared by GitHub/Slack/Email/build),
   so only the most-recently-indexed source is searchable. *Where:* `desktop/src-tauri/src/commands.rs`
   (`embed_and_index`), `vecstore.rs`. *How:* append + namespace chunks by source/`conv_id` instead of
   reset; add an incremental sync (Slack `oldest` cursor, Gmail `historyId`, IMAP UIDs already partly
   supported) so re-connecting only pulls new messages.

5. **Migrate desktop secrets to the OS keyring.**
   *Why:* tokens/keys are redacted from the webview but stored in `config.json` plaintext on disk.
   *Where:* `desktop/src-tauri/src/config.rs`. *How:* use the `keyring` crate (MIT/Apache) with a
   platform backend feature; keep config.json for non-secret fields. (Engine already prefers keyring.)

6. **Literature ingest depth (engine).**
   *Why:* claim/param extraction is rule-based; the plan calls the Methods section the "cheapest join
   surface." *Where:* `engine/libbie_engine/ingest/literature.py`, `join/candidates.py`. *How:* add a
   Methods-section parameter parser and an external-PDF → `contextualizes` candidate.

7. **Real Lazarus, or rename it.**
   *Why:* `engine/libbie_engine/lazarus.py` is a transparent heuristic, not the actual
   environment-revival tool (the PyPI `lazarus` is unrelated). *Where:* `lazarus.py`. *How:* wire the
   real ENCODE/Torch7 revival tool behind the existing external-CLI hook, or rename to
   `environment_probe` so the name isn't misleading.

## P2 — polish & scale

8. **Engine↔desktop unification.** Desktop connectors do RAG-only; the engine builds the full
   provenance graph. Consider having the desktop drive the engine (subprocess or shared lib) so desktop
   users get provenance + briefings, not just retrieval.
9. **Graph DB.** `store/graph.py` is JSON (the plan permits this early). Move to Postgres + pgvector +
   recursive CTEs when graphs outgrow memory.
10. **Briefing synthesis via LLM.** `briefing/generate.py` is deterministic graph-walk markdown; route
    prose through the backend for the "generated" feel while keeping §7 honest-gaps.
11. **Person alias resolution.** Heuristic (first-initial + lastname) in `join/candidates.py`; improve
    with the LLM adjudicator or embeddings.
12. **Add an engine CI job.** `ci.yml` covers Rust + the two web apps but not `pytest`. Add a Python job
    so engine regressions are caught in CI.
13. **RAG prompt-injection hardening.** Indexed Slack/email/repo content is untrusted; delimit it
    clearly as data in the system prompt and never let model output drive a privileged IPC call.
14. **CI action deprecation.** Runs warn that `actions/checkout@v4`/`setup-node@v4` target Node 20 (now
    forced to 24). Bump when convenient.
15. **Bundle a `llama-server` sidecar** for a self-contained installer (see `desktop/BUILD_SPEC.md` §8.1).

## Deferred from the optimization pass

Verified and skipped on purpose, recorded in [`optimization/README.md`](optimization/README.md)
("Skipped from scope"). Any of these can be its own small PR.

- **pypdfium2** for PDF extraction (engine, 5-10× faster). Needs a test on the extraction path first.
- **rapidfuzz** for person resolution (engine). Changes match semantics the join tests pin.
- **ts-rs** to generate the TS `AppConfig` (desktop). Kills the `devConfig()` drift. Needs build + CI wiring.
- **Split `tauri.ts` and `Settings.tsx`** (desktop). Pure structure; do it when either file is next edited.
- **`next/font/local`** (web). Vendor the woff2 files so CI builds stop fetching Google Fonts.
- **Measure installer size** against the new `[profile.release]` (desktop). The profile is in; the
  −20-35% prediction is unverified until the next CI release build.
- **`mimalloc` as the Rust global allocator** (desktop). Unmeasured experiment; measure before/after.

## Operator setup a new session should know is required for live use
- **GitHub**: register an OAuth App (device flow) → `LIBBIE_GITHUB_CLIENT_ID`.
- **Slack**: register a Slack app; OAuth needs a client id/secret + a FIXED registered loopback redirect
  (`http://localhost:3118/callback`); token-paste (`xoxp-`) sidesteps this.
- **Gmail**: register a Google "installed app" OAuth client → `LIBBIE_GMAIL_CLIENT_ID`/`_SECRET`.
- **IMAP**: host + app password.
None of these secrets live in the repo; they come from config/env at runtime.
