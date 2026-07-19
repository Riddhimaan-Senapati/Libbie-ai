# Libbie engine

The provenance-graph engine behind Libbie.ai. It ingests what a computational-biology
lab actually produced (HPC/SLURM job records, git history, Slack/`.eml` conversation,
and papers), types each artifact into nodes, resolves edges across artifact classes,
and pushes the result as an **Inheritance Briefing**.

This is the real engine described in `docs/main_plan.md` / `plan.md`. The `libbie/`
web app and `desktop/` Tauri app are the UI; this package is the work underneath.

## Pipeline

```
INGEST ─▶ raw artifact store ─▶ EXTRACTION (typed nodes) ─▶ JOIN LAYER ─▶ GRAPH ─▶ BRIEFING
 code / HPC / conversation / literature      (per-class parsers)   candidate-gen → LLM adjudication → commit
```

The **join layer** is the product: cheap recall-oriented candidate generation
(path / time / value / hash / alias identity) followed by precision-oriented LLM
adjudication that emits `{accept, confidence, rationale, spans}`. Edges below the
commit threshold are kept as **hypothesis** edges and surfaced honestly in the
briefing, because *wrong edges are worse than missing edges.*

## Licensing posture

Runtime dependencies are **permissive only** (MIT / BSD / Apache-2.0). We deliberately
avoid the common copyleft traps in this problem space:

| Task | We use (permissive) | We avoid (copyleft/restrictive) |
|---|---|---|
| PDF extraction | `pypdf` (BSD-3) | PyMuPDF/`fitz` (**AGPL-3.0**) |
| git ingestion | `GitPython` (BSD-3) | `pygit2`/libgit2 (**GPL-2.0** w/ linking exception) |
| LLM client | `httpx` (BSD-3) direct | — |
| graph ops | `networkx` (BSD-3) | — |

Model **weights** named in the plan carry their own terms: Qwen3 (Apache-2.0),
`bge-m3` / `nomic-embed` (Apache-2.0/MIT) are permissive. **Llama-3.3 is *not* OSI**:
it ships under the Meta Community License with use restrictions, so prefer Qwen for a
clean permissive stack.

## Model layer (two backends, one interface)

Every LLM call goes through `LLMBackend` (`complete`, `embed`). Flip `llm.backend` in
`config.yaml` between:

- `local` — vLLM / llama.cpp OpenAI-compatible endpoint (self-hosted, air-gapped)
- `api` — Anthropic Messages API (Haiku extract / Opus adjudicate / Sonnet synthesize)
- `mock` — deterministic, offline; the whole pipeline runs with no network or GPU

## Quick start

```bash
cd engine
python -m venv .venv && ./.venv/Scripts/pip install -e ".[dev,git]"
cp config.example.yaml config.yaml          # default backend is `mock` (offline)

# Build the graph from the bundled hero-scenario sample data, then brief it:
libbie ingest --all --sample
libbie join
libbie brief --pipeline germline > briefing.md
```

## Commands

| Command | What it does |
|---|---|
| `libbie ingest --all --sample` | Parse sample HPC + git + conversation + literature into typed nodes |
| `libbie join` | Candidate generation → LLM adjudication → commit edges |
| `libbie brief --pipeline <name>` | Generate the Inheritance Briefing markdown |
| `libbie eval` | Score committed edges against the hand-labelled gold set |
| `libbie github login` | Authenticate to GitHub via OAuth device flow |
| `libbie github repos` | List the repositories your account can access |
| `libbie github ingest <owner/repo>` | Clone any accessible repo (incl. private/org) and ingest it into the graph |

## GitHub: ingest any repo you can access

Point Libbie at a real repository — including private and org repos — using your GitHub
account:

```bash
export LIBBIE_GITHUB_CLIENT_ID=<your OAuth App client id>   # device flow needs no secret
libbie github login          # open the printed URL, enter the code
libbie github repos          # confirm what you can see
libbie github ingest myorg/pipeline
libbie join && libbie brief --pipeline pipeline
```

The token is stored via the OS keyring when available (else a `0600` file in the store) and is
used only for a token-less clone (`GIT_ASKPASS`, credential helpers disabled), so it never lands
in `.git/config` or argv. For SSO-enforced orgs, authorize the token for the org first, or
private repos won't appear. Register the OAuth App once (device flow enabled) to get a client id.

## Layout

```
libbie_engine/
├─ models.py         # typed nodes + edges + Graph (the shared contract)
├─ config.py         # section-7 YAML config
├─ llm/              # LLMBackend protocol + local / api / mock backends
├─ store/            # raw artifact store + JSON graph store
├─ ingest/           # one parser per artifact class
├─ join/             # candidate generation → scoring → commit
├─ briefing/         # the Inheritance Briefing generator
├─ lazarus.py        # environment_status executor (off-graph)
├─ github.py         # OAuth device flow + safe clone + repo ingest
├─ evaluation.py     # edge-quality precision/recall vs the gold set
└─ cli.py
```
