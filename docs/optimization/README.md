# Libbie optimization plan

This plan makes the repo faster, smaller in memory, and shorter in lines of code. It was
audited and written on 2026-09-06, and implemented the same day on three branches, one PR
per surface: `perf/engine-optimizations`, `perf/desktop-optimizations`, and
`perf/web-optimizations`. Every finding cites the code as of 2026-09-06; line numbers
drift as the repo moves.

The work lands as three independent PRs, one per surface, each mergeable on its own:

1. [`01-engine.md`](01-engine.md) — the Python provenance engine. Gate: `./.venv/Scripts/python -m pytest -q`.
2. [`02-desktop.md`](02-desktop.md) — the Tauri app. Gates: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib`, `npm run build`.
3. [`03-web.md`](03-web.md) — the Next.js site and shared demo data. Gate: `npm run build`.

Merge order is engine, desktop, web. The engine has the strongest test net, so it carries the
least risk per change.

## How the plan was built

Three read-only audit agents measured each surface on this machine. Items marked **measured** have
timings from real runs. Items marked **reasoned** come from code inspection at the cited lines.
Library licenses were verified against PyPI and crates.io on 2026-09-06, not from memory.

## The headline is not libraries

The big wins are algorithmic fixes, dead code deletion, and build configuration. Library swaps
play a supporting role. A new dependency has to beat a measured hot path or delete more code than
it adds.

## Verified dependency decisions

All licenses checked on 2026-09-06 against PyPI and crates.io. As implemented, msgspec and
keyring are in, and GitPython, sentence-transformers, recharts, zod, and next-themes are
out. rapidfuzz, pypdfium2, ts-rs, rfd, and mimalloc were verified and then skipped or left
optional. See "Skipped from scope" below.

| Action | Package | License | Reason |
|---|---|---|---|
| Add | `msgspec` (BSD-3-Clause) | verified | `msgspec.json` decodes graph and store IO. No license ceiling. |
| Add | `keyring` (MIT) | verified | Declared as the `[secrets]` extra. It was already imported but undeclared. |
| Add | `rapidfuzz` (MIT) | verified | Skipped. See "Skipped from scope". |
| Swap | `pypdf` → `pypdfium2` (Apache-2.0 and BSD-3) | verified | Skipped. See "Skipped from scope". |
| Remove | `GitPython` | — | Measured 40× slower than the git-CLI fallback it wrapped. |
| Remove | `sentence-transformers` | — | Declared in `pyproject.toml`, never imported anywhere. |
| Remove | `recharts` | — | 499.5 KB raw for one fixed-domain six-bar chart. |
| Remove | `zod`, `next-themes` | — | `zod` had zero imports. `next-themes` had no provider anywhere. |
| Add | `rfd` (MIT) | verified | Optional desktop item, not taken this pass. |
| Add | `mimalloc` (MIT) | verified | Optional desktop item, not taken this pass. |
| Add | `ts-rs` (MIT) | verified | Skipped. See "Skipped from scope". |

### The orjson fork

orjson 3.12.0 added MPL-2.0 to its license. Versions at or below 3.11.4 are Apache-2.0 or MIT.
The user picked the repo policy (MIT, BSD, Apache-2.0 all acceptable) over strict MIT-only, so
`msgspec.json` (BSD-3) is the choice. It sidesteps the orjson version pin entirely.

## What we recommend against

- **Rewriting `models.py` to msgspec Struct.** It risks the public contract that the tests pin.
  We take `msgspec.json` as a serializer only; pydantic stays the schema layer.
- **networkx or rustworkx.** No graph algorithms run anywhere. Dict indexes fix the real cost.
- **numpy.** The only numeric work is a 256-dim hashing embedding in the mock LLM. Trivial.
- **Replacing `async-imap`.** Its duplicate transitive deps are annoying, not harmful. A crate
  migration costs more than it saves.
- **A heavier animation library on the web.** The user picked LazyMotion plus CSS: keep the spring
  feel, pay roughly half the bundle cost. Full motion removal was on the table and rejected.

## Expected results

Measured on this machine (Windows, warm caches) the same day, unless marked otherwise.

| Metric | Before | Predicted | Actual |
|---|---|---|---|
| Git ingest, sample repo | 2.81 s | 0.07 s | 0.07 s. The subprocess path became the only path. |
| 300 artifact-store puts | 954 ms | ~10 ms | 342 ms. The quadratic index flush is gone; per-blob file writes set the floor. |
| Engine test suite | 13.2 s | ~1 s | 0.5 s. Fixture sharing plus the git-path removal. |
| Desktop installer size | baseline | −20-35% | Not measured locally. CI builds the installers; the release profile (LTO, stripped symbols, abort panics) is in place. |
| GraphView JS chunk (desktop) | 327 KB | ~30 KB | 16 KB. The sample graph now ships as a fetched asset. |
| Desktop main chunk | 438 KB | — | 390 KB, via LazyMotion with the domAnimation feature set. |
| `/demo` first-load JS | 1.27 MB | ~600 KB raw | 851 KB raw. |
| `/` first-load JS | 773 KB | ~300-400 KB raw | 715 KB raw. |
| Total LOC across three surfaces | ~21,400 | ~18,100 | ~19,100 (−2,300). |

The web predictions assumed a small framework baseline. The Next 16 runtime alone measures
582 KB of raw first-load JS (the empty `_not-found` route). App-specific JS fell about 55%
on `/demo` and 30% on `/`; the floor is the framework, not this repo's code.

## Skipped from scope

Verified and deliberately not taken. Each is a candidate for a later PR.

- **rapidfuzz** (engine). Fuzzy matching would change person-resolution semantics that the
  join tests pin. The current first-initial-plus-lastname match already merges the sample's
  "E. Vasquez" into "Elena Vasquez".
- **pypdfium2** (engine). Faster PDF extraction, but the swap has no test coverage on the
  extraction path.
- **ts-rs** (desktop). Generates the TS `AppConfig` from Rust. It needs build and CI wiring.
  The `devConfig()` drift it prevents is documented.
- **tauri.ts / Settings.tsx splits** (desktop item 11). Pure structure moves with real
  regression risk and no user-visible change. The item's dead-code deletion and dedupe did land.
- **`next/font/local`** (web hygiene). Needs vendored font files, which is a policy decision.

## User decisions that shaped the plan

1. **License policy.** Repo policy (MIT, BSD, Apache-2.0) governs new dependencies, not strict
   MIT-only. This unblocks msgspec and pypdfium2.
2. **Animation.** LazyMotion plus CSS fades, not full motion removal, not status quo.
3. **Web scope.** Everything: the quick wins and the landing-page server-component conversion.
