# Product Requirements Document — Libbie.ai (working title)

**Product:** AI-native institutional-memory layer for compute-heavy R&D teams
**Document type:** MVP PRD (demo-grade build for accelerator)
**Status:** Draft for technical team
**Owner:** Founder
**Scope note:** This document specifies *what* the MVP must do and *why*. Implementation choices (architecture, libraries, data stores, retrieval design) are delegated to the technical team except where a directional decision is explicitly locked in Section 12.

---

## 1. Overview

When a computational researcher leaves a team, the *intent* behind their pipelines leaves with them. The code may remain on the cluster, but the reasoning — why a parameter was set a certain way, which reference build was assumed, what was tried and discarded — lives in scattered conversations (chat threads, meeting notes, PRs, email) and is effectively lost.

Libbie.ai fuses three sources into one queryable memory:

1. **Artifacts** — scripts, configs, environment files, READMEs.
2. **Conversational provenance** — chat threads, meeting transcripts, PR discussions, email where humans explained *why*.
3. **External domain knowledge** — reference-build changelogs, library/version release information.

The product lets a user ask a natural-language question and receive a grounded answer that reconstructs intent, citing both the relevant code and the original conversation that justified it. This applies to academic research labs and to enterprise / regulated R&D organizations (pharma, biotech, and other compute-heavy fields) alike.

---

## 2. Problem Statement

- Code is increasingly commoditized by general coding assistants, but those tools index code in isolation. They do not ingest an organization's conversational history and cannot answer *why* a piece of code exists.
- The reasoning behind research and engineering pipelines is undocumented and distributed across human conversations that decay and disappear on staff turnover.
- Non-technical leads (PIs, R&D directors) have no way to interrogate inherited pipelines without a technical intermediary.
- Incoming team members spend weeks reverse-engineering inherited work that no one can explain.

---

## 3. Target Users & Personas

| Persona | Role | Primary need |
|---|---|---|
| **The Scientist / Engineer** | Technical user inheriting or maintaining pipelines | Exact paths, parameters, environment versions, the rationale behind choices |
| **The Lead** | PI / lab director / R&D lead (often non-technical) | Oversight, continuity, onboarding without a technical intermediary |
| **The New Hire** | Researcher inheriting a departed colleague's work | Fast, trustworthy understanding of inherited pipelines |

The product must serve both technical and non-technical users from the same underlying engine, surfaced through different views (Section 6).

---

## 4. Goals & Non-Goals

**Goals (MVP)**
- Deliver one undeniable "intent reconstruction" experience: surface lost reasoning behind code in seconds, with citations.
- Demonstrate the fusion of code + conversational provenance + domain knowledge as a single capability.
- Be a deployed, publicly accessible, visually polished web product suitable for a high-stakes accelerator demo.

**Non-Goals (MVP)**
- Production-scale ingestion of multi-terabyte live clusters.
- Multi-tenant auth, RBAC, or org administration.
- Automated literature / method-change detection (roadmap).
- A general-purpose coding assistant or IDE replacement.

---

## 5. Key Product Principle — The Magic Moment

The MVP is designed around a single experience:

> A user asks *"Why was this parameter chosen in this step?"* about a pipeline whose author has left. The product surfaces the original months-old conversation where that author explained the choice, displayed next to the exact line of code, with citations to both — reconstructing intent that everyone assumed was lost.

Every requirement below exists to make this moment instant, trustworthy, and repeatable.

---

## 6. Functional Requirements

### 6.1 Ingestion & Fusion
- **FR-1** The system must ingest artifacts (scripts, configs, environment files, READMEs) from a target codebase.
- **FR-2** The system must ingest conversational provenance (chat / meeting transcripts / PR or email-style records) associated with that codebase.
- **FR-3** The system must associate conversational records with the specific code they refer to, so that a code element can be linked to the discussion that explains it.
- **FR-4** The system must extract and store relevant domain metadata where present (environment/dependency versions, reference-build versions referenced in code or config).

### 6.2 Intent-Reconstruction Q&A (Core)
- **FR-5** A user must be able to ask a natural-language question about the ingested codebase.
- **FR-6** The system must return a grounded, plain-language answer that reconstructs the reasoning behind the relevant code.
- **FR-7** Every answer must **dual-cite**: the specific code element(s) *and* the conversational source(s) that justify the reasoning. Citations must be visible and traceable to their source.
- **FR-8** The answer must surface exact locations (file path / code reference) for the elements it discusses.

### 6.3 Audience Views
- **FR-9** The product must support at least two presentation modes for the same answer: a **technical view** (paths, parameters, versions, detail) and an **executive view** (plain-language summary, continuity-oriented). A user must be able to switch between them.

### 6.4 Risk & Staleness Panel
- **FR-10** For a given pipeline, the system must surface the reference-build and key library/dependency versions it depends on.
- **FR-11** The system must flag where those versions are outdated relative to current known versions and indicate, at a high level, the cautions involved in updating or integrating the pipeline.
- *(For the MVP demo, "current version" reference data may be pre-curated rather than fetched live.)*

### 6.5 Handover Document Generation
- **FR-12** The user must be able to generate, in one action, a structured handover / onboarding document for a pipeline that consolidates its purpose, environment, dependencies, locations, and key reasoning into a single shareable artifact.
- **FR-13** The generated document must be exportable in a portable, shareable format.

### 6.6 Deployment-Path Demonstration
- **FR-14** The product must be able to demonstrate at least one query answered through a fully **local / air-gapped** path, to evidence that the on-prem deployment mode is real. The remainder of the MVP may run against a hosted model (see Section 12).

---

## 7. Non-Functional Requirements

- **NFR-1 (Trust / accuracy):** Answers must be grounded in cited sources; the product must not present ungrounded claims as fact. Within the demo, the core "magic moment" path must be reliable and must not misfire.
- **NFR-2 (Responsiveness):** The core query experience must feel near-instant to the user.
- **NFR-3 (Visual quality):** The interface must read as a polished, modern, enterprise-grade product — explicitly *not* a research script or terminal tool. This is a core requirement, not cosmetic.
- **NFR-4 (Availability for demo):** The product must be reliably reachable for a live demo, with a fallback that does not depend on live network conditions.
- **NFR-5 (Privacy posture):** The architecture must be compatible with a deployment mode in which no code or conversational data leaves the customer's environment (on-prem / air-gapped). The MVP need not enforce this everywhere, but must not foreclose it.
- **NFR-6 (Data labeling):** Any synthetic/sample data used in the product must be clearly labeled as sample data within the UI.

---

## 8. Demo Requirements (Accelerator)

The MVP exists first to win a live demo. The following are hard requirements for that context:

- **DR-1** A pre-loaded **hero pipeline** drawn from a recognizable open project, credible to a technical audience.
- **DR-2** **Synthetic conversational logs** for that pipeline, clearly labeled as sample data, containing the reasoning the magic moment will surface.
- **DR-3** The code↔conversation links for the hero pipeline must be **pre-computed** so the magic moment is instant and never fails on stage.
- **DR-4** A small set of rehearsed questions that always land, plus the ability to handle the core flow end to end.
- **DR-5** The "scanning / indexing at scale" experience may be presented as a progress visualization over a pre-built index.
- **DR-6** A recorded backup of the full flow, independent of live conditions.

---

## 9. Deployment & Public Website

- **WR-1** The product must be a deployed, publicly accessible web application at a stable URL.
- **WR-2** A public **landing page** must frame the problem → solution and route visitors to the live product / demo. It must be visually consistent with the product (Section NFR-3).
- **WR-3** The deployment must support a custom domain.
- **WR-4** Basic visit/usage analytics on the landing page are desirable (not required for MVP).
- **WR-5** Managed, low-operations hosting is acceptable for the MVP; the technical team selects the platform. The only constraints are reliability for demos (NFR-4) and compatibility with the future on-prem path (NFR-5).

---

## 10. Monetization & Access Tiers

- **MR-1** The product follows a **freemium** model: a **free tier with usage limits** (e.g., capped on usage volume, codebase size, and/or seats — specific limits TBD).
- **MR-2** Paid tiers unlock higher limits, team features, and the **on-prem / air-gapped deployment** capability, which is positioned as a premium, regulated-tier offering rather than a universal default.
- **MR-3** The MVP must visibly express the free-tier limit in the UI (the upgrade path may be non-functional for the demo).

---

## 11. Positioning & Defensibility (Product Rationale)

The product leads on **fusion**: combining code, conversational provenance, and domain knowledge to reconstruct intent. This is the one capability that general coding assistants — which index code in isolation — and horizontal knowledge tools — which lack domain understanding — do not provide.

Supporting defensibility layers, in priority order: a vertical domain ontology (reference builds, versioning, format pitfalls); an on-prem / air-gapped deployment posture that hosted-only incumbents will not cross for regulated buyers; and accumulating per-customer memory that raises switching cost over time. The fusion insight is the lead message; the others reinforce it.

---

## 12. Locked Decisions (Directional Constraints)

These are product-owner decisions. They set direction; the technical team retains latitude on how to implement them.

| # | Decision | Choice | Latitude left to team |
|---|---|---|---|
| 1 | Opening beat | **Intent reconstruction (code↔chat fusion)** | How retrieval and linking are implemented |
| 2 | Demo data | **Synthetic conversational logs, labeled as sample** | Content design, volume, realism |
| 3 | Frontend direction | **Modern web app (Next.js direction)** | Exact framework/component choices |
| 4 | Model for MVP | **Hosted model API** | Provider, prompting, retrieval design |
| 5 | On-prem path in demo | **One query wired to a real air-gapped/local path** | Which local model and how it's shown |
| 6 | Hero linkages | **Pre-computed for the hero pipeline** | How precomputation is built and stored |
| 7 | Lead defensibility | **Fusion** | How it's evidenced in the UI |
| 8 | Access model | **Free tier with usage limits; on-prem is a paid tier** | Specific limits and tier structure |

---

## 13. Open Questions (Deferred to Technical Team)

- Retrieval and code↔conversation linking approach.
- Data store(s) for embeddings and metadata.
- Hosted model provider and the local model used for the air-gapped demonstration.
- Hero pipeline selection and the exact shape of the synthetic conversational data.
- Handover-document export format.
- Specific free-tier limits.
- Hosting platform and domain.

---

## 14. Success Criteria

**Demo success**
- A viewer sees lost reasoning resurface, with dual citations, in seconds — and asks to use it on their own team's data.
- The on-prem path is shown to be real, not claimed.
- The product reads as enterprise-grade, not a prototype.

**Product success (early, post-MVP)**
- Design-partner teams validate intent reconstruction on their own real data (beyond synthetic logs).
- At least one team requests an on-prem / regulated pilot.

---

## 15. Future Roadmap (Post-MVP)

1. Validate fusion on real organizational data with 2–3 design-partner teams.
2. Ship an on-prem / air-gapped regulated pilot.
3. Add automated paper / method-change detection.
4. Add an interactive dependency / provenance graph.
5. Deepen parameter-rationale stress-testing beyond single-pass reasoning.
6. Address team and execution scaling (technical hire / co-founder).
