# AGENTS.md

## Project Overview

Where to Play is a hobby web app. It helps gamers find public places where they can play a specific board game. A user searches for a board game by name. The app then lists the conventions and board game cafes that have that game in their collection.

Today, each cafe or convention publishes its collection in a different place: a spreadsheet, an Airtable page, a Tabletop.Events or Cardboard Connect library, a JSON API, a custom web page, or a BoardGameGeek (BGG) collection. Where to Play brings these sources together in one search.

The app has a React SPA (`client/`) and an API server (`server/`). The server reads from PostgreSQL: a local database in development, Supabase in production. See `docs/architecture.md` for how the parts fit together.

## Repo Structure

- `client/`: React SPA (Vite).
  - `src/routes/`: file-based routes (TanStack Router). `src/routeTree.gen.ts` is generated. Do not edit it.
  - `src/components/ui/`: shadcn/ui components. Add new ones with `pnpm dlx shadcn@latest add <name>` from `client/`.
  - `src/lib/api.ts`: typed API client (Hono RPC). It imports `AppType` from the server.
- `server/`: Hono API server. All routes are under `/api`.
  - `src/app.ts`: `createApp({ db, bgg })` builds the app. It must not use Node-only APIs, so it can run on serverless runtimes. Each entry point creates the database client and the BGG client and passes them in, so tests can control them.
  - `src/games/routes.ts`: game search and game details. They call BGG at request time. See `docs/decisions/0005-live-bgg-search.md`.
  - `src/bgg/client.ts`: the BGG API client. The server and the importer both use it.
  - `src/server.ts`: Node entry point for local development.
  - `src/vercel.ts`: entry point for the Vercel function. `pnpm build` bundles it into `dist/vercel.js`, and the root `api/index.js` loads that bundle.
  - `src/db/schema.ts`: Drizzle schema. All tables are in the `where_to_play` Postgres schema.
  - `src/db/client.ts`: `createDatabase(url)`. Do not create a client at module top level.
  - `src/db/seed.ts`: sample data. `scripts/seed.ts` runs it, only against localhost.
  - `drizzle/`: SQL migrations. Generate them with `pnpm db:generate`. Do not edit `drizzle/meta/`.
  - `src/importer/`: the collection importer. `sources/` has one fetcher for each `source_kind`. `json_api` reads any JSON API that its config describes; see `docs/decisions/0008-json-api-source.md`. `scripts/import-collections.ts` runs it.
  - `src/importer/bgg-tags.ts`: applies pending BGG tag changes. `scripts/sync-bgg-tags.ts` runs it. See `docs/decisions/0007-bgg-tag-sync.md`.
  - `src/importer/bgg-tag-audit.ts`: compares the tags on BGG with `collection_games`. `scripts/audit-bgg-tags.ts` runs it on a file that `scripts/export-bgg-tags.browser.js` downloads in a browser. Git ignores these `bgg-tags*.json` files, because tag names can name individuals.
  - `scripts/review-unmatched-names.ts`: lists pending names in `unmatched_names` and saves review decisions. The `unmatched-name-review` skill (`.claude/skills/`) uses it.
  - `scripts/upsert-collections.ts`: makes collections match a JSON list (`pnpm collections:upsert <file>`). Keep lists in `server/collections.*.json`, which git ignores, because private collections name individuals. Never commit names of individuals or their BGG usernames. See `docs/decisions/0004-private-collections.md`.
  - `src/test/`: test setup. Vitest migrates the test database (`TEST_DATABASE_URL`) before tests run.
- `e2e/`: Playwright end-to-end tests. See `e2e/README.md` for how to run them and when to add test IDs.
- `docker-compose.yml`: local PostgreSQL 17 on port 54329, with `where_to_play`, `where_to_play_test`, and `where_to_play_e2e` databases.
- `docs/`: architecture notes and decision records (`docs/decisions/`).
- `.github/workflows/ci.yml`: lint, typecheck, test, build, and E2E tests on each push and PR.
- `.github/workflows/import-collections.yml`: imports all collections into production each week. Run it by hand from the Actions tab for a dry run or for some collections only. It leaves BGG tag changes pending, because BGG refuses logins from GitHub-hosted runners.
- `.github/workflows/deploy.yml`: after CI passes on `main`, migrates the production database and deploys to Vercel.
- `.github/workflows/health-check.yml`: calls `/api/health` in production each day.
- `vercel.json`: Vercel build and routing settings. See `docs/deployment.md` for the one-time setup.

Stack: TypeScript, React 19, Vite, TanStack Router, TanStack Query, Tailwind CSS v4, shadcn/ui, Hono, Drizzle ORM, postgres.js, PostgreSQL, Vitest, Playwright, Biome. Package manager: pnpm workspaces.

## Key Commands

Run from the repo root:

```bash
pnpm install      # install dependencies
pnpm db:setup     # start the local database, apply migrations, and load sample data
pnpm dev          # client on :5173 and server on :3000, with hot reload
pnpm build        # production build of the client, and the server bundle for Vercel
pnpm typecheck    # TypeScript check of all packages
pnpm test         # Vitest in all packages (server tests need the local database)
pnpm test:e2e     # Playwright E2E tests (need the local database and Chromium; see e2e/README.md)
pnpm lint         # Biome lint and format check (use lint:fix to auto-fix)

pnpm db:up        # start the local database (Docker)
pnpm db:down      # stop the local database and keep its data
pnpm db:reset     # delete the local database, then run db:setup
pnpm db:generate  # generate a migration from changes to src/db/schema.ts
pnpm db:migrate   # apply migrations to DATABASE_URL
pnpm db:seed      # replace all data in DATABASE_URL with sample data (localhost only)
```

Game search needs `BGG_API_TOKEN` in `server/.env`. Run the collection importer from `server/`. It needs the BGG and Google Sheets variables in `server/.env.example`:

```bash
pnpm import:collections --dry-run                  # show the changes, save nothing
pnpm import:collections --collection kublacon      # import one collection (repeat for more)
pnpm import:collections --force                    # import even when a source lost half its games
pnpm import:collections --skip-tags                # import, and leave BGG tag changes pending
pnpm tags:sync                                     # apply pending BGG tag changes (needs BGG_USERNAME and BGG_PASSWORD)
pnpm tags:audit bgg-tags.json                      # compare an export of the tags on BGG with the database
pnpm tags:audit bgg-tags.json --apply              # also make the pending tag changes match BGG
```

Run one package's script with `pnpm --filter @where-to-play/<client|server> <script>`.
