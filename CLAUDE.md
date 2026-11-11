# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cook（料理手帐）is a self-hosted Chinese recipe web app that recommends dishes from the ingredients and tools a household already has. It is a fork of the MIT-licensed [YunYouJun/cook](https://github.com/YunYouJun/cook) with the native iOS app, cloud functions, YunLeFun account system, in-app feedback and external documentation links removed. Web is Nuxt 4 (Vue 3, CSR-only, statically generated) + Ionic; a small Node account service in `server/` provides registration, login and cross-device sync. The UI and content are in Chinese — do not translate user-facing strings.

## Common Commands

```bash
pnpm install              # Install deps (auto-runs nuxt prepare via postinstall)
pnpm convert              # Convert CSV recipe data → JSON (required before first run)
pnpm fetch                # Pull fresh recipe data from Feishu (飞书) into recipe.csv
pnpm validate             # Validate recipe.csv (ids, ingredient/tool dictionary, values, video ids)
pnpm dietary:validate     # Validate dietary / institutional low-GI side tables
pnpm amounts:check        # Check ingredient amounts in recipe data
pnpm check:videos         # Offline video-id checks and coverage report
pnpm fixtures             # Regenerate shared fixtures (after data, alias, ranking or search changes)
pnpm dev                  # Web dev server on http://localhost:3000 (proxies /api to :8787)
pnpm server:dev           # Account service on http://127.0.0.1:8787 (reads root .env)
pnpm server:test          # Account service tests (node:test)
pnpm lint                 # ESLint check (@antfu/eslint-config flat config)
pnpm typecheck            # Builds packages/cook, then vue-tsc on apps/web
pnpm test                 # Run Vitest tests (watch mode)
pnpm test -- --run        # Run tests once without watch
pnpm build                # Production build: convert + nuxt generate → dist/
pnpm docs:dev / docs:build # VitePress documentation site
```

Run a single test file:

```bash
pnpm test -- test/recipe.test.ts
```

### Build caveats

- `pnpm build` goes through `scripts/build-web-output.mjs` → `scripts/lib/web-build.mjs`, which **requires a Git checkout**: it records HEAD SHA + version before and after generation and writes `.well-known/cook-build.json` provenance into `dist/`. Without `.git`, the build aborts.
- `pnpm build` output is `apps/web/dist`, copied to the root `dist/` that deployment targets read.
- `pnpm typecheck` builds `packages/cook` first (`unbuild`) because `apps/web` imports `@yunyoujun/cook` from `dist/`.

## Architecture

### Data Pipeline

CSV source files (`packages/data/recipe.csv`, `packages/data/incompatible-foods.csv`) → `pnpm convert` (via `packages/cook` CLI) → JSON files (`packages/data/recipe.json`, `incompatible-foods.json`) → consumed at runtime. The generated JSON is gitignored; `recipe.csv` is the tracked source of truth. Data rules are in `docs/dev/data.md`; every recipe has a permanent `id`: never change or reuse one, and new recipes take max id + 1.

Project decisions are recorded in `docs/decisions/` — read the relevant one before changing direction.

### Monorepo Structure (pnpm workspaces)

- **apps/web** — Nuxt app. Root scripts (`pnpm dev`, `pnpm build`, `pnpm typecheck`) proxy to it. Ionic UI and routing are retained.
- **server** — Self-hosted account service. Node 24 built-ins only (`node:sqlite`, `node:crypto`, `node:http`), no runtime dependencies. Serves `/api/auth/*` (register/login/logout/password), `/api/auth/me`, `/api/user-data` and `/api/admin/users`. Sessions are HttpOnly cookies; passwords use scrypt with per-user salt; registration requires `COOK_INVITE_CODE`; admin is seeded from `COOK_ADMIN_USERNAME/PASSWORD`. See `docs/dev/self-hosting.md`.
- **packages/cook** — Published as `@yunyoujun/cook`. Types, recommendation/search logic, and the CLI (`convert`, `fetch`, `search`).
- **packages/data** — Recipe CSV sources and generated JSON, food dictionary (`food.json`), pantry defaults, ingredient aliases, sentence-input word lists, side tables (`recipe-amounts.json`, `recipe-dietary.json`, `recipe-institutional-low-gi.json`, `video-stats.json`), fixtures (`fixtures/*.json`, regenerate with `pnpm fixtures`) and JSON Schemas. `recipe-meta.json` carries `schemaVersion` and `dataVersion`.
- **packages/shared** — `Assets.xcassets` method/tool icons consumed by `apps/web/uno.config.ts`.
- **docs** — VitePress documentation site.
- **scripts** — Build provenance, data validation, fixtures, brand icon generation (`node scripts/generate-brand-icons.mjs`), CI helpers.
- **Root** — Workspace tooling and tests (`test/`).

### App Source (`apps/web/app/`)

- **pages/** — Nuxt file-based routing: tabs (`tabs/home|library|apps|my`), `recipes/*`, `catalog.vue`, `account.vue`, `admin/users.vue`, `settings.vue`, `cookbooks/*` (placeholder).
- **components/** — Feature folders: `recipe/`, `tags/`, `catalog/`, `cook/`, `cookbook/`, `workbench/`, `common/`, `layouts/`, plus `ylf/` wrappers.
- **composables/** — `useAccount` (session state), `useAccountSync` (merge + debounced upload), Pinia-like stores in `composables/store/` (`app`, `recipe`, `favorite`, `history`, `customRecipe`, `userData`).
- **utils/** — Pure helpers: `db.ts` (Dexie), `storageScope.ts` (per-account localStorage namespacing), `userData.ts` (merge/export format), `recipe.ts`, `analytics.ts`, `yunleHost.ts`.
- **plugins/** — `account.client.ts` refreshes the session and starts sync; `clarity.client.ts`, `acquisition.client.ts`, `yunle-host.client.ts`.
- **styles/** — `css-vars.scss` is the single source of truth for the warm-editorial palette, type scale, spacing, radii, shadows and motion; `ionic.css` maps Ionic variables onto those tokens. Read `docs/dev/design-system.md` before changing colors and never hardcode hex values in components.

### Key Patterns

- **CSR-only**: `ssr: false`; the app is statically generated.
- **Client storage**: Dexie/IndexedDB for the recipe database; localStorage for favorites, history, custom recipes, personal catalog and sync metadata. Keys are scoped by account (`cook:u<id>:<name>`) after login, anonymous (`cook:<name>`) otherwise.
- **Account isolation**: server endpoints derive the user from the session cookie; the client never sends another user's id. Admin can list/delete accounts and reset passwords but cannot read other users' recipe data.
- **Sync**: local-first. On login the client pulls the server copy, merges with `mergeUserData`, writes local, and uploads when different; later changes upload debounced. Account switches do not merge the previous account's data.
- **Styling**: UnoCSS with Wind preset, attributify mode, token-driven shortcuts (`tag`, `pureTag`, `btn`).
- **Dark mode**: class-based via `@nuxtjs/color-mode`; Ionic surfaces follow `ion-palette-dark`.
- **Responsive breakpoints**: exactly three — mobile <768px, tablet 768–1199px (icon rail + two columns), desktop ≥1200px (full sidebar + three columns).
- **Brand assets**: `logo.png` at the repo root is the only design source; run `node scripts/generate-brand-icons.mjs` to regenerate favicons, PWA icons and documentation-site icons.

### Prerendered Routes

`apps/web/nuxt.config.ts` → `nitro.prerender.routes`: `/`, `/home`, `/library`, `/apps`, `/my`, `/catalog`, `/recipes/favorites`, `/recipes/history`, `/recipes/mine`, `/recipes/new`, `/account`, `/random`, `/404`, `/settings`.

## Testing

Vitest covers `test/**/*.test.ts` and colocated `packages/cook/src/**/*.test.ts`; jsdom with setup in `test/setup.ts`. The account service uses Node's built-in runner:

```bash
pnpm test -- --run test/recipe.test.ts
pnpm server:test
```

## Code Style

`@antfu/eslint-config` (flat config) with UnoCSS and formatters. Pre-commit runs `lint-staged` via `simple-git-hooks`. Ignored paths include `packages/data/**/*.json`, `skills/frontend-design-direction/**` and `dist/`.

## Environment Variables

See `.env.example`:

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` — pulling recipe data from Feishu
- `COOK_DB_PATH` — SQLite file for the account service
- `COOK_ADMIN_USERNAME` / `COOK_ADMIN_PASSWORD` — seeded admin on first start
- `COOK_INVITE_CODE` — registration invite code; empty disables registration
- `COOK_COOKIE_SECURE` — set to `1` behind HTTPS
- `COOK_ALLOWED_ORIGINS` — allowed origins for mutating API requests
- `NUXT_PUBLIC_SITE_URL` — public origin baked into canonical/OG/sitemap at build time

## Node/Package Manager

- Node.js: `24.22.2` (per `.nvmrc`; `engines.node` is `^24.15.0`)
- pnpm: 11.21.0 (enforced via `packageManager` field)
