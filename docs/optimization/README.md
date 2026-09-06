# Libbie optimization plan

This plan makes the repo faster, smaller in memory, and shorter in lines of code. It is written
down, not yet implemented. Every finding cites the code as of 2026-09-06; line numbers drift as
the repo moves.

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

All licenses checked on 2026-09-06 against PyPI and crates.io.

| Action | Package | License | Reason |
|---|---|---|---|
| Add | `msgspec` 0.21.1 | BSD-3-Clause | `msgspec.json` for graph and store IO. On par with orjson without schemas, per the msgspec benchmarks. No license ceiling. |
| Add | `rapidfuzz` 3.14.6 | MIT | Real fuzzy matching for person resolution in `join/candidates.py`. |
| Swap | `pypdf` → `pypdfium2` 5.13.0 | Apache-2.0 and BSD-3 | 5-10× faster PDF text extraction. Optional item. |
| Remove | `GitPython` | — | Measured 40× slower than the git-CLI fallback it wraps. |
| Remove | `sentence-transformers` | — | Declared in `pyproject.toml`, never imported anywhere. |
| Declare | `keyring` | MIT | Already imported in `github.py` and `slack.py` but undeclared, so it always falls back to the file store silently. |
| Add | `rfd` 0.17.2 | MIT | Replaces `tauri-plugin-dialog`, dropping the transitive `tauri-plugin-fs`. |
| Add | `mimalloc` 0.1.52 | MIT | Global allocator for the string-heavy indexing paths. Optional, unmeasured on this app. |
| Add | `ts-rs` 12.0.1 | MIT | Generates the TS `AppConfig` type from Rust, ending the `devConfig()` drift hazard. |
| Remove | `recharts` | — | 499.5 KB raw for one fixed-domain six-bar chart. |
| Remove | `zod`, `next-themes` | — | `zod` has zero imports. `next-themes` has no provider anywhere. |

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

| Metric | Before | After |
|---|---|---|
| Git ingest, sample repo (measured) | 2.81 s | 0.07 s |
| 300 artifact-store puts (measured) | 954 ms | ~10 ms |
| Engine test suite (measured) | 13.2 s | ~1 s |
| Desktop installer size | baseline | −20-35% (expected magnitude) |
| GraphView JS chunk (measured) | 327 KB | ~30 KB |
| `/demo` first-load JS (measured) | 1.27 MB | ~600 KB raw |
| `/` first-load JS (measured) | 773 KB | ~300-400 KB raw |
| Total LOC across three surfaces | ~21,400 | ~18,100 (−3,300) |

Numbers marked expected are standard magnitudes for the change, not measurements on this repo.

## User decisions that shaped the plan

1. **License policy.** Repo policy (MIT, BSD, Apache-2.0) governs new dependencies, not strict
   MIT-only. This unblocks msgspec and pypdfium2.
2. **Animation.** LazyMotion plus CSS fades, not full motion removal, not status quo.
3. **Web scope.** Everything: the quick wins and the landing-page server-component conversion.
