# Libbie.ai — Build Contract (read this fully before writing code)

You are building part of **Libbie.ai**, a polished, enterprise-grade web product:
an "institutional-memory layer" that reconstructs the *intent* behind compute-heavy R&D
pipelines by fusing **code** + **conversations** + **domain knowledge**, answering "why
was this built this way?" with citations to BOTH the code and the conversation that
justified it. This is a demo MVP — all data is authored fixtures. Visual quality is a
**core requirement, not cosmetic.** Make it look like a real, shipped enterprise product.

## Environment (IMPORTANT — not the stack you assume)
- **Next.js 16** (App Router) + **React 19** + **TypeScript** + **Tailwind v4** (CSS-based theme, no tailwind.config). shadcn/ui is installed.
- Dark theme is global and always on. Do NOT add a theme toggle.
- Animation library: **`motion`** — import as `import { motion, AnimatePresence } from "motion/react"`. (NOT `framer-motion`.)
- Charts: **`recharts`** (installed).
- `cn()` class helper: `import { cn } from "@/lib/utils"`.
- Interactive components need `"use client"` at the top of the file.
- **Do NOT run `npx shadcn add`, do NOT `npm install`, do NOT edit `package.json`, `app/globals.css`, `app/layout.tsx`, or any file outside the paths you are assigned.** All UI primitives you need are already in `@/components/ui/`.

### Installed shadcn/ui primitives (import from `@/components/ui/<name>`)
button, card, dialog, tabs, badge, separator, tooltip, progress, switch, input,
scroll-area, table, sheet, sonner (use `import { toast } from "sonner"`), skeleton,
accordion, avatar, dropdown-menu. If you need anything else, build it inline with Tailwind — do not add packages.

## Design language (follow exactly for visual consistency)
Aesthetic: **scientific instrument / institutional archive** — refined, precise, calm, high-contrast on a deep ink background. Think Linear/Vercel polish, NOT a dev terminal.

**Fonts** (wired globally as CSS vars / Tailwind families):
- `font-display` → Fraunces serif. Headings `<h1..h4>` already use it automatically. Use for big editorial statements.
- `font-sans` → Geist (body/UI, default).
- `font-mono` → JetBrains Mono. Use for code, file paths, parameters, versions, data tables.

**Color tokens** — ALWAYS use semantic Tailwind tokens, never hardcoded hex:
- Surfaces: `bg-background`, `bg-card`, `bg-muted`, `bg-popover`. Text: `text-foreground`, `text-muted-foreground`. Borders: `border-border`. Brand/primary (teal): `bg-primary text-primary-foreground`, `text-primary`, `ring-primary`.
- **Fusion duotone (the brand device — use it to distinguish the two citation sources everywhere):**
  - **Code / signal = teal:** `text-code`, `border-code`, `bg-code-soft`.
  - **Conversation / human voice = amber:** `text-conversation`, `border-conversation`, `bg-conversation-soft`.
- Status: `text-ok` (teal-green, current), `text-warn` (amber, behind), `text-danger` (red, major/stale).
- Radius via `rounded-lg/md/xl`. Use `border border-border` + subtle shadows for panels. A `.panel` utility class and `.bg-grid`, `.bg-grid-fade`, `.grain`, `.glow-primary`, `.animate-scanbeam` utilities exist in globals.css — use where helpful.

**Motion:** tasteful. One well-orchestrated entrance with staggered reveals beats scattered micro-interactions. Respect a premium, unhurried feel.

## Data API (import from `@/lib/data`; types from `@/lib/types`)
All content is authored sample data. Never invent new data shapes — use these:
- `pipeline` — the hero pipeline (`Pipeline`): `.name`, `.family`, `.description`, `.repo`, `.author {name, role, departed}`, `.stats {files, conversations, commits, lastActive}`, `.files: CodeFile[]` (each `{path, language, description, content}` — `content` is the full file text; line numbers are 1-based).
- `conversations: Conversation[]` — `{id, kind: "chat"|"pr"|"meeting"|"email", title, source, date, participants[], messages: {author, role?, time, body, pivotal?}[], references[]}`.
- `answers: Answer[]` — rehearsed Q&A. Each: `{id, chip, question, technical: {summary, body[]}, executive: {summary, body[]}, codeCitations: CodeRef[], conversationCitations: string[] (conversation ids), isLocal?}`. `CodeRef = {path, lineStart, lineEnd, symbol}`.
- `staleness: StalenessItem[]` — `{name, kind, pinned, current, status: "current"|"behind"|"major", source, caution}`.
- `scanItems: ScanItem[]` — `{label, kind: "file"|"conversation"|"version"}` for the scanning animation.
- Helpers: `getConversation(id)`, `getAnswer(id)`, `getCodeFile(path)`, `getLinksForFile(path)`, `getLinksForConversation(id)`, `localAnswer()`.
- `brand` `{name, tagline, oneLiner}`, `freemium` `{used, limit, resetLabel}`.

Always label sample data in the UI where relevant (NFR-6): a small "Sample data" badge/treatment.

## Quality bar
- Production-grade, fully typed, no `any`, no TODOs. No placeholder lorem — use the real fixtures.
- Responsive (looks great at 1440px; degrades gracefully to mobile).
- Accessible: buttons are buttons, focus states, aria labels on icon-only controls.
- Lucide icons: `import { IconName } from "lucide-react"`.
- After building, ensure your files have no TypeScript errors (you may run `npx tsc --noEmit` — ignore errors originating only in files you do not own).

## Integration boundary
The orchestrator assembles the pages. Build the components with the EXACT export names
and prop signatures given in your task. Do not create `app/demo/page.tsx` unless told to.
