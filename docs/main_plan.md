# Libbie.ai — Main Build Plan

**Document type:** Engineering plan for the real product (companion to `Libbie.ai_MVP_PRD.md` and `mvp_plan.md`)
**Relationship to the MVP:** This plan replaces the MVP's fakes with real systems, in an order where each step is independently demo-able. Nothing in the PRD is dropped; the traceability map (Section 12) covers every requirement plus the post-MVP roadmap.
**Stance:** Take the PRD's recommendations and push them. Where the MVP fixtures the link map, here we *infer* links. Where the MVP shows a static staleness table, here we *compute* it. Where the PRD lists provenance/graph/method-detection as "roadmap," here we lay the architecture so those are increments, not rewrites. Open-source first, everywhere it's viable.

---

## 1. Vision & How This Extends the MVP

The product is an **intent-reconstruction engine** built on the fusion of three sources — artifacts, conversational provenance, and domain knowledge — exposed through a polished web app and shippable as a fully air-gapped on-prem unit.

The lead capability is **fusion**: a grounded, dual-cited answer that reconstructs *why* a piece of code exists by linking it to the conversation that justified it. Everything below serves making that real, trustworthy, and defensible.

The MVP proved the experience with fixtures. This plan makes the experience *earned*: real ingestion, real retrieval, real linking, real verification, real on-prem.

---

## 2. System Architecture (Overview)

```
                         ┌──────────────────────────────────────────────┐
   Sources              │                 INGESTION                      │
 ┌──────────┐           │  connectors → normalizers → chunkers           │
 │ code repo │──┐       │  (tree-sitter AST for code; thread parsing      │
 │ chat/Slack│  │       │   for conversation; version extraction)         │
 │ email/PR  │──┼──────▶│                                                │
 │ transcripts│ │       └───────────────┬───────────────┬───────────────┘
 │ ref builds │─┘                       │               │
 └──────────┘                          ▼               ▼
                        ┌──────────────────────┐  ┌──────────────────────┐
                        │   FUSION / LINKING    │  │   DOMAIN ONTOLOGY     │
                        │ code↔conversation     │  │ reference builds,     │
                        │ edges via hybrid       │  │ versions, format      │
                        │ signals + LLM verify   │  │ pitfalls              │
                        └───────────┬───────────┘  └───────────┬──────────┘
                                    ▼                          │
                  ┌───────────────────────────────────────────▼──────────┐
                  │                    STORES                              │
                  │  pgvector (embeddings)  ·  Postgres (metadata)         │
                  │  Qdrant (scale, optional)  ·  graph (AGE/Neo4j)        │
                  └───────────────────────────┬──────────────────────────┘
                                              ▼
                  ┌───────────────────────────────────────────────────────┐
                  │   RETRIEVAL  (hybrid vector + BM25 → rerank → graph     │
                  │   expansion)  ·  orchestrated + optimized with DSPy     │
                  └───────────────────────────┬──────────────────────────┘
                                              ▼
                  ┌───────────────────────────────────────────────────────┐
                  │   REASONING / SYNTHESIS                                 │
                  │   grounded answer + dual citations + verification pass  │
                  │   hosted (Claude API)  OR  local (vLLM/Ollama)          │
                  └───────────────────────────┬──────────────────────────┘
                                              ▼
                  ┌───────────────────────────────────────────────────────┐
                  │   WEB APP (Next.js) — technical/exec views, citations, │
                  │   risk panel, provenance graph, handover export        │
                  └───────────────────────────────────────────────────────┘
```

**Hosted vs on-prem is a config flip, not a fork.** Same code; the model gateway and stores point either at hosted services or at a fully local Docker Compose stack. This is the architectural commitment that makes NFR-5 / MR-2 real.

---

## 3. Open-Source Stack (Full)

**App / frontend**
- **Next.js** (App Router), **React**, **TypeScript** (PRD locked decision 3).
- **Tailwind CSS** + **shadcn/ui** + **Radix UI**; **Framer Motion**.
- **Shiki** / **CodeMirror 6** — code rendering + citation anchoring.
- **React Flow** or **Cytoscape.js** — the interactive provenance/dependency graph (roadmap item 4).
- **Recharts** / **visx** / **D3** — risk and dependency visualizations.
- **TanStack Query / Table**.

**Backend / orchestration**
- **FastAPI** + **Pydantic** (Python, to sit in the ML ecosystem).
- **Dagster** or **Prefect** — ingestion pipeline orchestration.
- **Celery + Redis** (or **arq**) — async jobs (ingest, re-index, link inference).

**Retrieval / RAG**
- **LlamaIndex** or **Haystack** — retrieval orchestration (both OSS, production-grade, citation-friendly). **R2R** is a strong alternative with built-in citations + GraphRAG.
- **DSPy** — declarative, self-optimizing retrieval/prompt pipelines (Stanford NLP) for reliability gains over hand-tuned prompts.
- **rank_bm25** / **Tantivy** / **Meilisearch** / **OpenSearch** — keyword/lexical leg of hybrid search.

**Embeddings & reranking (open weights)**
- **sentence-transformers** + **BAAI/bge-m3** or **Qwen3-Embedding** — text embeddings.
- A code-aware embedder (**jina-embeddings-v2-code**, **UniXcoder**, or CodeBERT-family) for the code leg.
- **bge-reranker-v2** or **Qwen3-Reranker** — cross-encoder reranking. **ColBERT** if late-interaction retrieval is warranted.

**Code & conversation parsing**
- **tree-sitter** — multi-language AST parsing for precise code elements and line anchors (FR-8).
- **universal-ctags** — symbol indexing.
- Connectors: **PyGithub** (PRs), standard **mbox**/email parsers, Slack export parsers, transcript parsers.

**Stores**
- **PostgreSQL** + **pgvector** — primary store: embeddings + relational metadata + link edges.
- **Qdrant** (Apache 2.0) — dedicated vector store if/when scale or vector-perf demands it.
- **Graph:** **Apache AGE** (Postgres graph extension — keeps everything in one DB) or **Neo4j Community** / **Memgraph**; **Graphiti** for building real-time provenance graphs over them.

**Models — hosted (PRD locked decision 4)**
- **Anthropic Claude** via API (`claude-sonnet-4-6` as the workhorse for cost/latency; `claude-opus-4-8` for the high-stakes reasoning path). Use **prompt caching** for reused pipeline context and the **batch API** for bulk ingest-time link inference. Confirm current models/pricing at https://docs.claude.com/en/api/overview and https://docs.claude.com/en/docs_site_map.md.
- The gateway is provider-agnostic (**LiteLLM**), so Gemini / GPT / open APIs can be swapped without code changes.

**Models — local / air-gapped (PRD locked decision 5)**
- **vLLM** (de-facto OSS serving standard; **SGLang** for prefix-heavy RAG) for the on-prem server; **Ollama** for laptop/desktop demos.
- **Qwen3** (14B/30B/235B-MoE, Apache 2.0) as default; **Mistral Small 3 / Mistral Large 3** (Apache 2.0, hallucination-resistant — good for grounded RAG); **Gemma 3 27B** as a single-GPU option.

**Trust / eval / observability**
- **Ragas** + **DeepEval** — RAG answer-faithfulness and citation-grounding evals (directly serves NFR-1).
- **Langfuse** (OSS) and/or **Arize Phoenix** — tracing, prompt/version tracking, regression detection.

**Doc generation & deployment**
- **Pandoc** / **WeasyPrint** / **Typst** — handover export (PDF + Markdown + HTML).
- **Docker** + **Docker Compose** — the portable unit that doubles as the on-prem artifact.
- **Vercel** (hosted frontend) + **Render/Fly.io** (containerized backend); the same containers ship on-prem.

---

## 4. Core Subsystems

### 4.1 Ingestion & Connectors — FR-1..FR-4
- **Artifacts** (FR-1): clone/scan a repo; parse code with **tree-sitter** into addressable elements (file → function/block → line range) so every answer can cite an exact location (FR-8). Configs, env files, READMEs parsed and chunked.
- **Conversational provenance** (FR-2): connectors for chat (Slack export), PR discussion (**PyGithub**), email (mbox), and meeting transcripts; normalize to a common record (author, timestamp, participants, references, body).
- **Domain metadata** (FR-4): extract environment/dependency versions and reference-build versions from code/config/lockfiles into a structured layer (feeds the ontology, §4.6).
- Orchestrated with **Dagster/Prefect**; incremental re-index on change.

### 4.2 Fusion & Code↔Conversation Linking — FR-3 (the differentiator)
This is where the MVP's curated link map becomes real inference. Build link edges from a blend of signals, then verify:
1. **Explicit references** — file paths, function/symbol names, PR/commit IDs, parameter names appearing in conversation (highest-precision).
2. **Temporal proximity** — conversation near the commit/PR that touched the code.
3. **Semantic similarity** — embedding match between a code element and a discussion chunk (recall leg, with reranking).
4. **LLM verification pass** — a model confirms each candidate edge actually *explains* the code (precision leg), reducing spurious links. Run cheaply at ingest via the batch API or a local model.

Store edges in the graph (**Apache AGE / Neo4j** via **Graphiti**) with provenance and a confidence score. This graph is also what powers the interactive provenance view (§5) and raises switching cost over time (accumulating per-customer memory — PRD §11).

### 4.3 Retrieval — FR-5, FR-6
**Hybrid retrieval**: dense (pgvector/Qdrant) ⊕ lexical (BM25/Tantivy) → **cross-encoder rerank** (bge/Qwen3-Reranker) → **graph expansion** (pull linked conversation for retrieved code and vice-versa, so an answer always has both sides to cite). Orchestrated and **optimized with DSPy** so the pipeline self-tunes against an eval set rather than relying on hand-tuned prompts. **Ambition beyond baseline:** GraphRAG-style traversal — start from the cited code node, walk the provenance graph to gather the conversational and version context, then synthesize.

### 4.4 Reasoning, Synthesis & Trust — FR-6, FR-7, NFR-1
- Synthesize a grounded, plain-language answer that **dual-cites** code element(s) and conversation source(s) (FR-7), with click-to-source on both.
- **Verification/grounding pass** (NFR-1): a second step checks every claim in the answer is supported by a retrieved citation; unsupported claims are dropped or flagged. This is the "do not present ungrounded claims as fact" guarantee, enforced in the pipeline, not just hoped for. **Ragas/DeepEval** gate this in CI.
- Model routing via **LiteLLM**: `claude-sonnet-4-6` for routine queries, escalate to `claude-opus-4-8` for hard reasoning; identical prompts run against the **local model** for the air-gapped path.

### 4.5 Audience Views — FR-9
One answer object, two renderings: **technical** (paths, parameters, versions, full citation detail) and **executive** (continuity-oriented plain-language summary). Generated from the same grounded answer + citations so they never diverge factually. Real toggle in the UI.

### 4.6 Domain Ontology, Risk & Staleness — FR-10, FR-11 (vertical defensibility)
Build a small **vertical ontology** of reference builds, library/dependency versioning, and known format pitfalls (PRD §11). The risk panel reads from it:
- surface the pipeline's reference build + key versions (FR-10),
- **compute** staleness against current known versions — live lookups (PyPI/Conda/registry APIs, and a curated reference-build table) rather than the MVP's static data (FR-11),
- emit high-level cautions about updating/integrating (e.g., GRCh37→GRCh38 coordinate/annotation differences).

### 4.7 Handover Document Generation — FR-12, FR-13
One action consolidates purpose, environment, dependencies, file locations, and key reasoning (with citations) into a structured artifact, rendered by **Pandoc/WeasyPrint/Typst** to **PDF** (primary, exec-shareable), **Markdown** (developer-native), and **self-contained HTML** (live citation links). Generated from live retrieval, not pre-rendered.

### 4.8 On-Prem / Air-Gapped Deployment — FR-14, NFR-5, MR-2
A **Docker Compose** stack — Next.js app + FastAPI + Postgres/pgvector (+ optional Qdrant) + **vLLM** serving a local model + local embedder/reranker — that runs with **no external network**. Same image set as hosted; the difference is configuration (local model endpoint, no outbound calls). This is the premium, regulated-tier offering (MR-2) and the proof that no code or conversational data leaves the customer's environment (NFR-5).

### 4.9 Freemium & Tiering — MR-1, MR-2, MR-3
Usage metering (queries/codebase-size/seats) with a visible counter and upgrade affordance (MR-3). **On-prem/air-gapped is the paid gate** (MR-2, decision 8). Auth/RBAC/org-admin are deliberately deferred (PRD non-goals) until needed for paid pilots.

---

## 5. Ambitious Extensions (Beyond Baseline — pulled forward from PRD §15 Roadmap)

These are what "be more ambitious" means concretely. The architecture above makes each an increment:

1. **Interactive provenance / dependency graph** (roadmap 4) — the link graph from §4.2 rendered with **React Flow / Cytoscape.js**: click a code node, see the conversations and versions that justify it. This is the fusion story made *spatial* and is a strong demo upgrade.
2. **Automated method-/paper-change detection** (roadmap 3) — watch reference-build and library release feeds; proactively flag when a pipeline's assumptions go stale. Builds directly on the ontology (§4.6).
3. **Parameter-rationale stress-testing** (roadmap 5) — multi-pass reasoning that probes whether a parameter's stated rationale still holds given current versions/data, instead of single-pass reasoning.
4. **Accumulating per-customer memory** (PRD §11 defensibility) — the link graph + verified rationales persist and compound per customer, raising switching cost over time.

Sequence these *after* the core fusion loop is real and trustworthy — they amplify a working magic moment, they don't substitute for one.

---

## 6. Trust & Evaluation Harness (NFR-1, Success Criteria §14)

- **Golden eval set** of question→expected-citation pairs for the hero and design-partner pipelines.
- **Ragas / DeepEval** for faithfulness, answer relevance, and citation grounding; **Langfuse / Phoenix** for tracing and regression detection across prompt/model versions.
- CI gate: the magic-moment path must stay above a faithfulness threshold before deploy. This operationalizes "must not misfire" (NFR-1) as a test, not a hope.

---

## 7. Deployment Topologies (WR-1..WR-5, NFR-4, NFR-5)

- **Hosted SaaS:** Next.js on **Vercel** (custom domain, analytics, low-ops); containerized FastAPI + stores on **Render/Fly.io**; hosted Claude via the gateway.
- **On-prem / air-gapped:** the identical Docker Compose stack inside the customer's environment, local model via vLLM, zero outbound. Sold as the regulated tier.
- **Demo reliability (NFR-4):** keep the hero pipeline reproducible locally for an offline fallback and recorded backup, carried over from the MVP.

---

## 8. Phased Roadmap (builds on the MVP, each phase demo-able)

**Phase 0 — MVP** (see `mvp_plan.md`): faked web app + one real local query. Already plan­ned.

**Phase 1 — Real fusion on the hero pipeline.** Real ingestion (tree-sitter + connectors), hybrid retrieval + reranking, real code↔conversation link inference + verification, grounded dual-cited synthesis with the verification pass. *Outcome:* the magic moment is earned, not authored.

**Phase 2 — Generalize + on-prem.** Ingest a second/third pipeline; ship the Docker Compose air-gapped stack with vLLM (FR-14/NFR-5 for real); real handover generation; live staleness checks. *Outcome:* PRD Success Criteria — "at least one team requests an on-prem pilot" becomes reachable.

**Phase 3 — Provenance graph + memory.** Interactive provenance/dependency graph; per-customer accumulating memory; DSPy-optimized retrieval; eval harness in CI. *Outcome:* defensibility made visible.

**Phase 4 — Proactive intelligence.** Automated method-/version-change detection; parameter-rationale stress-testing. *Outcome:* from reactive Q&A to proactive guardian.

**Phase 5 — Validation & scale.** 2–3 design-partner teams validate fusion on real data (PRD §15.1); team/execution scaling (PRD §15.6).

---

## 9. Open-Source Inventory (Main Plan, at a glance)

Next.js · React · TypeScript · Tailwind · shadcn/ui · Radix · Framer Motion · Shiki · CodeMirror 6 · React Flow / Cytoscape.js · Recharts / visx / D3 · TanStack · FastAPI · Pydantic · Dagster / Prefect · Celery / Redis · LlamaIndex / Haystack / R2R · DSPy · LiteLLM · rank_bm25 / Tantivy / Meilisearch / OpenSearch · sentence-transformers · bge-m3 / Qwen3-Embedding · jina-code / UniXcoder · bge-reranker / Qwen3-Reranker / ColBERT · tree-sitter · universal-ctags · PyGithub · PostgreSQL · pgvector · Qdrant · Apache AGE / Neo4j Community / Memgraph · Graphiti · vLLM / SGLang / Ollama · Qwen3 / Mistral / Gemma (Apache 2.0) · Ragas · DeepEval · Langfuse · Arize Phoenix · Pandoc / WeasyPrint / Typst · Docker / Docker Compose.

Non-OSS, by deliberate choice: the hosted **Claude API** (PRD locked decision 4) — and the whole stack stays runnable without it via the local model path. Vercel is an optional hosting convenience; the app is portable.

---

## 10. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Link inference produces wrong/spurious edges | LLM verification pass + confidence scores; high-precision explicit-reference signals weighted first; eval set |
| Ungrounded answers erode trust (NFR-1) | Mandatory verification pass; Ragas/DeepEval CI gate; citations required for every claim |
| On-prem local model quality gap | Route hard queries to larger local models (Qwen3-30B+) on adequate GPUs; Mistral for hallucination resistance; set expectations per tier |
| Scope creep into roadmap before core works | Phase discipline: §5 extensions only after Phase 1 fusion is trustworthy |
| Vendor lock-in on the model | **LiteLLM** gateway + a real local path keep providers swappable |

---

## 11. Why This Is Defensible (PRD §11, realized in code)

- **Fusion (lead):** §4.2 linking + §4.3 graph-expanded retrieval + §4.4 dual-cited synthesis — the capability code-only and horizontal tools lack.
- **Vertical ontology:** §4.6 reference-build/version/format-pitfall ontology driving real staleness.
- **On-prem posture:** §4.8 air-gapped Docker Compose stack hosted-only incumbents won't cross.
- **Accumulating memory:** §4.2 / §5.4 per-customer provenance graph that compounds.

---

## 12. Requirements Traceability (PRD → Main Plan)

| PRD req | Realized by |
|---|---|
| FR-1..FR-4 (ingest/fuse) | §4.1 — real connectors, tree-sitter, version extraction |
| FR-3 (code↔conv association) | §4.2 — multi-signal link inference + LLM verification |
| FR-5, FR-6 (NL Q&A, grounded answer) | §4.3, §4.4 — hybrid retrieval + grounded synthesis |
| FR-7 (dual-cite) | §4.4 — code + conversation citations, click-to-source |
| FR-8 (exact locations) | §4.1 — tree-sitter line-range anchors |
| FR-9 (audience views) | §4.5 — one answer, two renderings |
| FR-10, FR-11 (risk/staleness) | §4.6 — ontology + live version checks |
| FR-12, FR-13 (handover doc) | §4.7 — Pandoc/WeasyPrint, PDF/MD/HTML |
| FR-14 (air-gapped path) | §4.8 — local vLLM stack |
| NFR-1 (trust) | §4.4, §6 — verification pass + eval harness |
| NFR-2 (responsiveness) | §3, §4.3 — caching, reranking, routing to fast models |
| NFR-3 (visual quality) | §3 — design system inherited from MVP |
| NFR-4 (demo availability) | §7 — offline fallback + recorded backup |
| NFR-5 (privacy posture) | §4.8 — same image set, zero-outbound config |
| NFR-6 (sample labeling) | inherited from MVP; labels persist for sample data |
| DR-1..DR-6 | inherited from MVP; Phase 1 replaces fixtures with real systems |
| WR-1..WR-5 | §7 — Vercel + containerized backend, custom domain, low-ops |
| MR-1, MR-3 (freemium) | §4.9 — usage metering + visible limits |
| MR-2 (on-prem = paid) | §4.8, §4.9 — air-gapped tier as paid gate |
| §11 defensibility | §11 — fusion / ontology / on-prem / memory realized |
| §15 roadmap (1–6) | §5, §8 — extensions + phased plan |
