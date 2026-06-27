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
the MVP; wired to a real local model in the main plan).

## Repository layout

```
Libbie-ai/
├─ libbie/        # the Next.js web app (see libbie/README.md)
├─ docs/          # product & engineering docs
│  ├─ Libbie.ai_MVP_PRD.md   # product requirements (MVP)
│  ├─ mvp_plan.md            # MVP build plan (Phase 0)
│  └─ main_plan.md           # full engineering plan (the real product)
└─ README.md      # this file
```

## Quick start

```bash
cd libbie
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

- `/` — public landing page (problem → fusion → how-it-works → on-prem → pricing).
- `/demo` — the live demo (the magic moment, risk panel, handover export, local mode).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (base-ui) ·
motion · recharts · lucide-react. The full product additionally targets FastAPI, hybrid
retrieval + reranking, a code↔conversation link graph, and a local model via Ollama/vLLM
for the on-prem / air-gapped tier — see `docs/main_plan.md`.

## Hero scenario (sample data)

A genomics germline variant-calling pipeline whose author (Elena Vasquez) has left. Libbie.ai
reconstructs why decisions were made — e.g. *"why GRCh37 and not GRCh38?"* — citing the exact
config line **and** the months-old Slack thread that justified it. All demo data is clearly
labelled as sample data in the UI.

## Deployment posture

Hosted SaaS (frontend on Vercel, containerized backend) and a fully **on-prem / air-gapped**
Docker Compose stack from the same images — the difference is configuration, not a fork. The
air-gapped tier is the premium, regulated-buyer (pharma/biotech) offering: no code or
conversational data leaves the customer's environment.
