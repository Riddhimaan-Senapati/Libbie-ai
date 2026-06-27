# Libbie.ai — Redesign Brief: "Libbie, in the margins" (ambient AI copilot)

Read `CONTRACT.md` first for the environment, data API, and base design tokens — all of
that still applies. This brief OVERRIDES the old "scientific instrument" framing.

## The pivot
Libbie is a **named AI chief of staff** — an ever-present, warm, proactive copilot that has
read every line of code and every conversation, and answers *why* with receipts. She is NOT
a cold instrument panel or a search box. The feeling to deliver: *"someone who remembers why,
so I don't have to."*

## Persona & voice (import from `@/lib/data` → `libbie`, `proactiveNudge`)
Warm, concise, quietly authoritative — a brilliant EA who has read everything and never makes
you feel behind. First person. **Leads with the answer (a one-line verdict), then shows the
evidence.** Names the humans involved ("Elena pinned it…"). Honest about staleness/uncertainty.
- Greeting: see `libbie.greeting`.
- Proactive nudge (the signature): see `proactiveNudge` — she flags the stale GRCh37 decision
  *before* you ask, with the thread already attached.
- Answer opener style: *"Short version: it's GRCh37 on purpose, for cohort concordance. Here's
  the line, and here's where the team agreed to it —"*

## Visual direction
- **Theme: warmed dark** (already updated in globals.css — charcoal warmed toward hue 74, not
  the old cold blue). Linear/Raycast/Vercel copilot energy: calm, premium, focused.
- **Palette discipline — keep the tight duotone, do NOT add a third saturated accent.**
  - **Teal** = code/signal AND Libbie's interactive accent (buttons, ⌘K, active states): `text-primary`/`bg-primary`, and code citations use `text-code`/`bg-code-soft`/`border-code`.
  - **Amber** = conversation/human voice ONLY: `text-conversation`/`bg-conversation-soft`/`border-conversation`.
  - Status: `text-ok` / `text-warn` / `text-danger`.
  Libbie's identity comes from her **avatar/presence + voice**, not a new color.
- **Fonts unchanged**: `font-display` (Fraunces) for editorial moments, `font-sans` (Geist) for
  UI, `font-mono` (JetBrains Mono) for code/paths/params. (Do not introduce Inter.)
- **Motion** (`motion/react`): replace the old perpetual scanbeam/grain theatrics with
  *presence* motion — a gentle avatar "thinking" pulse, answers that **type a verdict then
  unfold the evidence**, rail nudges that slide in, ⌘K spring. Calm 180–360ms eases. The
  `.bg-grid`/`.grain` utilities still exist but use them sparingly/faintly, not as dominant texture.

## Libbie's avatar
Design a distinctive, friendly-yet-premium mark for Libbie (e.g. a soft rounded "orb" with a
subtle teal glow, or an "L" monogram in a rounded squircle). It must read as a warm presence,
have a calm "thinking" animated state, and a small online/▮ status dot. Reusable component.

## /demo — the ambient copilot workspace (the heart)
Three zones; **Libbie owns the answer surface, the workspace stays rich**:
- **Left rail (collapsible, ~240–280px):** the pipeline tree — files/params of `pipeline`
  (group the cited files; selecting a file/param is a valid "ask trigger"). Header shows the
  connected pipeline + author-departed context.
- **Center canvas:** the workspace, not a chat. Shows the selected file with a real
  line-numbered code view (mono) and the **cited line highlighted in context**; show inline
  staleness chips where relevant. When Libbie answers, the canvas auto-scrolls to and glows the
  cited line. (Reuse/adapt the existing `CodeCitationPanel` rendering if helpful.)
- **Right rail = Libbie (persistent, ~360–400px):** her avatar + status; at the top a
  **proactively pinned risk** (`proactiveNudge`) shown *before any question* — the signature
  moment; below, her running answer stream; a row of **suggested next actions**
  (`libbie.suggestedActions` → wire to: open the other stale decisions, open `HandoverDialog`,
  toggle exec/technical). Collapses to a floating **Libbie orb** that gently pulses when she has
  something proactive.
- **Global ⌘K "Ask Libbie":** a command palette (also openable via a visible "Ask Libbie"
  button for discoverability). Type a question → it resolves to one of the canonical `answers`
  (match on `chip`/`question`; fuzzy is fine) → palette docks into the right rail, canvas scrolls
  + highlights the cited line, and Libbie's answer streams in. Non-matching text must not
  dead-end: Libbie says she can answer these and lists the canonical questions.

### The answer surface (verdict → evidence)
1. **Verdict**: a one-line plain answer first (derive from `answer.technical.summary`), in
   Libbie's voice, with her avatar.
2. **Evidence**: the **dual citation kept as the trust backbone** — paired beneath the verdict:
   - **Code (teal):** file path + the exact cited line(s) from `getCodeFile(path)`, mono,
     line numbers, cited range highlighted. Click → focuses/scrolls the center canvas.
   - **Conversation (amber):** from `getConversation(id)` — source/kind/date/author, the
     `pivotal` message elevated/highlighted. Click → expands the full thread.
   - A subtle **fusion connector / "+" glyph** visually links the two ("code ⟷ conversation");
     hovering one dims/raises the other. A tiny "Both sources, same decision" confidence line.
3. **Technical ↔ Executive**: a per-answer control ("for me / for my VP") swapping
   `answer.technical` vs `answer.executive`. Instant.
4. **Local/air-gapped**: when `localMode` is on and the answer `isLocal`, Libbie shows an
   "answering on-device · no network" status and tags the answer "Answered locally".

## /demo entry
Replace the heavy "scanning at scale" intro with a brief (~1.5s) **"Libbie is reading…"**
moment: her avatar + a typed status over the corpus stats (`pipeline.stats`: 47 files, 1284
conversations, 612 commits), then she greets you and the pinned risk appears. Keep a Skip.

## / (landing) — reframe around the copilot
Thesis: **"Libbie remembers why."** Hero: editorial headline + a live, looping micro-demo of the
signature interaction (⌘K → grounded dual-cited answer for the GRCh37 question). Then: **Meet
Libbie** (persona/voice), **How she answers** (the dual-citation fusion as the trust backbone —
keep the teal/amber converging cards), **She works air-gapped** (on-prem premium tier),
**Pricing** (free tier + Enterprise/on-prem), **CTA + footer** (keep the "authored sample data"
note, NFR-6). Warm, calm, premium. CTA copy → "Meet Libbie" / "Ask Libbie".

## KEEP / CHANGE / CUT
- **KEEP:** dual-citation teal/amber fusion (the trust backbone); risk/staleness data; handover
  export (`HandoverDialog`); local/air-gapped mode; technical/executive toggle; "Sample data"
  labeling; Fraunces + Geist + JetBrains Mono; the warmed-dark theme.
- **CHANGE:** demo from query-console+standing-panels → ambient copilot (left tree · center
  canvas · right Libbie rail · ⌘K); answers → verdict-then-evidence in Libbie's voice; risk
  panel → Libbie's proactively pinned watchlist + a suggested action; freemium counter → quiet
  account state (less of a loud meter); landing thesis → "Libbie remembers why".
- **CUT:** the perpetual scanbeam + heavy grain as dominant texture; the faceless "scanning at
  scale" intro (→ "Libbie is reading…"); the cold instrument framing.

You MAY reuse/adapt existing components in `components/demo/` (CodeCitationPanel,
ConversationCitationPanel, RiskPanel, HandoverDialog) — but the shell, entry, header, and
answer surface should be rebuilt to the copilot model.
