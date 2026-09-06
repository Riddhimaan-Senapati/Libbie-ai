# PR 3: web

Implemented on `perf/web-optimizations` (2026-09-06). Items 1-9 and the STALE_HINTS part of
item 10 landed. `next/font/local` was skipped. Measured first-load JS: `/demo` 1.27 MB to
851 KB raw, `/` 773 KB to 715 KB raw. The Next 16 framework floor is 582 KB, so the
app-specific share fell about 55% and 30%.

The Next.js 16 site in `libbie/` plus `shared/demo-data/`. Goal: about one-third of the LOC gone,
`/demo` first load roughly halved, landing page mostly server-rendered. Gate before merge:
`npm run build`.

Context numbers. `libbie/` is 6,536 LOC across 62 files. `shared/demo-data/` is 731 LOC, 31.6 KB.
Measured production first-load JS: `/` is 773 KB raw, `/demo` is 1.27 MB raw. Both routes
prerender static. Bundle numbers come from `.next/diagnostics/route-bundle-stats.json` and the
chunk files of a real build.

## Work items

### 1. Delete the dead code

All entries verified with zero importers, case-sensitive. Total: −2,177 LOC, about 33% of the
surface.

- **Dead demo components (1,371 LOC).** `Workspace.tsx` (280), `QueryConsole.tsx` (109),
  `AnswerBody.tsx` (134), `CodeCitationPanel.tsx` (173), `ConversationCitationPanel.tsx` (190),
  `AppHeader.tsx` (70), `FreemiumCounter.tsx` (71), `LocalModeToggle.tsx` (68),
  `ScanningIntro.tsx` (271), and the empty `landing/how-it-works.tsx` (5).
- **Dead ui primitives (806 LOC).** `avatar.tsx`, `card.tsx`, `dropdown-menu.tsx`,
  `skeleton.tsx`, `table.tsx`, `tabs.tsx` have no importers. `input.tsx`, `progress.tsx`,
  `tooltip.tsx`, `separator.tsx` are imported only by dead components.
- **Assets and shims.** Delete the unused Next scaffold SVGs in `public/` (`file.svg`,
  `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) and the duplicate `libbie_logo.svg` (only
  the hyphenated `libbie-logo.svg` is used, `Logo.tsx:11`). Delete the `linkmap` shim and its
  re-exports in `libbie/lib/fixtures/` and `libbie/lib/data.ts:22-28`; the desktop uses the
  shared fixture, so keep `shared/demo-data/linkmap.ts` itself.

### 2. Delete recharts, hand-roll the chart

- **Evidence.** `recharts` is imported exactly once: `components/demo/RiskPanel.tsx:4-13`, one
  fixed-domain six-bar chart (`SeverityChart`, lines 79-168). It costs a 499.5 KB raw / 146 KB
  gz chunk in `/demo`'s first load. Recharts v3 also pulls Redux internally.
- **Change.** Hand-roll `SeverityChart` as styled divs or inline SVG, ~40 LOC. Remove the dep.
  If a chart library is ever wanted again, visx or uPlot are the MIT options.

### 3. Code-split the closed-by-default overlays

- **Evidence.** `app/demo/page.tsx` statically imports `RiskPanel` (line 26), `HandoverDialog`
  (line 27, 509 lines), and `AskLibbie` (line 25, 296 lines). All three render closed by default
  (`riskOpen` at :49, `askOpen` at :46). Together they are ~60% of `/demo`'s app-specific code.
  `next/dynamic` is used nowhere in the repo.
- **Change.** Load all three with `dynamic(() => import(...), { ssr: false })`. They leave the
  first load entirely.

### 4. Clean the dependency list

- Remove `zod` (zero imports in app code, verified).
- Remove `next-themes`. No `ThemeProvider` exists anywhere; only `components/ui/sonner.tsx:3,8`
  references it, and `useTheme()` always returns the system default. Pass `theme="light"` (or
  omit the prop) in `ui/sonner.tsx`.
- Move `shadcn` to `devDependencies`, or vendor its 568-line `dist/tailwind.css` into
  `globals.css` and drop the package. Only the CSS is used (`app/globals.css:3`); the package is
  a component-generator CLI that pulls `@babel/*`, `ts-morph`, and the MCP SDK.
- **Payoff.** Three fewer runtime deps, roughly 40 MB lighter install, smaller supply chain.

### 5. Move `<Toaster>` out of the root layout

- **Evidence.** `<Toaster>` mounts in `app/layout.tsx:4,34`, so its 41 KB raw chunk ships on the
  landing page, where no toast can ever fire. Toasts fire only in `HandoverDialog.tsx` and the
  dead `FreemiumCounter.tsx`.
- **Change.** Mount `<Toaster>` in the `/demo` route only.

### 6. Convert the landing page to server components

- **Evidence.** 42 of 44 `.tsx` files start with `"use client"`, including every landing section:
  `nav.tsx`, `hero.tsx`, `problem.tsx`, `fusion.tsx`, `sources.tsx`, `graph.tsx`, `on-prem.tsx`,
  `pricing.tsx`, `cta-footer.tsx`. `graph.tsx` (one `<img>` plus a legend) and `sources.tsx`
  contain zero interactivity. Pricing buttons (`pricing.tsx:65-70,102-107`) have no handlers at
  all. Because every section is client, the whole page hydrates and the fixture data ships as JS.
- **Change.** Convert the static sections to server components. Keep `Reveal`
  (`reveal.tsx:21-31`, one `motion.div` with `whileInView`) and the hero micro-demo as client
  islands.
- **Payoff.** Landing JS drops toward react-dom plus the Next runtime plus the hero. Fixtures
  stop shipping as JS on `/`.

### 7. Adopt LazyMotion on the site

- **Evidence.** `motion` is used in 19 files and costs ~159.6 KB raw / 54 KB gz per route. Most
  uses are simple opacity and y fades.
- **Change.** Replace simple fades with CSS via the already-installed `tw-animate-css`. Where
  motion stays, use `LazyMotion` with `m` and the `domAnimation` feature set. The user approved
  this middle path over full removal.

### 8. Lazy-load below-fold images

- **Evidence.** `graph.tsx:44-50` (`desktop-graph.png`, 120.4 KB) and `sources.tsx:59-65`
  (`desktop-connectors.png`, 63.6 KB) load via raw `<img>` with no `loading="lazy"`, so both
  fetch eagerly at first paint despite sitting far below the fold. `next/image` is used nowhere.
- **Change.** Use `next/image` or plain `loading="lazy" decoding="async"`.

### 9. Let the hero sleep

- **Evidence.** `hero.tsx:131-149` runs a `setTimeout` chain that dispatches a state update every
  38 ms while typing, then holds 6.2 s and restarts, forever, with no visibility check.
- **Change.** Pause the loop when off-screen via motion's `useInView`. In `CodeCanvas.tsx:96-142`,
  stop wrapping every source line in a `motion.div` when only the cited line ever animates
  (`:104-113`); use plain divs plus one animated highlight.

### 10. Hygiene

- Derive `STALE_HINTS` (`CodeCanvas.tsx:23-32`) from the staleness fixture instead of
  duplicating the version strings in two places.
- Bump the `tsconfig.json` target from ES2017 to ES2020 or later.
- Consider `next/font/local` with vendored woff2 files so CI builds stop depending on Google
  Fonts at build time.

## Shared fixtures

The fixtures in `shared/demo-data/` are plain ESM modules with named exports, so they are
individually tree-shakeable. The one leak is `libbie/lib/data.ts:4-11`, which statically imports
all five fixtures, so any consumer of the barrel pulls the entire set. After the RSC conversion
(item 6), the fixtures stop reaching the client on `/` at all, which settles this.

## Expected result

`/demo` first load goes from 1.27 MB to roughly 600 KB raw. `/` goes from 773 KB to roughly
300-400 KB raw after items 5 and 6. LOC drops by a third. Items 1-5 are one afternoon; items 6-7
are the deeper structural half of the work.
