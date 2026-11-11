# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cook is a Chinese recipe web/mobile app for finding recipes based on available ingredients. The product is called 「料理手帐」 on Web/PWA/Android; the native iOS app keeps the home-screen name 「云食册」 with App Store name 「云食册 - 料理手帐」 (see `docs/decisions/0004-ios-app-name.md` and `0020-brand-rename-and-warm-editorial-tokens.md`). Web uses Nuxt 4 (Vue 3, CSR-only) and Ionic UI; native iOS uses SwiftUI. The Capacitor shells have been retired; native Android is planned with Kotlin and Jetpack Compose. The UI and content are in Chinese — do not translate user-facing strings.

## Common Commands

```bash
pnpm install              # Install deps (auto-runs nuxt prepare via postinstall)
pnpm convert              # Convert CSV recipe data → JSON (required before first run)
pnpm fetch                # Pull fresh recipe data from Feishu (飞书) into recipe.csv
pnpm validate             # Validate recipe.csv (ids, ingredient/tool dictionary, values, video ids)
pnpm dietary:validate     # Validate dietary / institutional low-GI side tables
pnpm amounts:check        # Check ingredient amounts in recipe data
pnpm feedback:pull        # Pull in-app feedback + search signals from CloudBase (needs .env)
pnpm eval:search          # Evaluate recommendation ranking against real search signals
pnpm howtocook <dir>      # Regenerate packages/data/recipe-text.json (in-app text recipes) and .cache/recipe-images from a HowToCook checkout
pnpm images:upload        # Upload text-recipe images to Tencent COS (needs COS_* env; CI does this on main)
pnpm check:videos         # Offline video-id checks and coverage report; opt-in small online checks: docs/dev/data.md
pnpm fixtures             # Regenerate shared Web/iOS fixtures (after data, alias, ranking or search changes)
pnpm dev                  # Dev server on http://localhost:3000 (Nuxt default; 3333 is only the Docker port)
pnpm lint                 # ESLint check (uses @antfu/eslint-config flat config)
pnpm lint --fix           # Auto-fix lint issues
pnpm typecheck            # Builds packages/cook, then vue-tsc on apps/web
pnpm test                 # Run Vitest tests (watch mode)
pnpm test -- --run        # Run tests once without watch
pnpm test:coverage        # Vitest run with v8 coverage
pnpm build                # Production build: convert + nuxt generate → dist/
pnpm build:full           # fetch + convert + generate → dist/ (also pulls fresh Feishu data)
pnpm build:site           # Web build + docs build + composed product site
pnpm docs:dev / docs:build # VitePress documentation site
```

Run a single test file:

```bash
pnpm test -- test/recipe.test.ts
```

### Mobile Development

```bash
pnpm convert
xcodegen generate --spec apps/ios/project.yml
open apps/ios/Cook.xcodeproj
swift test --package-path apps/ios/CookCore
```

### Build caveats

- `pnpm build` / `build:full` / `generate` go through `scripts/build-web-output.mjs` → `scripts/lib/web-build.mjs`, which **requires a Git checkout**: it records HEAD SHA + version before and after generation, fails if the source changed mid-build, and writes `.well-known/cook-build.json` provenance into `dist/`. Without `.git`, the build aborts.
- `pnpm build` output is `apps/web/dist`, copied to the root `dist/` that deploy targets (EdgeOne, Docker) read. `edgeone.json` is copied alongside it.
- `pnpm typecheck` builds `packages/cook` first (`unbuild`) because `apps/web` imports `@yunyoujun/cook` from `dist/`.

## Architecture

### Data Pipeline

CSV source files (`packages/data/recipe.csv`, `packages/data/incompatible-foods.csv`) → `pnpm convert` (via `packages/cook` CLI) → JSON files (`packages/data/recipe.json` + `recipe-chunk-*.json`, `incompatible-foods.json`) → consumed at runtime. The `pnpm fetch` command pulls fresh data from the Feishu (飞书) API. The generated JSON is gitignored; `recipe.csv` is the tracked source of truth.

Data rules, validation and the feedback loop are in `docs/dev/data.md`; every recipe has a permanent `id` column (favorites, feedback and search signals key on it): never change or reuse an id; new recipes take max id + 1.

Project decisions are recorded in `docs/decisions/` — read the relevant one before changing direction, and add a new record for significant decisions.

### Monorepo Structure (pnpm workspaces)

Layout follows `docs/decisions/0003-native-ios-monorepo.md` and `0016-native-android-and-capacitor-retirement.md`; plans are in `docs/dev/ios-roadmap.md` and `docs/dev/android-roadmap.md`. Android has no project yet; create it under `apps/android` when implementation starts.

- **apps/ios/CookCore** — Swift Package porting the recommend/search/incompatible logic for the native iOS app; `swift test --package-path apps/ios/CookCore` (after `pnpm convert`) runs the shared fixtures from `packages/data/fixtures/`. Change TS and Swift logic together
- **apps/web** — Nuxt app (main application). Root scripts (`pnpm dev`, `pnpm build`, `pnpm typecheck`) proxy to it. Keep Ionic UI and routing; the unused native CLIs from `@nuxtjs/ionic` are excluded with version-scoped pnpm overrides
- **packages/cook** — Published as `@yunyoujun/cook`. Types, recommendation/search logic (the TS core the iOS CookCore mirrors), and the CLI (`convert`, `fetch`, `search`)
- **packages/data** — Data shared by Web and iOS. Tracked: `recipe.csv`, `incompatible-foods.csv`, the food dictionary (`food.json`), pantry defaults (`pantry.json`), ingredient aliases (`aliases.json`), sentence-input word lists (`query.json`), fridge shelf life (`shelf-life.json`), side tables (`recipe-amounts.json`, `recipe-dietary.json`, `recipe-institutional-low-gi.json`, `video-stats.json`), offline text recipe bodies (`recipe-text.json`, from `pnpm howtocook`), shared fixtures (`fixtures/*.json`, regenerate with `pnpm fixtures`; `fixtures/query.json` is hand-written), and JSON Schemas (`schema/`). Generated + gitignored: `recipe.json`, `recipe-meta.json`, `recipe-chunk-*.json`, `incompatible-foods.json`. `recipe-meta.json` carries `schemaVersion` (bump `DATA_SCHEMA_VERSION` in `packages/cook/src/utils/config.ts` and CookCore together on breaking shape changes) and `dataVersion` (content hash)
- **packages/shared** — Assets shared across native targets: `Assets.xcassets` (method/tool icon sets) and `links.json`
- **docs** — VitePress documentation site (`docs/dev/`, `docs/guide/`, `docs/decisions/`)
- **scripts** — Build/utility scripts (build provenance, data validation, fixtures, brand icon generation from `logo.png`, CI helpers, iOS test automation)
- **cloudfunctions/** — CloudBase serverless functions: `cook-ai-intent`, `cook-feedback`, `cook-user-data`
- **workers/** — Edge redirect worker (`docs-redirect`)
- **skills/**, **specs/** — Project skills and feature specs; `.claude/skills/` mirrors `skills/` for Claude Code
- **Root** — Workspace tooling, tests (`test/`) and tooling config; no legacy native shells

### App Source (`apps/web/app/`)

- **pages/** — Nuxt file-based routing; main interface uses Ionic tabs (`tabs.vue`, with `tabs/home|library|apps|my`); also `recipes/*` (favorites/history/mine/new), `cookbooks/`, `catalog.vue`, `feedback.vue`, `about/*`, `apps/random`, `auth/callback.vue`
- **components/** — Organized by feature: `recipe/`, `tags/`, `catalog/`, `cook/`, `cookbook/`, `workbench/`, `feedback/`, `user-data/`, `ylf/`, `layouts/`, `common/`
- **composables/** — Shared logic and Pinia stores (`composables/store/`: `app`, `recipe`, `favorite`, `history`, `user`, `customRecipe`, `userData`)
- **utils/** — Pure logic helpers (`db.ts` Dexie/IndexedDB, `recipe.ts`, `feedback.ts`, `userData.ts`, `analytics.ts`, `authInitialization.ts`, `yunlefunAuth.ts`, …)
- **adapters/**, **plugins/** — External-service boundaries: `adapters/` wraps YunLeFun auth / feedback / user data; `plugins/` are Nuxt client plugins (clarity, acquisition, auth, user-data sync)
- **constants/**, **config/** — SEO, links, acknowledgements; runtime config
- **data/** — typed wrappers over `packages/data/food.json` (food/tool dictionary) and `pantry.json`
- **types/** — TypeScript type definitions
- **styles/** — Design tokens and global styles. `css-vars.scss` is the single source of truth for the warm-editorial palette, type scale, spacing, radii, shadows and motion; `ionic.css` only maps Ionic variables onto those tokens (Ionic `--ion-color-primary` → `--c-brand-ink` for text use, while fills use `--c-brand`). Read `docs/dev/design-system.md` and `docs/decisions/0019-warm-editorial-web-visual-direction.md` before changing colors, and never hardcode hex values in components

### Key Patterns

- **CSR-only**: SSR is disabled in `apps/web/nuxt.config.ts` (`ssr: false`); app is statically generated
- **Client storage**: Dexie (IndexedDB) for favorites, history, user preferences — enables offline support
- **Styling**: UnoCSS with Wind preset (Tailwind-compatible), attributify mode, and token-driven shortcuts (`tag`, `pureTag`, `btn`)
- **Dark mode**: Class-based via `@nuxtjs/color-mode` (classSuffix: ''); Ionic surfaces follow via the `ion-palette-dark` class, and the warm dark palette is defined in `css-vars.scss`
- **Responsive breakpoints**: exactly three — mobile <768px, tablet 768–1199px (icon rail + two columns), desktop ≥1200px (full sidebar + three columns). Do not introduce one-off 1024/1280 breakpoints
- **Brand assets**: `logo.png` at the repo root is the only design source; run `node scripts/generate-brand-icons.mjs` to regenerate Web favicons, PWA icons and iOS app icons
- **Icons**: Iconify with multiple packs (carbon, mdi, twemoji); food tool icons dynamically safelisted in `apps/web/uno.config.ts`
- **Data imports**: `@cook/data` is aliased to `packages/data` in `apps/web/nuxt.config.ts`; `@yunyoujun/cook/*` resolves to the built `packages/cook/dist` exports (recommend, custom-recipes, personal-catalog, reviewed-data)

### Prerendered Routes

Defined in `apps/web/nuxt.config.ts` → `nitro.prerender.routes`: `/`, `/home`, `/library`, `/apps`, `/my`, `/catalog`, `/recipes/favorites`, `/recipes/history`, `/random`, `/help`, `/feedback`, `/user`, `/404`, `/settings`, `/auth/callback`.

## Testing

Tests live in `test/` plus colocated unit tests in `packages/cook/src/**/*.test.ts`. Vitest uses jsdom environment with setup in `test/setup.ts`. Config in `vitest.config.ts` (also `vitest.nuxt.config.ts` for the Nuxt environment).

```bash
pnpm test -- test/recipe.test.ts          # one file
pnpm test -- --run                        # single pass, no watch
pnpm test -- --run test/userDataSync.test.ts
```

The suite covers web app logic, cloud functions, CI/build scripts, data contracts and Swift/TS parity (`test/iosCoreReuse.test.mjs`).

## Code Style

Uses `@antfu/eslint-config` (flat config) with UnoCSS and formatters enabled. Pre-commit hook runs `lint-staged` via `simple-git-hooks`. Ignored paths include `packages/data/**/*.json` and `dist/`.

## Environment Variables

See `.env.example`:

- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` — For fetching recipe data from Feishu
- `COS_*` — Tencent COS credentials for `pnpm images:upload`
- `APPLE_DEVELOPMENT_TEAM` — iOS signing

## Node/Package Manager

- Node.js: `24.22.2` (per `.nvmrc`; `engines.node` is `^24.15.0`) — see `docs/dev/node-runtime.md`
- pnpm: 11.21.0 (enforced via `packageManager` field)
