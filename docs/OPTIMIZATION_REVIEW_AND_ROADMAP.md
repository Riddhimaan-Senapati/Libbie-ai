# Libbie.ai — Adversarial Optimization Review and Evidence-Based Roadmap

**Review date:** 2026-08-03  
**Scope:** `engine/`, `desktop/`, `libbie/`, shared demo data, build/test configuration, and the product constraints in `main_plan.md`, `mvp_plan.md`, `Libbie.ai_MVP_PRD.md`, `NEXT_STEPS.md`, `IMPLEMENTATION_REPORT.md`, `TESTING.md`, `desktop/BUILD_SPEC.md`, `libbie/CONTRACT.md`, and `libbie/REDESIGN.md`.

This is a follow-up to [`OPTIMIZATION_PLAN.md`](OPTIMIZATION_PLAN.md). It starts by trying to disprove that plan's claims, then replaces its priority order with work tied to measured correctness, payload, latency, and user experience. It does not propose replacing the authored web demo with a live backend, relaxing the air-gap guarantees, or changing the dual-citation product contract.

## Implementation status (2026-08-04)

Completed: source-scoped transactional indexing; one-embedding semantic retrieval; lazy desktop Settings and Graph surfaces; explicit local Latin WOFF2 fonts; staged-demo cancellation and disclosure; mobile source-preview compaction; `/demo` loading/error boundaries; engine CI with offline smoke coverage; and removal of unused `networkx` plus two unreferenced logo assets.

Measured after the desktop changes: initial JavaScript is **437.55 kB minified / 137.02 kB gzip**; Settings is **45.91 kB**, and Graph is split into **327.63 kB** plus a **194.97 kB** renderer chunk. The graph, Gmail batching, connector checkpoints, broad monolith splits, and profiling-gated changes remain future measured work rather than being folded into this implementation.

## Executive verdict

The existing plan is directionally strong, but it mixes four different kinds of work under one ranking:

1. correctness fixes that happen to improve speed;
2. measured payload or latency reductions;
3. maintainability refactors with no demonstrated runtime effect; and
4. speculative optimizations that need profiling first.

That makes some low-value cleanup look more urgent than a real data-loss behavior. The highest-priority issue is not dead React code: it is `embed_and_index()` resetting the only vector table every time a source is indexed. Today, indexing GitHub after Slack can erase Slack retrieval. Treat that as a P0 correctness and product-trust defect, not merely a performance improvement.

The second highest-priority issue is the retrieval API shape. A semantic query is embedded exactly twice—once for the code KNN leg and once for the conversation KNN leg—because the UI invokes `vector_search` twice. Replace those calls with one Rust command that embeds once and performs both filtered KNN searches. A general cache is unnecessary for the first fix.

The strongest measured frontend opportunity is the desktop webview. Its production build emits a single **1,006.83 kB minified / 249.68 kB gzip** JavaScript chunk and Vite's large-chunk warning. The same build ships WOFF and WOFF2 files for Latin, Latin Extended, Vietnamese, Greek, and Cyrillic despite the product currently presenting English UI. Lazy-loading the graph and settings surfaces, plus importing only required font subsets, is more defensible than blanket `React.memo` work.

The web demo is functionally convincing and accessible in the tested flows, but two UX/trust gaps deserve explicit work:

- the staged web demo can display **“Answered locally”** after an artificial timeout even though no local model ran; and
- `DemoPage.askAnswer()` returns a timeout cleanup function that no caller uses, so two rapid questions can race and allow the older timer to overwrite the newer answer.

## Evidence collected

### Repository and build baseline

| Surface | Size observed | Verification result | Notable measurement |
|---|---:|---|---|
| `libbie/` | 61 source files, ~7,267 lines | ESLint and Next.js production build pass | Compile 72 s; TypeScript 94 s; all routes statically rendered |
| `desktop/` | 46 source files, ~12,990 lines | 24/24 Vitest tests; TypeScript and Vite build pass | 1,006.83 kB main JS, 249.68 kB gzip; Vite large-chunk warning |
| Rust core | included above | fmt, clippy with warnings denied, and 47/47 tests pass | cold check sequence took ~7.5 min; tests themselves took 0.20 s after compilation |
| `engine/` | 39 source/test files, ~6,986 lines | 58/58 pytest tests; 12/12 smoke checks | larger eval remains precision 0.97 / recall 0.95 |

The first pytest run produced 12 setup errors because the sandboxed user temp directory was unreadable. Re-running with `--basetemp` inside the writable workspace produced 58/58 passes. This is environment evidence, not a product failure.

### Browser QA

The requested `agent-browser` 0.33.2 CLI and its `core` and `dogfood` workflows were loaded. Its offline doctor found Chrome, but managed launch failed with `CDP response channel closed`; manual headless Chrome attachment also hung. The CLI therefore produced no valid interaction evidence. The in-app browser was used as a clearly identified fallback rather than presenting source inspection as browser testing.

The fallback browser exercised:

- landing navigation and content;
- the `/demo` reading intro (about 1.9 seconds after DOM ready in one measured run);
- opening Ask Libbie;
- an unmatched question and its canonical-question recovery UI;
- the GRCh37 dual-citation answer;
- technical-to-VP audience switching;
- the staleness watchlist;
- handover generation;
- the “air-gapped” MAPQ answer;
- a 390 × 844 viewport; and
- console warning/error inspection.

No browser warnings or errors were emitted. The principal flows worked. The handover dialog generated its document, but the browser harness did not observe a download event from the Blob-backed anchor, so the actual file transfer is **inconclusive**, not failed.

At 390 × 844, the app remains usable, but the code canvas needs horizontal and vertical scrolling before the user reaches Libbie's answer. The palette fits well. Mobile optimization should reduce the code viewport height and add a focused “cited line” mode after an answer rather than trying to make full source code wrap.

## Adversarial review of `OPTIMIZATION_PLAN.md`

### Claims to retain or promote

| Existing claim | Verdict | Evidence and correction |
|---|---|---|
| Make indexing incremental | **Confirmed; promote to P0 correctness** | `commands.rs:342` calls `vec.reset(dim)` for every build and connector index. This erases prior sources, not just time. Add source-scoped replacement and a transaction before calling it an optimization. |
| Lazy-load the desktop graph | **Confirmed and measured** | `GraphView.tsx` statically imports a ~403 kB JSON fixture and the force-graph dependency. The desktop build has one 1 MB minified chunk. Make the entire graph surface a dynamic chunk, including its fixture. |
| Trim desktop fonts | **Confirmed and measured** | The production build ships both WOFF and WOFF2 plus unused language subsets. Import `latin-400/500/600/700.css`-style subset entry points or equivalent package-supported subset files, then compare output. |
| Remove the two 3.97 MB logo PNGs if truly unused | **Confirmed** | Both `libbie/public/libbie_logo.png` and `desktop/public/libbie_logo.png` are 3,970,241 bytes. No rendered component references them. Removal reduces shipped/static artifacts even though it does not reduce JS. |
| Remove `networkx` | **Confirmed** | It is declared and documented but never imported. Remove the dependency and correct the comments/README in the same change. |
| Split `Settings.tsx` and `commands.rs` | **Confirmed as maintainability work** | At 1,891 and 1,622 lines, respectively, both impose high review and change-collision costs. Split by feature boundary; do not claim runtime gains until settings/connector panels are actually lazy-loaded. |
| Fix contract/theme/font drift | **Confirmed** | The contracts specify warmed dark plus Fraunces/Geist; the code explicitly declares a Benchling-style light theme and maps both display and sans to Hanken Grotesk. Decide which is canonical and update either code or contracts. |
| Pin Sonner to the actual theme | **Confirmed** | `sonner.tsx` calls `useTheme()` without a `ThemeProvider`, so its default can follow system state while the app is explicitly light. Pin `theme="light"` or provide a real theme contract. |
| Add engine CI | **Confirmed** | CI gates Rust and both TypeScript surfaces but has no Python job. The documented engine invariant is otherwise only local. |

### Claims that need revision

| Existing claim | Revised conclusion |
|---|---|
| “Delete dead demo code for a slimmer `/demo` chunk.” | The dead cluster is genuinely unreachable and worth deleting—about 1,470 component lines before orphan primitive cleanup—but unreachable modules are already excluded from the route graph. Deletion reduces repository size and cognitive load, not the current `/demo` chunk. Measure bundle output before claiming payload savings. |
| “One shared cited-code renderer replaces three copies.” | One of the three copies is in the dead pre-redesign cluster. Delete dead code first; then evaluate whether the two live renderers have sufficiently identical interaction and accessibility needs to share a low-level line renderer without over-generalizing. |
| “Remove `embed()` and the embedding backend.” | There are zero production callers in the Python engine, so the optional `sentence-transformers` installation can be removed or documented as experimental. Removing the backend interface itself conflicts with the main plan's future hybrid retrieval/provider abstraction. Keep the contract unless the architecture is deliberately narrowed. |
| “Cache the query embedding because it is embedded 2–4 times.” | The current Tauri path embeds the query **exactly twice**: two `vector_search` IPC calls, each embedding once. Prefer one `retrieve_vector` Rust command that embeds once and runs two filtered KNN queries. Add a cache only if profiling later finds repeated identical queries worth the invalidation and privacy surface. |
| “Batch Gmail with `messages.batchGet`.” | Gmail exposes multipart HTTP batching, but not a `users.messages.batchGet` method. Use a standards-compliant multipart batch request, or a small bounded-concurrency pool with quota-aware backoff. Do not implement a nonexistent endpoint. See the [Gmail batching guide](https://developers.google.com/workspace/gmail/api/guides/batch). |
| “Collapse seven boot state updates into one state object.” | The boot code resolves several independent promises. A composite state may reduce commits, but React 19 scheduling makes the benefit context-dependent and a larger object can broaden invalidation. Profile render commits first; prioritize fewer IPC calls or one Rust boot-snapshot command if boot latency is actually material. |
| “Add `React.memo` to fix per-token jank.” | Plausible, not demonstrated. First throttle token presentation to animation frames or 30–60 Hz and profile. Memoize only components shown to rerender with stable props. React documents `memo` as a bailout, not a guarantee; unnecessary memoization increases complexity. |
| “Turn all graph scans from O(n²) to O(n).” | Some repeated `nodes_of()` calls and person lookups are clear constant-factor opportunities, but the plan does not provide a representative graph benchmark. Add a 1k/10k/100k-node benchmark and optimize the observed hot paths; do not make an unmeasured refactor part of the first performance sprint. |
| “Credential extraction is green/low risk.” | The duplication is real, but token paths, keyring service/account names, file permissions, and fallback semantics are security-sensitive. Mark this yellow and require round-trip/migration tests for GitHub and Slack. |
| “RiskPanel is 90–120 kB gzip on `/demo`.” | Lazy loading is consistent with current [Next.js guidance](https://github.com/vercel/next.js/blob/v16.2.9/docs/01-app/02-guides/lazy-loading.mdx), but the plan states an estimate rather than a measured route delta. Capture a bundle analyzer/baseline before and after. |

### Claims to reject

1. **“The live engine suite is 51 tests.”** The current suite collects and passes **58** tests. `IMPLEMENTATION_REPORT.md` is correct on this point; the optimization plan is stale.
2. **Dead code removal cannot by itself slim a chunk that never imported that code.** Keep the cleanup, remove the payload claim.
3. **There is no Gmail `messages.batchGet` API method.** Use HTTP batching or bounded concurrency.
4. **A general query-embedding cache is not the smallest solution.** One IPC command and one embedding is simpler, deterministic, and avoids cache lifetime questions.
5. **“Seven state setters” is not evidence of seven visible renders.** Measure commits before restructuring state.

## New prioritized roadmap

### P0 — correctness, trust, and measured latency

#### 1. Make the vector index multi-source, incremental, and transactional

**Why first:** current behavior can silently remove previously indexed evidence. That directly undermines the product's “read everything” promise.

Design:

- Add stable `source_id` and `chunk_id` columns. A chunk ID should be derived from source namespace + stable remote ID/path + content hash, not insertion order.
- Replace all chunks for one source inside a transaction: stage new rows, validate embedding dimension/count, then delete stale rows for that source and commit the replacement.
- Never drop the global table during ordinary indexing. Rebuild only for an explicit schema/embedding-model migration.
- Store the embedding model ID and dimension in metadata. Reject or migrate incompatible writes instead of resetting implicitly.
- Add connector checkpoints separately from vector data (`Slack oldest/cursor`, Gmail `historyId`, IMAP UID validity/UID, Git commit/ref).

Acceptance tests:

- index GitHub, then Slack, then email; all three remain retrievable;
- re-index Slack with one changed and one removed message; only that source changes;
- fail embedding halfway through; the previous index remains intact;
- change dimension/model; the app requests a rebuild rather than erasing silently;
- index the same source twice; row count does not double.

#### 2. Embed each query once

Replace two UI calls:

```text
vector_search(query, code)
vector_search(query, conversation)
```

with one command:

```text
retrieve_vector(query, code_k, conversation_k)
  -> { code_hits, conversation_hits }
```

Rust embeds once and executes two KNN statements against the same vector. Add an integration test asserting one embedding HTTP request per user question. This halves query-embedding network/compute work without a cache or new dependency.

#### 3. Split the desktop boot bundle using existing platform features

Start with the largest optional surfaces:

- `GraphView` + `react-force-graph-2d` + `sample-graph.json`;
- `Settings` and its GitHub/Slack/Gmail/IMAP/Hugging Face panels;
- token details if the profiler shows it contributes meaningfully.

Use React `lazy`/`Suspense` or Vite-supported dynamic `import()`. Do not add a routing or state library. Establish budgets in CI:

- initial desktop JS: target **<700 kB minified and <180 kB gzip** in the first pass;
- no single optional chunk >500 kB minified;
- graph fixture loaded only when Graph opens;
- settings connector code loaded only when Settings opens.

The targets are initial guardrails, not permanent product SLOs; revise them after measuring on a low-end Windows laptop.

#### 4. Fix staged-local disclosure and answer races in the web demo

- On the authored web route, say **“Simulated on-device answer · sample data”** or remove the claim that an actual local engine answered. Preserve the separate desktop proof of real air-gapped inference.
- Replace the unused timeout-return pattern in `askAnswer()` with a `pendingTimerRef`, clear it before starting another answer, and clear it on unmount.
- Disable or explicitly cancel/replace the current answer when another question is chosen during the 900/1,200 ms staged delay.
- Add a fake-timer test: choose A, immediately choose B, advance timers, and assert only B renders.

#### 5. Put the Python invariant in CI

Add a Python job using the locked supported version range, `pip install -e ".[dev,git,connectors]"`, `pytest`, and the offline smoke test. Keep the larger eval either in CI if stable enough or as a scheduled/manual job with its P/R threshold recorded.

### P1 — payload, mobile UX, and development simplicity

#### 6. Remove confirmed baggage, with honest expected effects

- Delete the unreachable pre-redesign demo cluster and then remove UI primitives with zero remaining importers.
- Remove the unused `networkx` dependency and stale documentation around it.
- Remove `zod` as a direct application dependency if it remains unused; expect it to remain transitively if the shadcn CSS/CLI package still requires it.
- Remove unused starter SVGs and both 3.97 MB PNG logos.
- Pin Sonner to the actual light theme and remove `next-themes` if nothing else needs it.
- Preserve `@base-ui/react`, Motion, Recharts, and shadcn CSS where they are actually imported.

Track two outcomes separately: source lines removed and shipped bytes removed. Do not combine them into one percentage.

#### 7. Import only the font files the desktop ships

The desktop imports broad `@fontsource` family entry points, which expand into multiple scripts and both WOFF generations. Switch to explicit Latin WOFF2 subset imports for only the used weights. Verify:

- the UI remains offline;
- no layout shift appears on cold start;
- code glyphs used in fixtures (`≥`, arrows, punctuation) remain present;
- the production font asset total drops materially.

Do not remove glyph ranges solely by assuming ASCII.

#### 8. Improve the mobile answer transition

At narrow widths, the full code canvas consumes most of the first viewport and requires two-axis scrolling. After an answer:

- collapse the source canvas to a compact cited-line card or scroll the answer rail into view;
- keep “Open pipeline files” and Ask Libbie fixed and reachable;
- provide an explicit “View full file” expansion instead of wrapping code;
- test at 320, 390, and 430 px widths with long source lines and 200% text zoom.

#### 9. Add route/error/loading boundaries to the web demo

There is no `loading.tsx` or `error.tsx`. Next.js 16 already performs route-based splitting and recommends lazy loading optional client components. Add a small `/demo` loading boundary and an error boundary that keeps the sample-data disclosure and offers a retry. Lazy-load Recharts only when the risk sheet opens, and record the before/after route chunks instead of relying on estimated library size.

#### 10. Correct the handover download feedback contract

The Blob implementation is conventional, but the browser harness could not observe the download event while the UI would immediately show success. Delay the success toast until the click is dispatched and add an end-to-end test in a browser runner that supports download events. If Safari/WebView compatibility matters, revoke the object URL on the next task rather than immediately after `click()`.

### P2 — scaling and maintainability after profiling

#### 11. Split monoliths at domain boundaries

- `Settings.tsx`: provider, local engine, model download, GitHub, Slack, Gmail, IMAP.
- `commands.rs`: index lifecycle, model download, and one module per connector.
- `tauri.ts`: engine, inference, indexing, and connector clients.
- `App.tsx`: boot state, inference session, and navigation overlays as hooks/components.

Keep IPC command names and serialized error shapes stable. A line-count drop is not success by itself; success is smaller review scope, targeted tests, and optional chunks that load on demand.

#### 12. Batch Gmail correctly

Choose one implementation after a quota/load test:

- Gmail multipart HTTP batch requests; or
- `tokio` bounded concurrency (start around 5–8), with exponential backoff/jitter and explicit handling for 429/403 quota responses.

The Gmail documentation warns that excessive concurrent and large batch requests can themselves trigger 429s. Benchmark 100 and 500 messages and record wall time, request count, retry count, and peak memory.

#### 13. Benchmark graph construction before indexing every lookup

Create representative 1k/10k/100k-node fixtures and measure candidate generation and briefing separately. Add per-kind and email/person maps only where profiles show repeated scans. Preserve deterministic ordering so briefing/eval snapshots do not become flaky.

#### 14. Finish the existing operational backlog

These are more important to real-user experience than another UI abstraction:

- migrate desktop secrets to the OS keyring;
- sign installers;
- bundle or reliably provision `llama-server`;
- measure live LLM adjudication precision;
- unify the engine graph with desktop retrieval so desktop users receive the full provenance product rather than a parallel RAG-only path.

## Open-source library policy

The best first sprint adds **no runtime library**. React/Next/Vite dynamic imports, Tokio concurrency, SQLite transactions, and the existing Rust/Python standard tooling cover the measured work. Adding a general state manager, query cache, graph database, or virtualization package before profiling would increase code and audit surface.

When a new package becomes justified:

1. require an MIT/BSD/Apache-2.0-compatible license and record it;
2. capture the exact problem and baseline before adoption;
3. compare bundle/install impact and transitive licenses;
4. prefer an existing dependency already in the tree;
5. add a removal criterion if the expected gain does not materialize.

The optional `percent-encoding`/`base64ct` OAuth cleanup in the original plan remains reasonable only when that code is otherwise changing. It should not displace the P0 work.

## Performance budgets and measurement

| Area | Baseline from this review | First budget / acceptance signal |
|---|---:|---|
| Desktop initial JS | 1,006.83 kB min / 249.68 kB gzip | <700 kB min / <180 kB gzip, graph absent from initial chunk |
| Desktop query embeddings | 2 calls per semantic question | 1 call per question |
| Multi-source index retention | last indexing operation replaces table | all indexed sources survive; source refresh is atomic |
| Web demo staged answer | 900 ms / 1,200 ms timers | latest question always wins; timer cleaned on unmount |
| Engine tests | 58 | 58+ green in CI |
| Engine eval | P 0.97 / R 0.95 on synthetic scenario | no regression; publish live-backend comparison separately |
| Mobile demo | usable but source dominates 390×844 viewport | cited answer reachable without traversing full source canvas |

For runtime UX, measure on at least:

- low-end Windows CPU-only laptop;
- typical Apple Silicon laptop;
- Linux + NVIDIA host for vLLM;
- strict offline mode with a pre-staged model; and
- 320/390/430 px web viewports.

Record cold and warm values separately: app boot, engine-ready time, first-token latency, tokens/sec, query embedding time, KNN time, connector sync time, and peak memory. Build compilation time belongs in developer-experience reporting, not end-user latency.

## Recommended delivery sequence

1. **PR 1:** failing multi-source retention tests, transactional source-scoped index schema, migration/rebuild UX.
2. **PR 2:** one-embedding retrieval command plus request-count test.
3. **PR 3:** desktop graph/settings code splitting and explicit font subsets, with bundle budgets.
4. **PR 4:** web staged-local disclosure, answer timer cancellation, mobile cited-line transition.
5. **PR 5:** engine CI and corrected documentation/test counts.
6. **PR 6:** dead code, unused dependencies, and unused assets; report source and shipped-byte reductions separately.
7. **Later, measured PRs:** Gmail batching, graph lookup indexes, boot-state restructuring, and component memoization.

Every PR must preserve the air-gap enforcement in Rust, dual citations, technical/executive views from the same evidence, sample-data labeling, offline mock/smoke behavior, and the current full verification matrix.
