# Libbie.ai

**The institutional-memory layer for compute-heavy R&D.**

When a computational researcher leaves a team, the *intent* behind their pipelines leaves
with them. The code stays on the cluster, but the reasoning — why a parameter was set, which
reference build was assumed, what was tried and discarded — lives in scattered conversations
that decay on staff turnover. Libbie.ai reconstructs that intent.

Libbie.ai fuses three sources into one queryable memory — **code artifacts**, **conversational
provenance** (chat, PRs, meetings, email), and **domain knowledge** — and answers natural-language
questions like *"why was this built this way?"* with a grounded answer that **dual-cites** both the
exact code and the original conversation that justified it.

> The lead capability is **fusion**: a dual-cited answer that links a piece of code to the
> conversation that explains it — what code-only assistants and horizontal knowledge tools can't do.

---

## Status

**Phase 0 — MVP (built).** A deployed-quality, visually polished demo. Per `docs/mvp_plan.md`
the rule is *fake the engine, never fake the experience*: all content is authored,
version-controlled sample data, while the user-visible behaviour is real. The real
ingestion / retrieval / linking / local-inference stack is the main plan (`docs/main_plan.md`).

The MVP demonstrates: the dual-cited "magic moment", a technical ↔ executive view toggle,
a risk & staleness panel, one-click handover-document export, a freemium usage counter, a
"scanning at scale" indexing animation, and a local / air-gapped mode (a faked UI toggle in
the web MVP).

**Air-gapped desktop app (built).** The `desktop/` app makes the local path real: a Tauri
client running fully local inference (llama.cpp today, vLLM on NVIDIA hosts) with semantic
RAG over an embedded vector store and zero runtime network egress. See `desktop/README.md`.

## Repository layout

```
Libbie-ai/
├─ libbie/        # the Next.js web app (see libbie/README.md)
├─ desktop/       # the air-gapped Tauri desktop app (see desktop/README.md, desktop/BUILD_SPEC.md)
├─ docs/          # product & engineering docs
│  ├─ Libbie.ai_MVP_PRD.md   # product requirements (MVP)
│  ├─ mvp_plan.md            # MVP build plan (Phase 0)
│  └─ main_plan.md           # full engineering plan (the real product)
└─ README.md      # this file
```

The **desktop app** (`desktop/`) is Libbie's on-prem / air-gapped deployment: the same
copilot experience, but all inference runs locally (llama.cpp today, vLLM on NVIDIA hosts)
via a Tauri Rust core, with zero runtime network egress. It reuses the web app's design
system verbatim.

## Quick start

```bash
cd libbie
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

- `/` — public landing page (problem → fusion → how-it-works → on-prem → pricing).
- `/demo` — the live demo (the magic moment, risk panel, handover export, local mode).

### Desktop (air-gapped)

```bash
cd desktop
npm install
npm run app:dev     # runs the Tauri app; manages a local llama-server itself
```

Stage a GGUF model first (on a connected machine, then copy to the air-gapped host);
full instructions and the architecture are in `desktop/README.md` and
`desktop/BUILD_SPEC.md`. Real local inference: ask a "why" question and get a streamed,
dual-cited answer with nothing leaving the machine.

## Stack

**Web app** (`libbie/`): Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
shadcn/ui (base-ui) · motion · recharts · lucide-react.

**Desktop app** (`desktop/`): Tauri 2 (Rust core) · React 19 · Vite · Tailwind v4 · local
inference via **llama.cpp** (`llama-server`, GGUF) with **vLLM** on Linux+NVIDIA hosts ·
semantic RAG over an embedded **sqlite-vec** index (nomic-embed), lexical fallback.

The full server product additionally targets FastAPI, hybrid retrieval + reranking, and a
code↔conversation link graph — see `docs/main_plan.md`.

## Hero scenario (sample data)

A genomics germline variant-calling pipeline whose author (Elena Vasquez) has left. Libbie.ai
reconstructs why decisions were made — e.g. *"why GRCh37 and not GRCh38?"* — citing the exact
config line **and** the months-old Slack thread that justified it. All demo data is clearly
labelled as sample data in the UI.

## Deployment posture

Hosted SaaS (frontend on Vercel, containerized backend) and a fully **on-prem / air-gapped**
path — the difference is configuration, not a fork. The air-gapped tier is the premium,
regulated-buyer (pharma/biotech) offering: no code or conversational data leaves the
customer's environment.

The air-gapped tier ships two ways: the **desktop app** (`desktop/`, built) for single-host
/ workstation use, and a server-side Docker Compose stack from the same images (planned, see
`docs/main_plan.md`) for shared on-prem GPU hosts.
