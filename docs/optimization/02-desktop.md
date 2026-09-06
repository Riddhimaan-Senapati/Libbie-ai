# PR 2: desktop

Implemented on `perf/desktop-optimizations` (2026-09-06). Items 1-10 and 12 landed in full.
Item 11 landed as its deletions and dedupes only. The file splits and ts-rs generation were
skipped. Item 13 stayed optional. The plan's 100 ms download throttle became a ~200-event
cap per file, which needs no clock. The cite-marker `layoutId` became a CSS animation
because the domAnimation feature set has no layout animations.

The Tauri app. Goal: smaller installer, no IPC flooding, no whole-app re-render per token, about
−650 LOC across Rust and TS. Gates before merge: `cargo fmt --check`,
`cargo clippy --all-targets -- -D warnings`, `cargo test --lib`, and `npm run build`.

Context numbers. Rust is 6,422 LOC across 12 files, of which ~600 LOC are tests. The webview is
6,668 LOC of TS and TSX across 26 modules. Measured bundle: main chunk 437 KB, GraphView chunk
327 KB (of which a 412 KB raw `sample-graph.json` is the bulk), force-graph chunk 195 KB.

## Work items

### 1. Add a release profile

`src-tauri/Cargo.toml` (46 lines) has no `[profile.release]` at all. The app ships cargo
defaults: no LTO, 16 codegen units, unstripped symbols, unwinding panics.

```toml
[profile.release]
lto = "fat"
codegen-units = 1
strip = "symbols"
panic = "abort"
```

Also change `crate-type = ["staticlib", "cdylib", "rlib"]` to `["rlib"]` (desktop-only target)
and trim `sysinfo` to `default-features = false, features = ["system"]`. Today its full feature
set scans processes, disks, network, and users on every `start_engine` call just to read total
RAM (`engine.rs:77-84`).

- **Payoff.** −20-35% installer size (expected magnitude for a Tauri app, not measured here),
  faster compile, faster `detect_hardware`.

### 2. Throttle download progress events

- **Evidence.** `commands.rs:617-633` sends one `DownloadEvent::Progress` over a Tauri Channel
  per reqwest chunk, each ~16-64 KB. A 4 GB GGUF means ~65,000-250,000 serialized IPC messages.
- **Change.** Emit at most one event per 100 ms or per 256 KB, whichever comes first.

### 3. Unblock the async executor

- `commands.rs:810-880` `collect_repo_chunks` is fully synchronous (walks a repo, reads up to
  64 MB across 4,000 files) and is called directly from an async command at `commands.rs:1033`.
  Wrap it in `tokio::task::spawn_blocking`. The pattern already exists at `commands.rs:1204`.
- `vecstore.rs:46` wraps rusqlite in a `Mutex` and runs synchronously inside async commands
  (`commands.rs:391,431,454-455`). Move the calls to `spawn_blocking`.
- `commands.rs:131-151` uses sync `std::fs` inside an async command. Same treatment.

### 4. Prepare SQLite statements once

- **Evidence.** `vecstore.rs:242-266` calls `tx.execute(...)` twice per chunk; rusqlite
  re-prepares the SQL text on every call. A 4,000-file repo is ~16,000 chunks, so ~32,000
  prepares.
- **Change.** Hoist `tx.prepare(...)` outside the loop. This is the dominant indexing cost after
  embeddings.

### 5. Batch Gmail message fetches

- **Evidence.** `commands.rs:1643-1654` fetches one HTTP request per message, sequentially, up
  to 500 per label.
- **Change.** Use Gmail `batchGet`, or `futures_util::stream::iter(...).buffer_unordered(8)`.
  The existing 429 backoff in `email.rs:230-254` already handles rate limits.
- **Payoff.** ~8× faster Gmail indexing.

### 6. Rewrite the SSE line loop

- **Evidence.** `inference.rs:249-255`:
  - `buf.push_str(&String::from_utf8_lossy(&bytes))` allocates per chunk and mangles multi-byte
    UTF-8 split across chunk boundaries. A correctness bug, not only a perf one.
  - `buf.drain(..=pos)` per line is an O(n) memmove, so O(n²) over a long stream.
  - `buf[..pos].trim().to_string()` plus `serde_json::from_str::<Value>` builds a full DOM per
    SSE line.
- **Change.** Hold the buffer as `String`, decode with a held-over tail for split characters,
  track a parse index instead of draining, and deserialize into a typed delta struct instead of
  `Value`.

### 7. Deduplicate the Rust command surface

All duplications verified by counting sites.

- The air-gap-plus-token pattern repeats ~11 times in `commands.rs` (lines 915-924, 959-967,
  999-1007, 1154-1159, 1230-1238, 1269-1279, 1375-1388, 1435-1443, 1465-1470, 1524-1533,
  1574-1578). One `require_token(state, offline_msg, |cfg| cfg.X)` helper removes ~60 LOC and
  unifies eight near-identical hand-written error strings.
- The command-wrapper pattern (public command → `_inner` → forward error to Channel) repeats 6
  times (lines 898-909, 980-992, 1135-1147, 1250-1262, 1358-1369, 1553-1566). ~−30 LOC.
- The `IndexEvent` progress closure repeats 3 times (lines 1043-1059, 1331-1343, 1594-1606).
  ~−25 LOC.
- Merge `start_llama`, `start_vllm`, and `start_embed` in `engine.rs` (lines 262-347, 352-421,
  465-552): three ~85-line bodies of identical spawn → wait-healthy → status logic. One
  parameterized helper, ~−150 LOC.
- `error.rs:80-127`: 16 hand-written constructors become one macro. ~−30 LOC.
- Collapse `resolve_str`/`resolve_opt`/`resolve_client_id` (lines 884-893, 1088-1107) to two
  helpers. ~−15 LOC.

### 8. Fix per-token whole-app re-renders

- **Evidence.** `App.tsx:287` runs `setSession((s) => ({ ...s, verdict: s.verdict + t }))` at
  the App root on every streamed token. `session` lives at `App.tsx:97`. Every token re-renders
  the entire workspace: `TopBar`, `PipelineRail`, `CodeCanvas` (which maps every line of the
  file), `LibbieRail`, `AnswerSurface`. No component in `src/` uses `React.memo`. String
  concatenation is also O(n²) over the answer.
- **Change.** Move the streaming string into state colocated in `LibbieRail`/`AnswerSurface`,
  accumulate in a ref or array, and wrap `CodeCanvas`, `PipelineRail`, and `LibbieRail` in
  `React.memo`.

### 9. Stop the 4-second unconditional poll re-render

- **Evidence.** `App.tsx:178-182`: `setInterval(refreshStatus, 4000)` always calls `setStatus`
  with a fresh object identity, re-rendering the whole app every 4 s even when nothing changed.
- **Change.** Compare before setting, or use `useSyncExternalStore`.

### 10. Move `sample-graph.json` out of the bundle

- **Evidence.** `GraphView.tsx:13` statically imports a 412,511-byte JSON into the lazy chunk,
  which lands as a 327 KB minified object literal.
- **Change.** Move it to `public/` and `fetch` it, or load through the existing
  `open_graph_json` Rust picker. The GraphView chunk drops to ~30 KB.

### 11. Restructure the TS surface

- Split `tauri.ts` (934 LOC) into `tauri/{config,engine,rag,connectors,dev}.ts`.
- `askLibbie`, `downloadModel`, and `githubLogin` each inline their own Channel wiring
  (`374-388`, `676-690`, `738-746`) despite generic helpers at `808-841`. Unify. ~−40 LOC.
- The dev-mode cosine search is duplicated between `vectorSearch` (538-562) and `retrieveVector`
  (565-600). ~−25 LOC.
- `devConfig()` (211-251) duplicates Rust `AppConfig::default()` (`config.rs:141-183`)
  field-for-field. Generate the TS type with `ts-rs` (MIT, verified) so the drift cannot
  recur.
- Split `Settings.tsx` (1,891 LOC, ~30 `useState`s) into per-connector components.
- Delete the one dead IPC wrapper: `embedTexts` in `tauri.ts:450` (no component calls it).

### 12. Adopt LazyMotion in the webview

- **Evidence.** `motion` 12.42.2 (which wraps `framer-motion`) costs ~100 KB of the 437 KB main
  chunk. It is used in 8 components, almost entirely for fade and slide enter animations.
- **Change.** CSS transitions or keyframes for simple fades. Keep motion only for the two spring
  layouts (`App.tsx:522-587` rail collapse, `CodeCanvas.tsx:73-83` layout marker) via
  `LazyMotion` and `m` with the `domAnimation` feature set.

### 13. Optional items

- Swap `tauri-plugin-dialog` for a direct `rfd` (MIT, verified) call, dropping the transitive
  `tauri-plugin-fs`.
- Add `mimalloc` (MIT, verified) as `#[global_allocator]` for the string-heavy indexing paths.
  Unmeasured on this app; treat as an experiment with a before/after measurement.
- Restrict `tauri.conf.json:32` `"targets": "all"` to the installer flavors actually published,
  cutting CI time.

## Keep as-is

Verified good during the audit, do not touch: reqwest rustls-only with tight features, the tokio
feature set (not `full`), the 2D-only force-graph variant (no three.js), font subsetting, lazy
route loading, the absence of unbounded channels, and the secret-redaction invariants.
