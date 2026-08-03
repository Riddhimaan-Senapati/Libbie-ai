# Libbie.ai — Optimization Plan

A cross-surface plan for shrinking, simplifying, and speeding up the shipped product without
regressing the security invariants in `CLAUDE.md` or the product contracts in `main_plan.md` /
`mvp_plan.md`. Written after a full code review of all three surfaces (`engine/`, `desktop/`,
`libbie/`) plus a plan-adherence audit.

**How to read it.** Items are ranked high→low by (impact ÷ effort). Each carries a `file:line`
anchor (line numbers are point-in-time and drift), an effort grade (S/M/L), and a risk flag:
🟢 low risk (leaf/removal), 🟡 medium (cross-file but mechanical), 🔴 high (touches behaviour /
security / on-disk format). Items 🟢 are the "quick wins" that Phase 0 of any sprint can land
with CI green and no design discussion. Everything is advisory; nothing here is uncommitted work.

Relevant docs: [`CLAUDE.md`](../CLAUDE.md), [`NEXT_STEPS.md`](NEXT_STEPS.md),
[`main_plan.md`](main_plan.md), [`mvp_plan.md`](mvp_plan.md),
[`IMPLEMENTATION_REPORT.md`](IMPLEMENTATION_REPORT.md).

---

## Top 10 (start here)

| # | Item | Surface | Prize | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Delete the dead pre-redesign demo + orphan UI primitives (~2,200 LOC) | `libbie/` | −15% LOC, slimmer `/demo` chunk | S | 🟢 |
| 2 | Remove `networkx` dependency + unused `embed()` path | `engine/` | leaner install / audit | S | 🟢 |
| 3 | Make `embed_and_index` incremental instead of reset-every-run | `desktop/` | biggest real perf fix | M | 🔴 |
| 4 | Lazy-load `recharts`（RiskPanel）and `sample-graph.json` | `libbie/`+`desktop/` | −100 KB+ JS from first paint | S | 🟢 |
| 5 | Compress / drop dead image assets (PNG logos) + ship woff2-only fonts | both web apps | largest payload reduction | S | 🟢 |
| 6 | Extract shared `credentials.py`（token storage）; dedupe email/datetime helpers | `engine/` | −100+ LOC duplicate | S | 🟡 |
| 7 | Extract connector + engine-launch plumbing in Rust | `desktop/` | −200+ LOC, closes drift | M | 🟡 |
| 8 | One shared cited-code renderer (replace 3 copies) | `libbie/` | consistent, −150 LOC | M | 🟡 |
| 9 | Cache the query embedding（embed once per question, not 2–3×） | `desktop` | lower query latency | S | 🟡 |
| 10 | O(n²)→O(n) graph scans in join/briefing | `engine/` | constant-factor join speed | M | 🔴 |

---

## 1. Code-size reduction & simplification

### 1.1 `libbie/` — web demo (MVP)

**1.1.1 Delete the dead pre-redesign demo cluster. 🟢**
`Workspace.tsx`（299L，`components/demo/Workspace.tsx:174`）imports `QueryConsole`/`AnswerBody` /
`CodeCitationPanel`/`ConversationCitationPanel` (`Workspace.tsx:20-23`); `AppHeader.tsx` imports
`FreemiumCounter.tsx` + `LocalModeToggle.tsx` (`AppHeader.tsx:6-7`); `ScanningIntro.tsx`
(`components/demo/ScanningIntro.tsx:66`) is orphaned. **None of them are imported by any live
route** — the live copilot is `app/demo/page.tsx` → `ReadingIntro`/`Workspace`(no, the live
"workspace" is inline in `app/demo/page.tsx`) + `CodeCanvas`/`LibbieRail`/`AnswerSurface`/
`AskLibbie`. Deleting the dead cluster also frees: `progress`, `tooltip`, `input`, `separator`
(kept alive only by dead code) and re-opens `avatar`, `card`, `dropdown-menu`, `skeleton`,
`table`, `tabs`（zero importers) as removable `components/ui/` primitives. Net ≈ **1,200+ dead
lines** and removing them cannot change any rendered page. Re-run `npx tsc --noEmit` after.

**1.1.2 Drop dead heap `zod`. 🟡**
`libbie/package.json:26` lists `zod ^4.4.3` as a direct dep with **zero imports** in the app. It
survives transitively under the `shadcn` CLI dev-process（`package-lock.json:10138`), so this is
a **direct-dep removal only** — safe; do not remove the transitive lock entry.

**1.1.3 Collapse the 6 shim files + `lib/types.ts` into `lib/data.ts`. 🟢**
`lib/types.ts:3` and each `lib/fixtures/*.ts` are one-line re-exports of `@shared/*`
(`lib/types.ts:3`, verified). The shim layer exists to keep import paths tidy for *both*
apps（desktop uses the same shims), so this is a marginal consolidation — keep the `@shared/*`
alias (`tsconfig.json:21-24`, `next.config.ts:9-11`) and import `@shared/...` directly from
components, or keep one barrel. Architectural preference, not urgent.

**1.1.4 Trim unused exports from `lib/data.ts`.** 🟢
`linkMap`, `getLinksForFile`, `getLinksForConversation`（`lib/data.ts:23-28`) are never imported
(UI re-derives links from `answer.*Citations`); `scanItems` is consumed only by the dead
`ScanningIntro`. Remove once 1.1.1 lands.

**1.1.5 De-dup the "cited code" renderer.** 🟡
The line-number gutter + highlight + comment-italic style is handwritten **3×**: `CodeCanvas.tsx:85-144`,
`AnswerSurface.tsx` `CodeCard`（`AnswerSurface.tsx:92-130`), dead `CodeCitationPanel.tsx:54-97`.
Extract one `CitedCodeFile` component and reuse. Also fold `COMMENT_RE`（defined 3×: `CodeCanvas.tsx:11`,
`AnswerSurface.tsx:42`, `CodeCitationPanel.tsx:18`) into it.

**1.1.6 Reuse `SampleDataBadge`.** 🟢
`RiskPanel.tsx:244-246` and `HandoverDialog.tsx:326-328` hand-roll "sample data" pills that
duplicate `SampleDataBadge.tsx`. Reuse it (NFR-6 sample labelling stays).

**1.1.7 One "GRCh37 example" module for hero/fusion.** 🟡
`hero.tsx:24-26` and `fusion.tsx:12-14` both call `getAnswer/getConversation/getCodeFile` and
both hand-render the fusion card. Source the verdict from `answer.technical.summary` instead of
the hard-coded copy at `hero.tsx:229-230` so the promoted line can't drift from the demo answer.

### 1.2 `engine/` — Python provenance back-end

**1.2.1 Extract `credentials.py`. 🟢** The 55-line token storage block（`_token_file`/`save_token` /
`load_token`/`clear_token`, keyring→0600-file fallback) is copy-pasted verbatim:
`github.py:358-413` and `slack.py:486-541`（same four defs, verified). Also the
`get_*_client_id` env getters repeat the same `os.environ.get(...).strip()` idiom across
`github.py` / `slack.py` / `email_ingest.py`. One `credentials.py` removes ~50 duplicate lines.

**1.2.2 Deduplicate email + datetime parsing. 🟡** — `_first_address` / `_body_text` are
copy-pasted between `ingest/conversation.py`（`:278-316`) and `email_ingest.py`（`:94-116`).
Datetime/duration coercion is re-implemented ~5×（`slurm.py:90` `_parse_ts`, `git_ingest.py:80`
`_coerce_dt`, `email_ingest.py:90` `_parse_date`, `conversation.py:49` `_ts_from_slack`).
`_as_naive`/`_min_dt`/`_trim` are duplicated between `candidates.py`（`:412-422`) and
`briefing/generate.py`（`:339-349`). Move these into one `ingest/_parse.py`（or a util module).

**1.2.3 Unify `Provenance.hash` semantics. 🟡 — a latent bug.**
The same field holds four different value shapes across ingesters: `slurm.py:287,394,507` store
the full `artifact:<sha>` id, `conversation.py:75` strips the `artifact:` prefix, `git_ingest.py:213`
ignores the store return (uses the git sha), `literature.py:222` accepts `result.hash | result.id`.
Pick one "content-address basename" convention and enforce it in `store/artifacts.py`.

**1.2.4 Factor the CLI epilogue + auth guard. 🟡**
The "load graph → add nodes → `annotate_environment(graph)` → save → echo" tail repeats 4× in
`cli.py`（`:94`, `:270`, `:391`, `:448`, `:485`) and the "not authenticated → Exit(1)" guard
repeats 3–4× (e.g. `:216-218`, `:247-250`, `:350-352`). Extract `_add_nodes_and_save()` and
`_require_token()`. `cli.py` has **zero tests** — add `tests/test_cli.py` alongside (see §6).

**1.2.5 Drop unused `embed()` path + `sentence-transformers` extra. 🟢**
`embed()` on every backend (e.g. `api.py:84`, `local.py:67`, `mock.py:71`) has **zero callers**
in the engine (only tests). The `embed` extra in `pyproject.toml`, `EmbeddingStatus` plumbing,
and the `embed`/`embed_endpoint` config fields are vestigial. Either wire it to a real
retrieval use-case (retrieval is desktop-only today) or remove it to keep the ~2 GB
`sentence-transformers` tree off the install for a feature nothing exercises.

**1.2.6 Refresh `GROUND_TRUTH.md` §5. 🟢** — several claims describe older code: the `ran`
tz-crash is fixed（`candidates.py:339,343` wrap `_as_naive()`), the `ran` prior is now 0.78
（`candidates.py:353`), and `produced_by` is reachable via `candidate:shared-params`
（`candidates.py:377-389`). Stale docs silently mislead the next session.

### 1.3 `desktop/` — Tauri core + webview

**1.3.1 Extract the connector command boilerplate. 🟡**
The three indexers share the identical outer shape（air-gap guard → `_inner` → `Channel<IndexEvent>`
error-pump → `Done`）: `github_index_repo`（`commands.rs:916-998`), `slack_index_channels`
（`commands.rs:1181-1270`）, `email_index`（`commands.rs:1484-1546`）. Each also has a chunk-collector
（`collect_repo_chunks` `:746`, `collect_gmail_chunks` `:1546`, `collect_imap_chunks` `:1597`）
doing the same "walk → build `Chunk[]` → emit status every N" dance. Extract a shared guard helper
+ a generic `collect(Channel)` helper. The **air-gap guard itself is copied 7+×**（e.g. `:484`,
`:855`, `:1165`, `:1314`, `:1505`）— one `ensure_egress_allowed()`.

**1.3.2 Factor `start_llama` vs `start_embed`. 🟡**
`engine.rs:262-347` (`start_launch_llama`) and `engine.rs:465-552` (`start_embed`) share ~90 lines
of identical "build args → spawn → `CREATE_NO_WINDOW` → `wait_healthy` → construct
`EngineStatus`". A single `spawn_engine(cfg, kind, extra_args, timeout)` removes the drift risk.

**1.3.3 Reuse the shared OAuth loopback catcher. 🟡**
`slack_connect`（`:1135`) and `email_gmail_connect`（`:1334`) each re-goto `spawn_blocking` +
`tiny_http` bind → GET parse → `resolve_str`/`resolve_opt`（`:1019-1038`) flow. One `oauth`
catch helper serves both.

**1.3.4 Reduce the intentional Rust/TS SSE mirror. 🟡（documented, low priority）**
`inference.rs:249-408` and `sse.ts:19-68` implement the same parser twice（TS one is OpenAI-only
for browser-dev）. They're both tested (`sse.test.ts`, 8 cases); leave as-is unless a new wire
format is added, then extract the shared test vectors.

**1.3.5 Drive `Settings.tsx` out of its 1,891-line monolith. M — maintainability.**
`Settings.tsx:1,891` lines contains ~8 feature panels plus two embedded connector components
(`SlackConnector` `:1346`, `EmailConnector` `:1563`). Break into per-feature panels；this also
unlocks route-level code-splitting for the HF/GitHub/Slack/Email panels.

---

## 2. Open-source（MIT-permissive）library adjustments

Constraint from `CLAUDE.md`: permissive-only, no viral copyleft, no hand-rolled reimplementations
unless justified. Every change must keep the "avoid AGPL/GPL" audit clean.

| What | From | To | Why / risk |
|---|---|---|---|
| Remove `networkx` | engine deps | — | Declared + documented（`pyproject.toml:18,25`, README) but **never imported**（verified). Simplifies install + license audit. |
| Remove `zod` direct dep | libbie | — | Dead（§1.1.2). Keeps transitive under `shadcn` CLI only. |
| Remove `sentence-transformers` extra | engine | — | Unused（§1.2.5). |
| Replace hand-rolled encoders | `oauth.rs:1-206` | `percent-encoding` + `base64ct` crates (MIT) | ~150 lines audited against RFC 7636 currently. Swapping adds 2 tiny MIT deps but removes audit surface. **Optional** — the hand-roll is tested; weigh only if touching that code. |
| Keep `rustls`（no native-tls） | desktop | — | Correct for air-gap / anti-mitm；do not revert. |
| Keep `sqlite-vec`, `rusqlite`（bundled） | desktop | — | Single-connection store is required by sqlite-vec；correct. |
| Add `keyring`? | desktop secrets | already planned | See `NEXT_STEPS` P1-5（`config.rs` migration）. Keep the engine's keyring-first pattern aligned. |

**Rule of thumb going forward:** before adding any dependency, run `/find-docs` + `/deep-research`
（as the current stack was chosen）and consult the appliance list in `IMPLEMENTATION_REPORT.md` §2-3.
The repo's discipline（`git2` GPL→`git` CLI, `PyMuPDF` AGPL→`pypdf`, etc.) should not regress.

---

## 3. Performance & UX

### 3.1 Bundle / first-load（web ui)

- **3.1.1 Lazy-load the risk panel（`recharts`). 🟢** `RiskPanel.tsx:5-13` statically imports
  `recharts`, and `app/demo/page.tsx:26` imports `RiskPanel` eagerly；the panel only renders on a
  side-sheet open（`page.tsx:250-260`）. Wrap it in `next/dynamic`（or a `Suspense` boundary）so
  `recharts`（≈90–120 KB gzip）leaves the initial `/demo` chunk.
- **3.1.2 Lazy-load `sample-graph.json`.** `GraphView.tsx:13` `import sampleRaw from
  "@/assets/sample-graph.json"` pulls a 402.8 KB JSON into the main bundle even when the graph
  screen is never opened. Swap to a dynamic `import()` inside `useEffect`; normalise at load,
  not at module scope（`GraphView.tsx:39`）.
- **3.1.3 Add a code/loading boundary primitive.** There is **zero** `next/dynamic`, `React.lazy`,
  `Suspense`, `loading.tsx`, or `error.tsx` anywhere in `libbie/`（verified）. Adding `loading.tsx`
  to the `/demo` route is free progressive improvement.
- **3.1.4 Ship woff2-only font subsets.** Both apps load full Hanken Grotesk（latin/latin-ext/
  vietnamese × 4 weights × woff+woff2）+ JetBrains Mono. Dropping `woff`（ancient browsers excepted）
  and non-`latin` ranges roughly halves the font payload — a real win in the CSP-forced
  self-hosted model（`desktop/tauri.conf.json:27` `connect-src` only lets you fetch loopback + IPC）.
- **3.1.5 Compress / drop dead image assets.** `public/libbie_logo.png`（≈3.97 MB in `libbie`；
  3.9 MB ships in `desktop/dist`）is **unreferenced by any `<img>`/CSS**（only string-path mentions
  in the `sample-graph.json` fixture data, which are data, not renders）. Either optimise with
  `pngquant`/Squoosh（to ~200–400 KB）or remove. Also remove the Next starter SVGs
  (`next.svg`, `vercel.svg`, `window.svg`, `file.svg`, `globe.svg`) and the unused
  `libbie-logo.svg` / `libbie_logo.svg`. Use `next/image` for `desktop-connectors.png` / 
  `desktop-graph.png`（`sources.tsx:59-65`, `graph.tsx:44-50`).

### 3.2 Retrieval / inference

- **3.2.1 Make indexing incremental 🔴（the biggest architectural perf fix**.
  `embed_and_index`（`commands.rs:304-359`) re-embeds the whole corpus then calls `vec.reset(dim)`
  （`:342`, `vecstore.rs:131-133` do `drop table if exists chunks` + recreate). So `github_index_repo`,
  `slack_index_channels`, `email_index`, and `build_index` **wipe every prior source** — only the
  most-recently-indexed source is searchable, and any re-connect re-embeds everything. This is
  `NEXT_STEPS` P1-4. Approach: namespace chunks by source/`conv_id` via a chunk-id prefix; in
  `add index or skip`, only reset when `dim` changes or the store is empty；append-only `insert`.
  This is a schema/format change to the index（on-disk contract）→ 🔴 test vector re-build.
- **3.2.2 Cache the query embedding.** Each `retrieve()` triggers **2 embedding HTTP calls** to the
  local engine (one per kind from `rag.ts:248-249`）+ embeddings inside `vector_search`
  （`commands.rs:374-393`）— `<the question` is embedded 2–4×. Embed once per question（share a
  short-lived cache keyed on query+model ID）and reuse across legs.
- **3.2.3 Batch Gmail fetches.** `collect_gmail_chunks`（`commands.rs:1546`) issues **one REST call
  per message**, capped at 500 → worst case ~500 sequential round-trips（a status emit every 25）.
  Use the Messages `batchGet` endpoint or a small `tokio` worker pool（5–8）for tens-of-seconds
  savings on large mailboxes.
- **3.2.4 Batch `Chunk[]` IPC.** `build_index` sends the full `Chunk[]` up over IPC（`App.tsx:236`）;
  for a 4,000-chunk corpus that's a heavy invoke. Consider stashing to a temp file by the Rust
  side or chunking the upload. Minor at demo size；note for scale.

### 3.3 Webview render

- **3.3.1 Boot: 7-step state flush.** `App.tsx:119-157` sets ~7 pieces of state in sequence（
  `setStatus`→`setModels`→`setEmbedStatus`→`setIndexInfo`→`setConfig`+`setHardware`+`setChoice`）.
  Batch into a single `useEffect` + one `setState` with the composite boot payload.
- **3.3.2 Memoise streaming answer surface.** `runInference`（`App.tsx:286-330`）sets `thinkingLine`,
  `tokens`, `view`, and per-token stream state per token; there is **no `React.memo`** anywhere in
  the webview components. At large code trees the chat + graph on screen together will jank. Add
  `React.memo`/`useCallback` around the stock files（`AnswerSurface`, `CodeCanvas`, minimised payloads）.
- **3.3.3 Constant-factor graph scans in the engine.** `generate_candidates`（`join/candidates.py`,
  ~25 `graph.nodes_of(...)` scans at `O(n)`) and `briefing.generate`（~15 scans）plus
  `_person_by_email`（`generate.py:304`, O(people), called in a loop → O(people²)）. Building
  per-kind index dicts once per pass turns these into O(1) lookups and is a cheap constant-factor
  win on large graphs. Pipes into 3.2.1-like scale story.

---

## 4. Environment optimization

| Context | Change | Effort | Notes |
|---|---|---|---|
| Air-gapped | Keep CSP `connect-src` loopback-only；don't reach out for fonts/analytics. Self-hosted fonts already satisfy this（3.1.4 trims payload）. | — | Do **not** relax CSP. |
| Offline dev/build | Front: `npm run dev`/`build` currently need registry access on first `npm install` only. Consider vendored lock + offline npm cache in doc. Engine runs fully offline on `mock` backend — keep that invariant（no new network-only default gates）.* |
| Low-end / no-GPU laptops | Smaller fonts（3.1.4）+ no `recharts` in initial chunk（3.1.1）+ woff2-only = materially lower first-paint and JS on a budget laptop. For the desktop app, a **smaller default GGUF**（e.g. the `q4_k_m` used in README）cuts cold-start；document the CPU-only path clearly. |
| Mobile viewport | `libbie/` demo targets 1360×900 desktop；browser review found it "mobile-responsive". Keep mobile in the agent-browser regression pass（§6）. The webview is desktop-only by design. |
| Cold-start（desktop） | EngineManager health-check wait / re-spawn on first ask. Consider a warm-start "engine running" instead of spawn-per-question；ensure `engine_status` polls early（`App.tsx:119`) so the pill is green before the user asks. |
| CI coverage | `ci.yml` covers Rust + both web apps but **not engine `pytest`**（`NEXT_steps` P2-12）. Add a Python job so engine regressions gate PRs. Also bump deprecated `actions/checkout@v4`/`setup-node@v4`（Node 20→24 warnings, `NEXT_STEPS` P2-14）. |
| Releases | Installer unsigned（`NEXT_STEPS` P0-3). Add cert scaffolding to `release.yml` before certs exist. |

---

## 5. Plan-adherence & cross-doc drift (fixing the paper trail)

These are doc-truth problems, not code bugs, but they mislead every future session (incl. this
optimization work). Fix alongside any sprint touching the related code.

1. **Test-count staleness.** `IMPLEMENTATION_REPORT.md` says "58 engine tests"; `GROUND_TRUTH.md:13`
   says "21 still pass"; the live suite is **51**（verified in `engine/tests/`). One number, one
   source of truth → run tests and update the docs.
2. **`eval_scenario/GROUND_TRUTH.md` §5 is stale**（§1.2.6 above）.
3. **`libbie/CONTRACT.md` vs code.** It says "Dark theme is global and always on"(:12) and
   `REDESIGN.md:23` says "warmed dark", but `app/globals.css` implements a **light** theme（
   white `--background`, navy `--foreground`, blue `--primary`）. The code is internally
   consistent（light); the contracts are wrong.
4. **Font contract drift.** `CONTRACT.md:28-30`/`REDESIGN.md:30-31` specify Fraunces + Geist; the
   app loads **Hanken Grotesk for both `font-sans` and `font-display`** + JetBrains Mono
   （`layout.tsx:6-9`, `globals.css:17-18`）.
5. **`next-themes` without `ThemeProvider`.** `sonner.tsx:3,8` follows OS theme while the site is
   hard-coded light → a dark-OS user gets a dark toaster on a white site. Either pin the `Toaster`
   to `theme="light"`（removes a runtime dep）or wire a Provider.
6. **`desktop/dist` + `libbie/public` assets**: `tsconfig.tsbuildinfo`（222 KB）is an untracked
   build artifact；`.env.local` holds a live `VERCEL_OIDC_TOKEN`（gitignored but present）— confirm it
   is rotated/excluded before sharing the tree.
7. **Docs test-counts**（1）plus the `README` examples invoking `libbie ingest` should be
   kept in one place (`engine/README.md` + `TESTING.md`).

---

## 6. Verification you should run（and when to re-run）

These are the gates everything above must keep green（per `CLAUDE.md` CI invariants）.

```bash
# engine（offline, mock)
cd engine && ./.venv/Scripts/python -m pytest -q            # expect ~51 (+ new)
./.venv/Scripts/python scripts/smoke_test.py                # SMOKE TEST PASSED
./.venv/Scripts/python -m eval_scenario.run_eval            # expect P≈0.97 / R≈0.95

# desktop Rust core
cd ../desktop/src-tauri
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo test --lib

# web + webview build
cd ../libbie && npm run build
cd ../desktop && npm run build
```

- After **any** item in §1-§4 that touches an `import`/dependency: re-run the matching
  `test`/`build`. After dead-code removal（§1.1), re-run `tsc --noEmit` and both web builds.
- After the incremental-index work（§3.2.1), force a re-index and assert the bundled sample graph
  still renders (agent-browser round-trip), because it changes the on-disk index format.

**Manual / network-dependent** (document, don't CI): live GitHub/Slack/Gmail connectors need
real accounts + registered OAuth apps（`NEXT_STEPS` bottom）; live `llm.backend: api` precision
wants `$ANTHROPIC_API_KEY`. These stay manual.

---

## 7. Deliberately NOT doing

- **Replacing the dual SSE parsers**（Rust/TS）: documented, tested, each side independently
  verifiable；not worth the drift risk at this size.
- **Hand-rolled `oauth.rs` encoders** → crate swap: reproduced historical cost if you'll touch
  that file；otherwise leave it — it's RFC 7636-tested.
- **Single-connection `VecStore`**（`sqlite-vec` requirement）— correct as-is；don't "parallelise".
- **Adding a state management / data-fetch lib**, or replacing fixtures with a live backend in
  the MVP web demo — out of the MVP scope defined by `mvp_plan.md`（fixtures are by design）.
- **Rewriting `ingest/slurm.py` (656 L) until growth demands it** — it's the largest single
  module and the second-most-complex；split into `sacct/sbatch/log` parsers only if it grows.

---

## 8. Suggested sprint order（tie to `NEXT_STEPS`）

**Sprint A — clean, zero-risk（all 🟢/S）**: §1.1.1（dead web cluster）· §1.1.2/§1.1.4/§1.1.6 ·
§1.2.1（credentials.py）· §1.2.6（GROUND_TRUTH refresh）· §2 removals（networkx, zod, embed）·
§3.1.1/3.1.2/3.1.4/3.1.5（bundle/fonts/images）· §5 docs drift. Re-run §6 gates at the end.
**Sprint B (mechanical, 🟡/M）**: §1.1.5（shared cited-code renderer）· §1.2.2/§1.2.4 ·
§1.3.1/§1.3.2/§1.3.3（desktop plumbing）+ §5.5（Toaster theme）. Re-run gates.
**Sprint C (behavioural, 🔴/M–L, separate PRs + tests）**: §1.3.5（`Settings.tsx` split）·
§3.2.1（incremental index）· §3.2.2/§3.2.3/§3.3.1 (perf) · §3.3.3 (graph index scans) ·
CI engine job + action bumps（§4）.

Each 🟡/🔴 item must land behind its own test + the §6 gate re-run；**never** merge "while
unstable"(`CLAUDE.md`).

---

_End of optimization plan_ — synthesized from a full code review of `engine/`, `desktop/`,
`libbie/` against `main_plan.md`, `mvp_plan.md`, `NEXT_STEPS.md`, `IMPLEMENTATION_REPORT.md`,
and `CLAUDE.md`（2026). File-line anchors are point-in-time.