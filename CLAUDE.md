# CLAUDE.md — orientation for Claude Code sessions

Read this first. It's the map of the repo, how to build/test each part, the rules that keep
CI green, and the security invariants you must not break. Deep detail lives in
[`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md); the backlog is in
[`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).

## What Libbie is

The institutional-memory layer for compute-heavy R&D. It ingests what a lab actually produced
(code, HPC/SLURM job records, Slack/email conversation, papers), resolves relationships across
those sources into a **provenance graph**, and answers "why was this built this way?" with a
**dual citation** — the exact code line *and* the conversation that justified it.

Released: **v0.1.0** (desktop installers for Windows/macOS/Linux, built by CI on a `v*` tag).

## Repo layout — three surfaces, one design

| Path | What it is | Language |
|---|---|---|
| [`engine/`](engine/README.md) | The real provenance-graph backend: ingest → join → graph → briefing, connectors, eval. | Python (pydantic, httpx, typer) |
| [`desktop/`](desktop/README.md) | The shipped app: Tauri (Rust core + React webview). Local/cloud inference, connectors, graph view. | Rust + React/TS (Vite) |
| [`libbie/`](libbie/README.md) | The marketing + `/demo` website. **Authored sample data** — "fake the engine, never fake the experience." | Next.js 16 / React 19 |
| `shared/demo-data/` | Single-source demo fixtures re-exported by `libbie/` and (partially) the desktop demo. | TS |
| `docs/` | Product plans + `IMPLEMENTATION_REPORT.md` + `NEXT_STEPS.md`. | — |
| `.github/workflows/` | `ci.yml` (fmt/clippy/test + web builds) and `release.yml` (tauri-action installers on `v*`). | — |

`engine/` and `desktop/` are the substance; `libbie/` is the pitch surface over sample data.

## Build, run, test

Windows dev host; the Bash tool is Git Bash (POSIX). Python is at `engine/.venv/Scripts/`.

**Engine (Python):**
```bash
cd engine
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev,git,connectors]"
./.venv/Scripts/python -m pytest -q          # full suite (was 58 at v0.1.0)
./.venv/Scripts/libbie ingest --all --sample && ./.venv/Scripts/libbie join
./.venv/Scripts/libbie brief --pipeline germline
```
Default LLM backend is `mock` (deterministic, offline) so everything runs with no network/GPU.

**Desktop (Rust + React):**
```bash
cd desktop && npm install
npm run app:dev        # the Tauri app (manages a local llama-server)
npm run dev            # browser-dev of the webview only (http://localhost:1420)
# Rust core:
cd src-tauri && cargo test --lib
```

**Web (Next.js):**
```bash
cd libbie && npm install && npm run dev   # http://localhost:3000  (/ and /demo)
```

## CI gates — run these BEFORE you push (this has bitten us twice)

`.github/workflows/ci.yml` fails the build if any of these fail. Reproduce locally:
```bash
# Rust (desktop/src-tauri):
cargo fmt --check
cargo clippy --all-targets -- -D warnings     # warnings are ERRORS
cargo test --lib
# Web (libbie/ and desktop/):
npm run build                                  # runs tsc --noEmit then the bundler
# Engine:
./.venv/Scripts/python -m pytest -q
```
`cargo test` passing is NOT enough — `fmt` and `clippy -D warnings` are separate gates. After any
merge into a feature branch, re-run all of them. **Wait for the PR's CI to go green before merging**
(merging while "unstable" put a red build on `main` once).

## Conventions (do these the way the codebase already does)

- **Permissive licenses only** (MIT / BSD / Apache-2.0). No GPL/AGPL/LGPL/BUSL/SSPL. Before adding a
  dependency, verify its license. Known avoid-list already dodged: PyMuPDF (AGPL) → `pypdf`;
  pygit2/libgit2 (GPL) → GitPython/`git` CLI; PyGithub (LGPL) → httpx; `git2` (GPL) → `git` CLI;
  GoJS/yFiles/etc. (commercial) → `react-force-graph`.
- **Library research**: use the `/find-docs` (context7) and `/deep-research` skills to pick and
  verify libraries — that's how the current stack was chosen.
- **Python CLIs use Typer** (see the `libbie` CLI). Not raw click/argparse.
- **One LLM interface**: everything goes through `engine/libbie_engine/llm` `LLMBackend`
  (`local` / `api` / `mock`); the desktop mirrors this with a `ProviderTarget`. Keep a `mock`/offline
  path so tests need no network.
- **User-facing copy** (web + desktop UI strings) is run through the `/humanizer` skill — keep it
  free of rule-of-three cadence, em-dash overuse, "not X but Y", and AI-tell vocabulary.
- **Reqwest/httpx-direct** for HTTP; we deliberately avoid heavy provider SDKs.
- **`main` is the default branch.** Work on a feature branch → PR → merge after CI is green. End
  commit messages with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- **Next.js 16** in `libbie/` has breaking changes vs training data — see `libbie/AGENTS.md` and
  read `node_modules/next/dist/docs/` before touching Next internals.

## Security invariants (surfaced by adversarial review — do not regress)

- **Air-gap governs egress.** `desktop` `config.offline_mode` ON ⇒ only the Local provider; cloud
  chat, HuggingFace download, and the GitHub/Slack/Email connectors are all blocked. `set_config`
  validates this.
- **Loopback is enforced by URL-parsing the host** (`config::is_loopback_host`), never a substring
  match (`127.0.0.1.evil.com` must be rejected).
- **Secrets never reach the webview.** `get_config` returns a `redacted()` config (API keys, tokens
  masked to `SECRET_SENTINEL`); `set_config` merges the real values back. Never return raw secrets.
- **Never accept a filesystem path from the webview.** The graph loader (`open_graph_json`) opens the
  OS picker *in Rust*; do not reintroduce a `path` argument (that let the webview read any `.json`,
  including `config.json` of plaintext secrets).
- **IMAP must verify TLS.** Python `imaplib.IMAP4_SSL()`'s default context does NOT verify certs —
  always pass `ssl.create_default_context()`.
- **Safe git clone**: token via ephemeral `GIT_ASKPASS` + `-c credential.helper=` (never in argv or
  `.git/config`), `--filter=blob:limit`, validated `owner/repo`.
- **The join layer's honesty rule**: edges below the commit threshold stay `hypothesis`, surfaced in
  the briefing's §7. *Wrong edges are worse than missing edges.*

## Cutting a release
```bash
git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z
```
`release.yml` builds installers for all three OSes and publishes a GitHub Release (the README
download links point at `/releases/latest`). Installers are currently **unsigned** (see NEXT_STEPS).

## Where the context is
- [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) — what was built + the license/security audits.
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) — prioritized backlog for the next session.
- [`docs/main_plan.md`](docs/main_plan.md) — the full engineering plan the engine implements.
- Per-surface detail: [`engine/README.md`](engine/README.md), [`desktop/README.md`](desktop/README.md), [`libbie/README.md`](libbie/README.md).
