# Libbie.ai — Desktop

The desktop deployment of Libbie.ai. Ask *"why was this built this way?"* and get a one-line
verdict with a **dual citation**: the code line **and** the conversation that justified it.

It runs the way you want it to. By default everything stays on your machine: local models via
llama.cpp (vLLM on Linux + NVIDIA), with no network egress. When you'd rather use a hosted
model, point it at any cloud provider with an API key. You can pick a model already on disk,
pull one from Hugging Face inside the app, or connect your GitHub account and index one of your
own repositories.

Built with **Tauri** (Rust core + React/TypeScript webview). The Rust core owns all model
traffic; the webview never makes network calls of its own, and secrets never leave the core.

## Download

Grab an installer for your OS from the
[latest release](https://github.com/Riddhimaan-Senapati/Libbie-ai/releases/latest) — Windows
(`.exe`/`.msi`), macOS (`.dmg`), or Linux (`.AppImage`/`.deb`/`.rpm`). Or build from source
(below).

## Features

- **Dual-cited answers** grounded in retrieval over an indexed corpus.
- **Chat provider picker** (Settings → *Chat provider*):
  - **Local** — llama.cpp / vLLM on a loopback port. No key, no egress.
  - **OpenAI-compatible** — OpenAI, Groq, Together, Mistral, OpenRouter, or a self-hosted vLLM,
    via base URL + key + model.
  - **Anthropic** — the Messages API natively.
- **Model management** — select a GGUF from your models folder, or **download one from Hugging
  Face** in-app (list a repo's `.gguf` files, download with a progress bar).
- **Token & cost panel** — per-call and per-session input/output tokens, tokens/sec for local
  models, and an estimated dollar cost for cloud models (editable price table).
- **GitHub integration** — connect via OAuth device flow and index any repo you can access,
  including private and org repos, then chat about your own code.
- **Slack integration** — paste an `xoxp-` user token or use OAuth v2; pick channels/DMs and
  index their history (Settings → *Connect Slack*).
- **Email integration** — Gmail (OAuth, read-only) or any mailbox over IMAP (app password);
  pick labels/mailboxes to index (Settings → *Connect Email*). Reply chains are threaded by root.
- **Knowledge-graph view** — a `react-force-graph` view of the provenance graph (TopBar →
  *Graph*): nodes coloured by kind, committed (solid) vs hypothesis (dashed) links, width by
  confidence, an inspector, and node-kind/edge-type filters. The sample graph ships as a static
  asset fetched on demand (not bundled JS); load your own `graph.json` with *Load graph.json…*
  (the picker runs in the Rust core).
- **Semantic retrieval** — an on-disk `sqlite-vec` index (nomic-embed), with keyword fallback.

## Stack
Tauri 2 · Rust (tokio, reqwest, rusqlite + sqlite-vec, sysinfo with the `system` feature only) ·
React 19 · TypeScript · Vite 6 · Tailwind v4 · `motion` via LazyMotion (domAnimation feature set) ·
lucide-react · self-hosted fonts. Release builds use fat LTO, one codegen unit, stripped symbols,
and abort-on-panic (see `[profile.release]` in `src-tauri/Cargo.toml`).

## Prerequisites (building from source)
- **Node ≥ 20** and **Rust ≥ 1.77** (with the platform WebView: WebView2 on Windows,
  WebKitGTK on Linux).
- For **local** inference: a **`llama-server`** binary (llama.cpp). Windows:
  `winget install ggml.llamacpp`; macOS: `brew install llama.cpp`. Auto-detected on first run.
- A **GGUF chat model** — either downloaded in-app, or staged into the models directory.

## Quick start

```bash
cd desktop
npm install
npm run app:dev        # runs the Tauri app; manages llama-server for you
```

Then open **Settings** (gear) and choose one of:

- **Local model.** Confirm the `llama-server` path, pick a chat model (or download one from
  Hugging Face right there), and press **Start engine**. When the status pill turns green, ask
  a question with **Ask Libbie** (⌘K).
- **Cloud provider.** Turn off *Strict air-gapped mode*, choose OpenAI-compatible or Anthropic,
  paste your key and model, and ask away — no local engine needed.
- **A GitHub repo.** Turn off air-gap, open *Connect GitHub*, authorize the device code, pick a
  repo, and index it; retrieval then grounds answers on that code.

## Using the features

**Providers.** Local keeps the strict air-gap. Cloud providers require air-gap off. Keys are
held by the Rust core and are never returned to the webview (the UI shows a masked placeholder;
leave it blank to keep the stored key).

**Download a model.** Settings → *Download a model from HuggingFace*. Enter a GGUF repo, list
its files, download one into the models folder. Disabled while strict air-gap is on.

**Tokens & cost.** Click **Tokens** in the top bar. Usage is read from each provider's response
(OpenAI-compatible `usage`, llama.cpp `timings`, Anthropic streaming usage); cloud cost comes
from `src/lib/pricing.ts`, which you can edit.

**GitHub.** Settings → *Connect GitHub*. Needs a GitHub OAuth App client id — set
`LIBBIE_GITHUB_CLIENT_ID` or paste it in Settings. Requests the `repo` scope for private and
org access; for SSO-enforced orgs, authorize the token for the org first. The token is stored by
the core and used only to clone over a token-less URL (never written to `.git/config` or argv).

**Slack.** Settings → *Connect Slack*. Easiest path: paste a user token (`xoxp-…`) from your own
Slack app — no OAuth registration needed. For OAuth v2 instead, set a Slack app client id/secret
(`LIBBIE_SLACK_CLIENT_ID` / `LIBBIE_SLACK_CLIENT_SECRET`) and register the fixed loopback redirect
`http://localhost:3118/callback` (Slack does not allow arbitrary ports). Then pick channels/DMs to
index. Scopes read history only.

**Email.** Settings → *Connect Email*. Gmail uses OAuth (browser consent, `gmail.readonly`) — set a
Google installed-app client id/secret (`LIBBIE_GMAIL_CLIENT_ID` / `_SECRET`). IMAP uses host + user
+ app password over verified TLS. Pick labels/mailboxes to index; reply chains thread by root.

**Knowledge graph.** TopBar → *Graph*. Explore the provenance graph — filter by node kind / edge
type, click a node to inspect its fields and incident edges. *Load graph.json…* opens a native
picker (in the Rust core) to view a real `libbie join` output; the bundled sample renders by default.

All connectors are egress and are disabled while strict air-gapped mode is on; connector tokens/
passwords are held by the Rust core and never returned to the webview.

## Build installers

```bash
npm run app:build                        # all installers for the current OS
npm run tauri -- build --bundles nsis    # a single target (e.g. Windows NSIS .exe)
```

Artifacts land in `src-tauri/target/release/bundle/`:
- **Windows** — `nsis/*-setup.exe`, `msi/*.msi`
- **macOS** — `dmg/*.dmg`, `macos/*.app`
- **Linux** — `deb/*.deb`, `rpm/*.rpm`, `appimage/*.AppImage`

Build per OS on that OS (Tauri doesn't cross-compile installers). CI does this for all three:
pushing a `v*` tag runs [`../.github/workflows/release.yml`](../.github/workflows/release.yml),
which builds and attaches the installers to a GitHub Release. To bundle `llama-server` as a
sidecar for a self-contained installer, see [`BUILD_SPEC.md`](./BUILD_SPEC.md) §8.1.

## Development in a browser

The UI has a dev-only fallback so you can iterate without the Tauri shell. Start standalone
engines and the Vite dev server:

```bash
llama-server -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 51820
llama-server -m models/nomic-embed-text-v1.5.Q8_0.gguf --host 127.0.0.1 --port 51821 \
  --embedding --pooling mean
npm run dev        # http://localhost:1420
```

In browser mode the client talks to the loopback engines directly and keeps an in-memory index;
the shipped app routes everything through the Rust core over IPC. The GitHub and download flows
are desktop-only (they need the native runtime), so those buttons report "desktop app only" in
the browser.

## Air-gapped posture
- All model traffic is mediated by the Rust core; local targets are restricted to `127.0.0.1`
  (the host is URL-parsed and matched exactly, so a spoofed `127.0.0.1.evil.com` is rejected).
- **Strict air-gapped mode** (Settings, on by default) allows only the Local provider and
  disables downloads and GitHub — nothing leaves the machine. Turn it off to reach cloud
  services.
- Secrets (API keys, the GitHub token) live in the Rust core and are never sent to the webview.

## Layout
- `src/` — React UI + data layer (`lib/`), ported design system (`styles/globals.css`),
  `components/TokenPanel.tsx`, `lib/pricing.ts`. The streamed answer text lives in
  `lib/verdictStore.ts`, outside React state, so tokens re-render one paragraph instead of the
  workspace.
- `src-tauri/src/` — Rust core: `engine.rs` (local engine lifecycle), `inference.rs` (provider
  proxy + usage capture), `config.rs` (settings + provider targets + secret redaction),
  `github.rs` (device flow + safe clone/update), `commands.rs` (IPC), `vecstore.rs` (sqlite-vec).
- `models/` — GGUF cache (git-ignored).

Demo content ships as authored **sample data**, labelled in the UI. The full ingestion engine
is [`../engine/`](../engine/README.md); the plan is [`../docs/main_plan.md`](../docs/main_plan.md).
