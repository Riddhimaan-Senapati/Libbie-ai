# Libbie.ai — MVP Demo Plan

**Document type:** Build plan for the accelerator demo (companion to `Libbie.ai_MVP_PRD.md`)
**Relationship to PRD:** This plan implements the PRD's MVP scope. Every FR / NFR / DR / WR / MR is accounted for in the traceability table (Section 11); nothing in the PRD is dropped.
**Core stance:** Demo-first. The product must *look* like a finished enterprise system and the magic moment must land every time. Almost everything behind the glass is faked, precomputed, or fixtured — by design — so there is nothing to misfire on stage.

> The one rule for the MVP: **fake the engine, never fake the experience.** The user-visible behaviour (dual-cited intent reconstruction, view switching, staleness flags, handover export, a real local query) must feel completely real. The plumbing under it does not have to be.

---

## 1. Guiding Principle — What's Real vs What's Faked

| Capability | MVP status | How it's done |
|---|---|---|
| Polished enterprise web UI | **Real** | Next.js + Tailwind + shadcn/ui, genuinely built |
| Hero pipeline + synthetic conversations | **Real fixtures** | Static, hand-authored, version-controlled JSON/MD, labeled as sample data |
| Code↔conversation links | **Precomputed** | Hand-curated link map shipped as a static fixture (PRD locked decision 6) |
| Magic-moment Q&A answers | **Precomputed** | Rehearsed questions return authored, grounded answers with dual citations |
| Technical ↔ executive view toggle | **Real (faked content)** | Both views authored per answer; toggle is real |
| Risk & staleness panel | **Static data** | Real-looking version table (e.g., reference-genome build drift) |
| Handover document generation | **Pre-rendered** | One-click "generate" reveals a pre-built, polished PDF |
| Free-tier limit + upgrade path | **Static UI** | Query counter and locked "Enterprise / on-prem" affordance |
| "Scanning at scale" indexing | **Animated over pre-built index** | Progress visualization (PRD DR-5) |
| **Air-gapped / local query** | **REAL — the one real path** | A single question answered by a local model with no network (PRD locked decision 5) |

The air-gapped query is the *only* component that does real inference. It exists to prove the on-prem story is not vapor (Success Criteria, PRD §14). Everything else is choreography.

---

## 2. Open-Source Stack (MVP)

Bias: maximum open-source, minimum moving parts.

**Frontend / app**
- **Next.js** (App Router) — MIT. PRD locked decision 3.
- **React** + **TypeScript**.
- **Tailwind CSS** + **shadcn/ui** (Radix UI primitives) — the fastest route to a polished, non-templated enterprise look.
- **Framer Motion** — the "scanning/indexing" animation and view transitions.
- **Shiki** or **react-syntax-highlighter** — real code rendering with line-level highlight anchors for citations.
- **CodeMirror 6** (optional) — if you want the code panel to feel like an editor.
- **Recharts** or **visx** — staleness/risk charts.
- **Lucide** icons — MIT.

**Content / data (all static for MVP)**
- Fixtures as plain **JSON + Markdown** in the repo. No database needed.
- **Zod** — schema-validate fixtures so the UI never breaks on malformed sample data.

**The one real path (air-gapped query)**
- **Ollama** — MIT. One-command local serving.
- **Qwen3 14B** (Apache 2.0) — strong default local model; runs on a single consumer GPU or a high-memory Mac. **Mistral Small 3** (Apache 2.0) is the fallback — it's tuned to say "I don't know" rather than hallucinate, which protects the on-stage moment.
- A tiny **FastAPI** (or Next.js route handler) wrapper that takes the question + the precomputed hero context and calls the local model. No retrieval needed — the context is the fixture.

**Handover export**
- **WeasyPrint** (HTML→PDF, BSD) or **Pandoc** (GPL) — render the handover doc to a polished PDF. For the MVP this can be pre-rendered once and simply served.

**Deployment**
- **Vercel** — native Next.js, custom domain, built-in analytics (PRD WR-1/3/4). Reliable for a live demo (NFR-4).
- The local-query box runs on a laptop/mini-PC you bring; it does **not** depend on Vercel and works with the network cable pulled.

---

## 3. Feature Build-Out (mapped to PRD Functional Requirements)

### 3.1 Ingestion & "scanning at scale" — FR-1..FR-4, DR-5
No real ingestion. Ship a pre-built index as a fixture. On "Connect codebase," play a **Framer Motion** progress visualization that scans file names, conversation sources, and dependency versions, then resolves to the loaded hero pipeline. The PRD explicitly permits this (DR-5). Label all sample data in the UI (NFR-6).

### 3.2 The Magic Moment — FR-5..FR-8 (core)
- A query box plus a small set of **rehearsed questions** as clickable chips (DR-4), e.g. *"Why was this reference build chosen?"*, *"Why is the mapping-quality filter set this high?"*
- Each maps to an authored answer fixture containing: the plain-language reasoning, a **code citation** (file path + line range, anchored in the code panel), and a **conversation citation** (the months-old chat/PR/email snippet that justified it). Both render side-by-side, both are click-to-source (FR-7, FR-8).
- A free-text box is allowed but routes unmatched questions to a graceful "I can answer these for the loaded pipeline…" prompt that re-surfaces the rehearsed chips, so it never dead-ends on stage.

### 3.3 Audience views — FR-9
Each answer fixture carries two authored payloads: a **technical view** (paths, parameters, versions, detail) and an **executive view** (plain-language continuity summary). A real toggle switches between them instantly.

### 3.4 Risk & Staleness panel — FR-10, FR-11
A static, real-looking panel for the hero pipeline: reference build + key library/dependency versions, a "current version" column (pre-curated, as the PRD allows), and flags where the pipeline is behind, with a one-line caution about updating. The genomics hero makes this vivid (reference-genome build drift; see §4).

### 3.5 Handover document generation — FR-12, FR-13
"Generate handover document" runs a 1–2 second faux-generation animation and reveals a **pre-built, polished PDF** consolidating purpose, environment, dependencies, file locations, and key reasoning. Exportable/downloadable (FR-13). Built once with WeasyPrint/Pandoc from the same fixtures.

### 3.6 Air-gapped demonstration — FR-14, locked decision 5 (THE one real thing)
One rehearsed question is wired to the **local Ollama + Qwen3** path. Visibly toggle "Local / air-gapped mode," pull the network (or show a no-network indicator), ask the question, and get a real grounded answer from the local model. This is the proof point that the on-prem mode is real, not claimed.

### 3.7 Freemium UI — MR-1, MR-3
A visible usage counter ("23 / 50 free queries") and a locked **"On-prem deployment — Enterprise"** affordance. Upgrade path is non-functional (PRD permits this). This foregrounds the real monetization lever (on-prem as paid tier, decision 8) rather than nickel-and-diming.

### 3.8 Public landing page — WR-1, WR-2
A problem→solution landing page, visually consistent with the product (NFR-3), routing to the live demo. Same Next.js app, same design system.

---

## 4. Hero Pipeline & Synthetic Data (DR-1, DR-2, DR-3)

**Hero pipeline:** an **nf-core-style genomics pipeline** (e.g., variant calling or RNA-seq) — a recognizable open project, credible to a technical audience, and squarely in the pharma/biotech vertical.

Why it's the right hero:
- **"Reference build" is literal** — reference-genome builds (GRCh37 → GRCh38 → T2T-CHM13). This is a gift for the staleness panel: "this pipeline assumes GRCh37; current is GRCh38 — coordinates and annotations differ, here are the cautions."
- **Parameters carry real rationale** — aligner settings, mapping-quality and depth filters — perfect intent-reconstruction targets.
- **Lands in the buyer's world** — the pharma/biotech R&D director recognizes it instantly.

**Synthetic conversation set** (authored, labeled as sample — NFR-6, DR-2): a small spread of formats so fusion is obvious —
1. a **chat thread** where the (departed) author justifies the reference-build choice,
2. a **PR review** tying a specific config line to a filtering decision,
3. a **meeting-notes** snippet,
4. an **email** about a dependency pin.

Each record names the exact file path / parameter so the link is traceable (FR-7), carries the rationale the magic moment surfaces, and reads realistically (dated, multiple participants, light noise). The **code↔conversation link map is hand-curated and shipped as a static fixture** (DR-3 / locked decision 6) so the magic moment is instant and unbreakable.

---

## 5. Demo Choreography & Safety Nets (DR-4, DR-6, NFR-1, NFR-4)

- **Rehearsed question set** that always lands (DR-4), surfaced as chips.
- **Recorded backup** of the full flow (DR-6) — a screen recording, independent of live conditions.
- **Offline fallback** — because answers are fixtures and the one real path is local, the entire demo runs with **no internet** if needed (NFR-4). Vercel is the happy path; the laptop is the insurance.
- **Trust:** the magic-moment path cannot misfire because it is authored, not generated (NFR-1).

---

## 6. Deployment (WR-1..WR-5)

- **Vercel** for the app + landing page; custom domain via your registrar pointed at Vercel (WR-3); built-in analytics (WR-4); low-ops (WR-5).
- Bring the **air-gapped box** (laptop/mini-PC running Ollama) to the interview for the local-mode segment.
- Keep a local `next build && next start` runnable so the whole thing works without network for the recorded/offline fallback.

---

## 7. Suggested Build Timeline (~2–3 weeks, 1–2 builders)

1. **Days 1–3 — Design system + landing page.** Tailwind + shadcn/ui, lock the enterprise look (NFR-3). This is load-bearing; do it first.
2. **Days 4–6 — Hero fixtures.** Author the genomics pipeline snapshot, the four conversation records, the curated link map, and the two-view answer fixtures. Validate with Zod.
3. **Days 7–9 — Core UI.** Query box + rehearsed chips, side-by-side code/conversation citation panels, technical↔executive toggle, "scanning" animation.
4. **Days 10–11 — Risk panel + handover PDF.** Static staleness table; pre-render the handover PDF.
5. **Days 12–13 — The one real path.** Ollama + Qwen3 wired to a single rehearsed question; local-mode toggle; pull-the-cable rehearsal.
6. **Day 14 — Freemium UI + polish + record backup (DR-6).**
7. **Buffer — rehearse.** The demo is a performance; rehearse the script until it's boring.

---

## 8. Explicit Non-Goals for the MVP (PRD §4)

Do **not** build, even if tempted: real multi-TB ingestion, multi-tenant auth/RBAC, automated literature/method-change detection, a general coding assistant. Real retrieval and a real database are also out — they belong to the main plan.

---

## 9. Hand-off to the Main Plan — Order in Which Fakes Get Replaced

By interview time you hope to have started replacing fakes with real systems. The order that buys the most credibility per unit effort:

1. **Real retrieval over the hero pipeline** (replace the curated link map with hybrid retrieval + a real link layer) — turns the magic moment from "authored" into "earned."
2. **Real ingestion of one extra pipeline** — proves it generalizes beyond the hero fixture.
3. **Real handover generation** from live data (replace the pre-rendered PDF).
4. **Real staleness checks** (live version lookups).

Each of these is the front edge of the main plan (`main_plan.md`), so progress on the MVP flows directly into the real product with no throwaway work.

---

## 10. Open-Source Inventory (MVP, at a glance)

Next.js · React · TypeScript · Tailwind CSS · shadcn/ui · Radix UI · Framer Motion · Shiki / react-syntax-highlighter · CodeMirror 6 · Recharts / visx · Lucide · Zod · Ollama · Qwen3 / Mistral Small (Apache 2.0) · FastAPI · WeasyPrint / Pandoc.

Only non-OSS dependency: the Vercel hosting platform (the app itself is portable and can run anywhere via `next start` / Docker).

---

## 11. Requirements Traceability (PRD → MVP)

| PRD req | Covered by |
|---|---|
| FR-1..FR-4 (ingest/fuse) | §3.1 — pre-built index + scanning animation (DR-5) |
| FR-5..FR-8 (Q&A, dual-cite, locations) | §3.2 — authored answer fixtures, side-by-side citations |
| FR-9 (audience views) | §3.3 — real toggle, two authored payloads |
| FR-10, FR-11 (risk/staleness) | §3.4 — static panel, curated current-version data |
| FR-12, FR-13 (handover doc) | §3.5 — pre-rendered exportable PDF |
| FR-14 (air-gapped) | §3.6 — real local Ollama + Qwen3 query |
| NFR-1 (trust) | §5 — authored magic-moment path cannot misfire |
| NFR-2 (responsiveness) | Fixtures are instant; local path kept to one snappy query |
| NFR-3 (visual quality) | §2, §7 step 1 — design system built first |
| NFR-4 (demo availability) | §5, §6 — offline fallback + recorded backup |
| NFR-5 (privacy posture) | §3.6 — real local path; app is portable/containerizable |
| NFR-6 (sample labeling) | §3.1, §4 — sample data labeled in UI |
| DR-1..DR-6 (demo reqs) | §4, §5 — hero, synthetic logs, precomputed links, rehearsed Qs, scanning viz, recording |
| WR-1..WR-5 (deploy/site) | §6 — Vercel, landing page, custom domain, analytics, low-ops |
| MR-1, MR-3 (freemium UI) | §3.7 — counter + locked on-prem affordance |
| MR-2 (on-prem = paid) | §3.7 — Enterprise affordance frames on-prem as paid |
| §11 defensibility (fusion lead) | §3.2, §4 — dual-citation fusion is the centerpiece |
