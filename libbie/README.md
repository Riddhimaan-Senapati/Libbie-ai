# Libbie.ai — MVP

The institutional-memory layer for compute-heavy R&D. Libbie.ai reconstructs the
*intent* behind inherited pipelines by fusing **code + conversations + domain knowledge**,
answering "why was this built this way?" with citations to BOTH the code and the
conversation that justified it.

This is the **demo MVP** (Phase 0). Per `../docs/mvp_plan.md` the rule is: *fake the
engine, never fake the experience.* All content is authored, version-controlled sample
data; the user-visible behaviour is real. The real retrieval/ingestion/local-inference
stack is the main plan (`../docs/main_plan.md`).

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (base-ui) ·
motion · recharts · lucide-react.

## Run
```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## Routes
- `/` — public landing page (problem → fusion → how-it-works → on-prem → pricing).
- `/demo` — the live demo: scanning intro → magic-moment workspace (dual citations,
  technical/executive toggle, click-to-source), risk & staleness panel, handover export,
  freemium counter, local/air-gapped mode toggle.

## Where things live
- `lib/types.ts` — the data contract. `lib/data.ts` — single import surface + helpers.
- `lib/fixtures/*` — hero genomics pipeline, synthetic conversations, precomputed link
  map, dual-cited answers, staleness data.
- `components/landing/*` — landing sections. `components/demo/*` — the demo app.
- `CONTRACT.md` — the build contract (design system + data API) used to build the UI.

All sample data is labelled in the UI (NFR-6). The "local / air-gapped" path is a faked
UI toggle in this MVP; it gets wired to a real local model (Ollama) in the main plan.
