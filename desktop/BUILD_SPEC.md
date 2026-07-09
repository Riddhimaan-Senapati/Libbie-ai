# Libbie Desktop — Build Specification (air-gapped / on-prem)

**Status:** the core of this spec is implemented in this directory and verified locally
on Windows with llama.cpp + a sub-1B chat model **and** the nomic-embed embedding model.
Real semantic RAG (embeddings + `sqlite-vec` KNN) is implemented and tested end-to-end
(a paraphrased query with no shared keywords correctly retrieved the right code line).
The **vLLM** engine path is implemented and its selection/spawn/health wiring is
runtime-verified on Linux (Docker) via a CUDA-free shim; only vLLM-the-GPU-binary needs
real NVIDIA hardware, which this laptop lacks. Per-OS **installers** are configured; the
Windows installer is built + verified here.

This document conforms to `../docs/main_plan.md` (`<CURRENT_PLAN>`). The desktop app is
**Libbie's air-gapped deployment**: identical capabilities to the web app, but all
inference and data stay inside the customer's environment. Where the plan describes the
web/cloud build, this translates those capabilities to the desktop.

---

## 1. Summary & scope

**In scope**
- A thin, cross-platform desktop **client (Tauri: Rust core + TypeScript/React webview)**
  that reuses the web app's exact design system.
- A **pluggable local inference layer** behind one OpenAI-compatible contract:
  - **llama.cpp `llama-server`** (GGUF) — the implemented, tested engine (Windows/macOS/
    Linux, Metal/CUDA/Vulkan/CPU).
  - **vLLM** _(spec)_ — the primary engine on Linux + NVIDIA CUDA hosts.
- **Rust-owned engine lifecycle**: hardware detection, engine selection, spawn,
  health-check, hot model-swap, shutdown.
- **RAG grounding** over the indexed pipeline corpus → a **dual-cited** "why" answer
  (code cite + conversation cite + confidence), streamed token-by-token.
- **Model management**: local GGUF cache, selection, and a documented Hugging Face Hub
  staging path with a **strict offline mode** (zero runtime egress).
- **Governance**: separation of deterministic-core outputs from LLM reconstruction; all
  model traffic mediated by the Rust core (the webview performs no network I/O).

**Out of scope / non-goals**
- Training or fine-tuning models.
- Cloud/hosted inference (that is the web app; here inference is strictly local).
- Multi-tenant auth / RBAC (deferred per PRD non-goals).
- Reimplementing the deterministic extraction core — the desktop **integrates** with it;
  in this MVP the corpus is the authored sample pipeline (labelled "Sample data").

**Explicit conflict reconciliation with `<CURRENT_PLAN>`**
- The plan lists **Ollama** for laptop demos. This build **rejects Ollama** and uses
  **llama.cpp directly** (see §9): Ollama wraps llama.cpp but imposes its own daemon and
  model registry, which fights an air-gapped, pre-staged-artifacts posture. Direct
  `llama-server` gives the control the enterprise build needs.
- The plan's web stack uses **Radix + Framer Motion**; the current web app (and thus this
  desktop port) uses **base-ui + `motion`** with a Benchling-style light theme. The
  desktop matches the *shipped* web app, not the older plan text.
- The plan's stores are server-side (pgvector/Qdrant). For the single-binary air-gapped
  desktop, the vector store is **embedded `sqlite-vec`** (implemented); in-process lexical
  retrieval remains a zero-dependency **fallback** when no index/embedder is present.
  `sqlite-vec` is chosen over LanceDB because it is **pure C, statically linked into the
  Rust core** (`cargo add sqlite-vec`, compiled via `cc` at build) — so there are no
  per-platform prebuilt native binaries to bundle or sign, and vectors + relational
  metadata live in one on-disk SQLite file (mirroring the plan's pgvector+Postgres design,
  embedded). LanceDB / FAISS remain acceptable alternatives at large corpus scale.

---

## 2. Final architecture

### Components & responsibilities

```
┌─────────────────────────────────────────────────────────────────────┐
│  TAURI WEBVIEW  (React + TS, ported Libbie design system)             │
│   • Ambient copilot UI: pipeline rail · code canvas · Libbie rail     │
│   • RAG retrieval + prompt building + dual-citation assembly (TS)     │
│   • Zero network I/O — everything via Tauri IPC                       │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ Tauri commands (typed)                 │ Channel<StreamEvent>
                ▼                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RUST CORE  (src-tauri)                                               │
│   config.rs   persisted settings, model resolution, binary detection │
│   engine.rs   hardware detect · engine choice · spawn/health/stop     │
│   inference.rs OpenAI-compatible proxy (chat stream + embeddings)     │
│               + air-gap guard (loopback-only enforcement)            │
│   commands.rs typed IPC surface                                       │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ spawns + health-checks                 │ HTTP (loopback only)
                ▼                                         ▼
┌───────────────────────────┐            ┌──────────────────────────────┐
│  llama.cpp llama-server    │            │  vLLM (Linux + NVIDIA) (spec) │
│  GGUF · /v1/chat, /v1/embed│            │  OpenAI server /v1/chat       │
│  Metal/CUDA/Vulkan/CPU     │            │                              │
└───────────────────────────┘            └──────────────────────────────┘
        127.0.0.1:51820 (chat) · 127.0.0.1:51821 (embeddings)
```

Because both engines speak the OpenAI-compatible API, the client targets **one contract**
and an **engine-selection layer** (Rust) picks the engine at runtime from detected hardware.

### Data flow

**(a) Indexing.** The deterministic core produces the corpus (files with line-addressable
content; conversations normalized to author/time/body/references; a code↔conversation link
map). In this MVP that corpus is the authored `src/lib/fixtures/*`. It is chunked
(`rag.ts::chunkCorpus`) and embedded (nomic-embed GGUF via `llama-server`'s
`/v1/embeddings`) into a **`sqlite-vec`** `vec0` table (vectors + citation metadata in one
on-disk `.db`); queries embed and run KNN against it, falling back to lexical if no index.

**(b) "Why" query.**
1. UI captures the question (⌘K palette or a proactive nudge).
2. `rag.ts` retrieves the top code line(s) + conversation(s) from the corpus and builds a
   grounded prompt (system persona + evidence block + question + audience instruction).
3. UI calls `ask_libbie(messages, options, channel)`.
4. Rust proxies a streaming `POST /v1/chat/completions` to the loopback engine and pushes
   token deltas back over a Tauri `Channel`.
5. UI renders the **verdict** (typed in) then the **dual citation** derived from what
   retrieval selected (code cite = teal, conversation cite = amber, + confidence). The code
   canvas scrolls to and glows the cited line.

**(c) Model download + serve.** On a connected staging machine, `hf download <repo> <file>`
places a GGUF in the models directory; it is copied to the air-gapped host. In Settings the
user selects the model and presses **Start engine**; the Rust core spawns `llama-server`,
polls `/health` until ready, and reports status. Model-swap = stop + start with a new model.

---

## 3. Repository layout & pinned stack

```
desktop/
  package.json            # frontend + Tauri CLI deps
  vite.config.ts          # Vite + React + Tailwind v4 (@tailwindcss/vite)
  index.html
  src/
    main.tsx              # self-hosted fonts (@fontsource) + mount
    App.tsx               # shell: reading intro → 3-pane workspace → settings
    styles/globals.css    # design system ported verbatim from the web app
    lib/
      types.ts            # data contract (shared with web app)
      data.ts             # single import surface + helpers
      fixtures/*          # authored corpus (pipeline, conversations, answers, links)
      utils.ts            # cn()
      tauri.ts            # typed IPC bridge (+ browser-dev fallback)
      rag.ts              # retrieval + grounded prompt + citation assembly
    components/           # LibbieAvatar, PipelineRail, CodeCanvas, LibbieRail,
                          # AnswerSurface, AskLibbie, EngineStatusPill, Settings, …
  src-tauri/
    Cargo.toml
    tauri.conf.json       # window, CSP, bundle, identifier ai.libbie.desktop
    capabilities/default.json
    icons/
    src/{main,lib,config,engine,inference,commands,vecstore}.rs
  models/                 # pre-staged GGUF cache (git-ignored)
```

**Pinned versions**
- Tauri **2.x** (`tauri`, `tauri-build`, `tauri-plugin-dialog`), Rust edition 2021 (≥1.77.2).
- reqwest 0.12 (rustls-tls, no system OpenSSL), tokio 1.x, futures-util 0.3, sysinfo 0.33.
- Frontend: React **19.2.4**, Vite **6.4**, TypeScript **5.9**, Tailwind **4.1**
  (`@tailwindcss/vite`), `motion` **12.42**, `lucide-react`, `@fontsource/hanken-grotesk`,
  `@fontsource/jetbrains-mono` (fonts self-hosted — no runtime Google Fonts).
- Engines: **llama.cpp `llama-server`** (build ≥ b7285 verified) · **vLLM ≥ 0.6** _(spec)_.
- Default chat model (laptop test): `Qwen/Qwen2.5-0.5B-Instruct-GGUF` (Q4_K_M, <1B params).
- Default embedding model _(spec)_: `nomic-embed-text` GGUF (BGE-family acceptable).
- Vector store _(spec)_: **`sqlite-vec`** (Apache-2.0 / MIT, pure C, statically linked via
  `cargo add sqlite-vec` + `rusqlite`, embedded, on-disk; runs on Windows/macOS/Linux/WASM).
  LanceDB / FAISS acceptable at large corpus scale.

---

## 4. Interface contracts

### 4.1 Client ↔ inference (OpenAI-compatible)
- `POST {base}/v1/chat/completions` — `{ model, messages[], temperature, top_p, max_tokens, stream }`;
  SSE `data:` lines with `choices[0].delta.content`, terminated by `data: [DONE]`.
- `POST {base}/v1/embeddings` — `{ model, input[] }` → `{ data: [{ embedding: number[] }] }`.
- `GET {base}/health` — `200 {"status":"ok"}` when the model is loaded; `503` while loading.
- Bases are **loopback only**: chat `127.0.0.1:51820`, embeddings `127.0.0.1:51821`.

### 4.2 Model-manager / engine (Tauri commands — see `commands.rs`)
| Command | Args → Returns |
| --- | --- |
| `get_config` / `set_config` | `AppConfig` |
| `get_hardware` | `HardwareInfo { os, arch, cpu_count, total_mem_mb, has_nvidia, gpu_names[], llama_backend }` |
| `get_engine_choice` | `EngineChoice { engine, reason }` |
| `start_engine` / `stop_engine` / `engine_status` | `EngineStatus { running, healthy, engine, model, base_url, pid, message }` |
| `list_models` | `ModelEntry[] { name, path, size_mb }` |
| `ask_libbie` | `(messages[], options?, on_event: Channel<StreamEvent>)` → streams `{type:token|done|error}` |
| `embed_texts` | `(inputs[])` → `number[][]` |

### 4.3 RAG pipeline (TypeScript — `rag.ts`)
- `retrieve(question) → { code: CodeRef[], conversations: Conversation[], confidence, context }`.
- `buildMessages(question, retrieved, audience) → ChatMessage[]` — same evidence, technical
  vs executive instruction (FR-9), so the two renderings never diverge factually.

### 4.4 Deterministic-core ↔ RAG handoff
The deterministic core owns **identity, line ranges, versions, and link edges** (`types.ts`
`CodeFile` / `CodeRef` / `Conversation` / `LinkEdge`). RAG **only** selects and grounds from
those artifacts; it never mints new code/version facts. Citations shown to the user are the
core's addressable locations, not model output — this is the trust boundary.

### 4.5 Dual-citation object
```ts
{ verdict: string,                 // LLM-synthesised, grounded
  code: CodeRef[],                 // {path, lineStart, lineEnd, symbol}
  conversations: Conversation[],   // source/date/author + pivotal message
  confidence: number }             // 0..1, from retrieval strength (both-sides bonus)
```

---

## 5. Milestone-based task plan

| # | Goal | Key files | Acceptance / DoD |
| --- | --- | --- | --- |
| **M1** | Tauri shell + design system parity | `vite.config`, `globals.css`, `App.tsx`, `LibbieAvatar` | App boots to the reading intro → workspace; visually matches the web app; `vite build` + `tsc` clean. ✅ |
| **M2** | Rust engine lifecycle | `engine.rs`, `config.rs`, `commands.rs` | `start_engine` spawns `llama-server`, `/health` polled to ready, `stop_engine` kills child; status surfaced; killed on app exit. ✅ |
| **M3** | Streaming grounded answer | `inference.rs`, `tauri.ts`, `rag.ts`, `AnswerSurface` | Asking a "why" question streams a verdict from the local model, grounded on retrieved evidence, with a dual citation and the cited line highlighted. ✅ |
| **M4** | Model manager + air-gap | `Settings.tsx`, `config.rs` | List/select GGUF; set binary/paths/ports; strict offline mode enforced in Rust (loopback-only); HF staging documented. ✅ |
| **M5** | Governance & views | `rag.ts`, `AnswerSurface`, `HandoverDoc` | Technical/executive re-render from one evidence set; handover doc assembled from corpus; "Sample data" labelled. ✅ |
| **M6** | Embeddings vector RAG | `inference.rs::embed`, `vecstore.rs`, `rag.ts` | `nomic-embed` served on 51821; corpus embedded into a `sqlite-vec` `vec0` table; KNN (`MATCH … k=N`) with a `kind` filter; lexical stays as fallback. Verified: paraphrased query → correct code+conversation citations; Rust `cargo test` covers the KNN path. ✅ |
| **M7** | vLLM engine path | `engine.rs`, `config.rs`, `Settings.tsx` | `choose_engine` → vLLM on Linux+NVIDIA; `start_vllm` spawns `vllm serve <model> --host --port --gpu-memory-utilization --dtype [--max-model-len] [--quantization]` on `chat_port`, health-checks `/health`; same OpenAI contract so client is unchanged; vLLM-specific settings in the UI. **Runtime-verified on Linux** (Docker) via a CUDA-free shim: `vllm_path_spawns_and_becomes_healthy_with_shim` drives `detect_hardware → choose_engine(vLLM) → start_vllm → /health → healthy` (9/9 `cargo test`). Only vLLM-the-GPU-binary itself needs real NVIDIA hardware. |
| **M8** | Packaging (per-OS installers) | `tauri.conf.json` | `bundle.targets: all` + publisher/category/copyright + per-OS config (NSIS install mode, macOS min version, deb depends). `tauri build` yields Windows `.exe`/`.msi`, macOS `.dmg`/`.app`, Linux `.deb`/`.rpm`/`.AppImage`. Windows NSIS installer built + verified here. Engine sidecar bundling is a CI provisioning step (see §8.1). |

---

## 6. Build & run

Prereqocs: Node ≥ 20, Rust ≥ 1.77, a `llama-server` binary, and a GGUF model.

```bash
cd desktop
npm install

# stage a sub-1B model (staging machine; copy to the air-gapped host afterwards)
hf download Qwen/Qwen2.5-0.5B-Instruct-GGUF \
  qwen2.5-0.5b-instruct-q4_k_m.gguf --local-dir ./models

# run the full desktop app (spawns/manages llama-server itself)
npm run app:dev          # = tauri dev

# build installers
npm run app:build        # = tauri build
```

**Verify each milestone locally** (what was done here on Windows):
- Frontend: `npx tsc --noEmit` (clean) and `npx vite build` (clean, fonts bundled).
- Engine: `llama-server -m models/<model>.gguf --host 127.0.0.1 --port 51820`; then
  `curl 127.0.0.1:51820/health` → `{"status":"ok"}`.
- End-to-end UI: `npm run dev` and open `http://localhost:1420` — the browser-dev fallback
  talks directly to the loopback engine, so the copilot streams a real grounded answer with
  a dual citation. (The shipped app uses IPC instead of fetch.)

---

## 7. Assumptions & risks

**Assumptions**
- The deterministic extraction core exists and yields line-addressable code + normalized
  conversations + link edges (per `<CURRENT_PLAN>`); the desktop consumes them.
- Air-gapped hosts have models **pre-staged**; there is no runtime download.
- WebView2 (Windows) / WebKit (macOS/Linux) is present (Tauri requirement).

**Risks → mitigations**
- *Small local model quality* → grounding + low temperature; route to larger GGUF/vLLM on
  capable hosts; the verdict is always backed by verifiable citations, so weak prose still
  points at the truth.
- *CORS / webview egress* → eliminated by proxying all model traffic through Rust; the
  webview makes no network calls.
- *Port conflicts* → configurable chat/embed ports; health-check detects bind failures.
- *vLLM only on Linux+NVIDIA* → engine-selection layer + llama.cpp fallback everywhere.

---

## 8. Air-gapped guarantees

**Must never touch the network at runtime:** model weights, corpus, conversations, queries,
answers, embeddings.

**How it is enforced**
- The **webview performs zero network I/O** — all inference goes through Tauri IPC to the
  Rust core, which only ever calls **loopback** engine ports.
- `inference.rs::assert_loopback` rejects any non-`127.0.0.1`/`localhost`/`[::1]` base URL
  when `offline_mode` is on (the default).
- reqwest is built with `.no_proxy()` and rustls (no system proxy/CA surprises).
- The CSP restricts `connect-src` to `self`/`ipc:` (+ loopback for the dev fallback only).
- HF download is a **staging-time** action on a *different, connected* machine; the app
  never downloads at runtime.

**How it is tested**
- With `offline_mode` on, any attempt to point a base URL off-loopback returns an error
  (unit-testable against `assert_loopback`).
- Network-namespace / firewalled run: the app functions fully with all non-loopback egress
  blocked, given a pre-staged model.

---

## 8.1 Packaging, engine sidecars & air-gapped updates

**Installers.** `bundle.targets: "all"` builds the native installer(s) for the current OS:
Windows `.exe` (NSIS) + `.msi` (WiX); macOS `.app` + `.dmg`; Linux `.deb` + `.rpm` +
`.AppImage`. Metadata (publisher, category, copyright) and per-OS options (NSIS install
mode, macOS `minimumSystemVersion`, deb `depends`) are set in `tauri.conf.json`. Build per
OS on that OS (or via CI runners) with `npm run app:build` — Tauri does not cross-compile
installers. Signing (Windows Authenticode, macOS notarization) is wired by adding the
relevant `bundle.windows.certificateThumbprint` / `bundle.macOS.signingIdentity` in CI; the
build here is unsigned.

**Engine sidecars (CI provisioning step).** The app currently **auto-detects or points at an
installed `llama-server`** (and `vllm` on Linux+NVIDIA), which keeps the repo binary-free and
the build reproducible. To ship a fully self-contained installer, bundle the engine as a
Tauri **sidecar**:
1. Place per-platform binaries at `src-tauri/binaries/llama-server-<target-triple>` (e.g.
   `-x86_64-pc-windows-msvc.exe`, `-aarch64-apple-darwin`, `-x86_64-unknown-linux-gnu`).
2. Add `"externalBin": ["binaries/llama-server"]` to `bundle` and grant
   `shell:allow-execute` (scoped) in the capability, then spawn via the shell plugin's
   `sidecar()` instead of an absolute path.
3. A CI job downloads the correct llama.cpp release per runner (Metal/CUDA/Vulkan/CPU
   variants) into `binaries/` before `tauri build`. This is deliberately left to CI because
   the GPU-specific binaries are large and platform-bound; the repo stays lean.

**Air-gapped update path.** Ship a new signed installer (or a Tauri updater bundle) on
physical/`approved-transfer` media; the updater is configured with a **local/LAN update
endpoint or a file** — never a public URL — so update checks stay inside the customer
network. Models are versioned separately in the models directory and are never fetched at
runtime.
