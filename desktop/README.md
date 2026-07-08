# Libbie.ai — Desktop (air-gapped / on-prem)

The enterprise, **air-gapped** deployment of Libbie.ai. Same institutional-memory
experience as the web app — ask *"why was this built this way?"* and get a one-line verdict
with a **dual citation** (the code line **and** the conversation that justified it) — but
**all inference and data stay on the machine**. Nothing leaves the customer's environment.

Built with **Tauri** (Rust core + React/TypeScript webview). The Rust core owns a local,
OpenAI-compatible inference engine; the webview reuses the web app's exact design system and
makes **zero network calls**.

- **Primary engine (spec):** vLLM on Linux + NVIDIA CUDA.
- **Fallback engine (implemented & tested):** llama.cpp `llama-server` (GGUF) — macOS
  (Metal), Windows, Linux, CPU / non-NVIDIA (Vulkan/CPU).

See [`BUILD_SPEC.md`](./BUILD_SPEC.md) for the full architecture, contracts, and milestones.

## Stack
Tauri 2 · Rust (tokio, reqwest, sysinfo) · React 19 · TypeScript · Vite 6 · Tailwind v4 ·
`motion` · lucide-react · self-hosted fonts (Hanken Grotesk + JetBrains Mono).

## Prerequisites
- **Node ≥ 20** and **Rust ≥ 1.77** (with the platform WebView: WebView2 on Windows,
  WebKitGTK on Linux).
- A **`llama-server`** binary (llama.cpp). On Windows: `winget install ggml.llamacpp`.
  On macOS: `brew install llama.cpp`. It is auto-detected on first run.
- A **GGUF chat model**, pre-staged into the models directory.

## Quick start

```bash
cd desktop
npm install

# 1) Stage a small model (do this on a connected machine, then copy to the air-gapped host)
hf download Qwen/Qwen2.5-0.5B-Instruct-GGUF \
  qwen2.5-0.5b-instruct-q4_k_m.gguf --local-dir ./models

# 2) Run the desktop app (spawns + manages llama-server for you)
npm run app:dev
```

In the app: open **Settings** (gear), confirm the `llama-server` path and models directory,
pick the chat model, and press **Start engine**. When the status pill turns green, press
**Ask Libbie** (⌘K) and ask a question — e.g. *"Why GRCh37 and not GRCh38?"*

## Build installers

```bash
npm run app:build   # .msi (Windows) / .dmg (macOS) / .AppImage/.deb (Linux)
```

## Development without the Tauri shell (browser)

The UI has a dev-only fallback so you can iterate in a normal browser. Start a standalone
`llama-server` and the Vite dev server:

```bash
# chat engine
llama-server -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 51820
# embedding engine (for semantic vector RAG)
llama-server -m models/nomic-embed-text-v1.5.Q8_0.gguf --host 127.0.0.1 --port 51821 \
  --embedding --pooling mean
npm run dev        # http://localhost:1420
```

Then open Settings → **Build index** to embed the corpus. In browser mode the client talks
directly to the loopback engines and keeps an in-memory index (dev only); the **shipped app
routes all inference through the Rust core over IPC** (streaming chat, embeddings, and a
`sqlite-vec` on-disk index) and makes no network calls.

## Retrieval
Libbie answers are grounded by retrieval over the indexed corpus. With a vector index built
(embedding model + **Build index** in Settings), retrieval is **semantic** (nomic-embed +
`sqlite-vec` KNN); without one it falls back to **keyword** retrieval. Either way the answer
carries a dual citation (code line + conversation) derived from what was retrieved.

## Air-gapped posture
- All model traffic is mediated by the Rust core and restricted to `127.0.0.1`.
- **Strict air-gapped mode** (Settings, on by default) makes the core reject any
  non-loopback destination.
- Models are **pre-staged**; there is no download at runtime. Stage on a connected machine
  and copy the GGUF files across.

## Layout
- `src/` — React UI + data layer (`lib/`), ported design system (`styles/globals.css`).
- `src-tauri/` — Rust core: `engine.rs` (lifecycle), `inference.rs` (OpenAI proxy),
  `config.rs` (settings), `commands.rs` (IPC).
- `models/` — pre-staged GGUF cache (git-ignored).

All demo content is authored **sample data**, labelled in the UI. The real
ingestion/retrieval core is `../docs/main_plan.md`.
