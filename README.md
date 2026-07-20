# Libbie.ai

**The institutional-memory layer for compute-heavy R&D.**

When a computational researcher leaves, the code stays on the cluster but the *reasoning*
leaves with them: why a parameter was set, which reference build was assumed, what was tried
and dropped. Libbie reconstructs that reasoning. It reads what a lab actually produced (code,
HPC job records, chat and email, and papers), links each decision to the line and the
conversation behind it, and answers "why was this built this way?" with a grounded answer that
**cites both the code and the conversation that justified it**.

The core feature is **fusion**: an answer that ties a piece of code to the discussion that
explains it, which code-only assistants and generic knowledge tools can't do.

---

## Download the desktop app

The air-gapped desktop app runs Libbie fully on your machine: local models by default, or any
cloud API key you choose. Grab the installer for your OS from the latest release:

| OS | Installer | Download |
|---|---|---|
| **Windows** | `.exe` (NSIS) / `.msi` | [Latest release ↓](https://github.com/Riddhimaan-Senapati/Libbie-ai/releases/latest) |
| **macOS** | `.dmg` (Apple Silicon + Intel) | [Latest release ↓](https://github.com/Riddhimaan-Senapati/Libbie-ai/releases/latest) |
| **Linux** | `.AppImage` / `.deb` / `.rpm` | [Latest release ↓](https://github.com/Riddhimaan-Senapati/Libbie-ai/releases/latest) |

> Installers are built and attached to a GitHub Release by CI (`.github/workflows/release.yml`)
> whenever a `v*` tag is pushed. If the release list is empty, the maintainer hasn't tagged a
> build yet, so you can build one yourself with `cd desktop && npm run app:build` (see
> [`desktop/README.md`](desktop/README.md)).

After installing, open **Settings** to pick how you want to run: a local model, a cloud
provider, or a repo pulled straight from GitHub. Details below.

---

## What's in the repo

Libbie ships as three parts that share one design and one goal:

| Directory | What it is |
|---|---|
| [`desktop/`](desktop/README.md) | The **air-gapped desktop app** (Tauri + Rust). Local inference via llama.cpp/vLLM, or any cloud provider you configure. The shipped product. |
| [`libbie/`](libbie/README.md) | The **web demo** (Next.js). The polished "magic moment" over authored sample data — the pitch surface. |
| [`engine/`](engine/README.md) | The **provenance-graph engine** (Python). The real backend: ingest → join → graph → briefing, with a GitHub integration and an edge-quality eval. |

---

## Features

### Desktop app (`desktop/`)
- **Ask "why", get a dual-cited answer** — a one-line verdict, then the exact code line *and*
  the conversation that justified it.
- **Run it your way** — pick a **chat provider** in Settings:
  - **Local** (llama.cpp / vLLM) — no API key, nothing leaves the machine.
  - **Any OpenAI-compatible API** — one base-URL + key + model field covers OpenAI, Groq,
    Together, Mistral, OpenRouter, or a self-hosted vLLM.
  - **Anthropic** — the Messages API natively.
- **Bring your own model** — choose a GGUF already on disk, or **download one from Hugging
  Face** inside the app (list a repo's `.gguf` files and pull one with a progress bar).
- **Token & cost tracking** — a Tokens panel shows input/output tokens per call and for the
  session, tokens/sec for local models, and an estimated dollar cost for cloud models from an
  editable price table.
- **Connect your own sources** — sign in with your own account and index what you actually use:
  - **GitHub** (OAuth device flow) — any repo you can access, including private and org repos.
  - **Slack** (paste an `xoxp-` token or OAuth) — pick channels/DMs and pull their history.
  - **Email** — Gmail (OAuth, read-only) or any mailbox over **IMAP** (app password); pick
    labels/mailboxes to index.
- **Knowledge graph** — explore the provenance graph visually: nodes coloured by type, committed
  vs unverified (hypothesis) links, an inspector, and filters. Loads the bundled sample or your
  own `graph.json`.
- **Token & cost tracking** — a Tokens panel shows input/output tokens per call and for the
  session, tokens/sec for local models, and an estimated dollar cost for cloud models.
- **Semantic retrieval** — an on-disk `sqlite-vec` index (nomic-embed) with keyword fallback.
- **Air-gapped by default** — strict mode keeps every request on `127.0.0.1` and disables all
  egress (cloud providers, downloads, and every connector). Turn it off to reach cloud services.

### Web demo (`libbie/`)
The landing page and a live `/demo`: the dual-cited magic moment, a technical ↔ executive
toggle, a risk & staleness panel, one-click handover export, and a local-mode toggle. Runs on
authored sample data, clearly labelled in the UI.

### Engine (`engine/`)
- **Ingest** SLURM/HPC job records, git history, Slack/`.eml` conversations, and PDFs into
  typed nodes.
- **Join layer** — candidate generation across artifact classes, LLM adjudication, and a
  commit-vs-hypothesis rule (wrong edges are worse than missing ones).
- **Inheritance Briefing** — a generated markdown handover doc per pipeline.
- **Connectors** — `libbie github|slack|email …` pull any accessible repo, Slack channels, or
  Gmail/IMAP mail into the graph (email threads reconstructed by root header).
- **Edge-quality eval** — precision/recall per edge type against a hand-labelled gold set.

---

## Quick start

### Desktop app (from source)
```bash
cd desktop
npm install
npm run app:dev        # runs the Tauri app; manages a local llama-server for you
```
Then open **Settings** and either point at a local GGUF, paste a cloud API key, or connect
GitHub. Full walkthrough: [`desktop/README.md`](desktop/README.md).

### Web demo
```bash
cd libbie
npm install
npm run dev            # http://localhost:3000  (/ and /demo)
```

### Engine
```bash
cd engine
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev,git]"
libbie ingest --all --sample && libbie join && libbie brief --pipeline germline
```

---

## Using the key features

**Pick a provider (desktop).** Settings → *Chat provider*. Local keeps the air-gap; a cloud
provider needs strict air-gap turned off. For OpenAI-compatible endpoints, set the base URL,
key, and model; for Anthropic, set the key and model. Keys are stored by the Rust core and are
never handed back to the UI.

**Download a model (desktop).** Settings → *Download a model from HuggingFace*. Enter a GGUF
repo (e.g. `Qwen/Qwen2.5-0.5B-Instruct-GGUF`), list its files, and download one into your
models folder. Disabled in strict air-gapped mode.

**Track tokens and cost (desktop).** Click **Tokens** in the top bar. Every answer records its
input/output tokens; local models show tokens/sec, cloud models show an estimated cost you can
tune in `desktop/src/lib/pricing.ts`.

**Index a GitHub repo (desktop).** Settings → *Connect GitHub*. Authorize via the device-flow
code, pick a repo, and index it. Needs a registered GitHub OAuth App client id (set
`LIBBIE_GITHUB_CLIENT_ID` or paste it in Settings) and strict air-gap off. For SSO-enforced
orgs, authorize the token for the org first.

**Ingest a repo into the graph (engine).** `libbie github login` → `libbie github repos` →
`libbie github ingest <owner/repo>`, then `libbie join` and `libbie brief`.

---

## Building & releasing the desktop app

Build installers on the target OS (Tauri does not cross-compile):
```bash
cd desktop && npm run app:build
# artifacts in src-tauri/target/release/bundle/ (nsis/msi, dmg, appimage/deb/rpm)
```
Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds installers for Windows,
macOS, and Linux and attaches them to a GitHub Release, the source of the download links above.

## Licensing posture

MIT, and permissive throughout. Runtime dependencies are MIT / BSD / Apache-2.0 only, with no
GPL/AGPL/SSPL. The engine avoids the common copyleft traps in this space (pypdf
over PyMuPDF, GitPython over pygit2, reqwest/httpx over LGPL clients). See
[`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) for the full audit.

## Docs
- [`desktop/README.md`](desktop/README.md) — desktop app: providers, models, GitHub, air-gap.
- [`engine/README.md`](engine/README.md) — the provenance engine and CLI.
- [`libbie/README.md`](libbie/README.md) — the web demo.
- [`docs/main_plan.md`](docs/main_plan.md) — the full engineering plan.
- [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) — what's built, license audit, security review, eval.
