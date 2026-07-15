# `shared/` — single source of truth for demo data

`shared/demo-data/` holds the Libbie demo scenario (types + authored sample
fixtures) consumed by **both** apps in this repo:

- `libbie/` — the Next.js marketing/demo site
- `desktop/` — the air-gapped Tauri desktop app

Both reach it through a `@shared/*` path alias (configured in each project's
`tsconfig.json`, plus `vite.config.ts` for the desktop app). Each app keeps
one-line re-export shims at `lib/types.ts` and `lib/fixtures/*.ts` so existing
`@/lib/types` / `@/lib/fixtures/*` imports keep working unchanged — the shims
carry no content, so the two apps can never drift.

**To change the demo scenario, edit `shared/demo-data/` only.** Do not paste
content back into either app's `lib/` directory.
