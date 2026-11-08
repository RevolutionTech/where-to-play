# AGENTS.md

## Project Overview

Where to Play is a hobby web app. It helps gamers find public places where they can play a specific board game. A user searches for a board game by name. The app then lists the conventions and board game cafes that have that game in their collection.

Today, each cafe or convention publishes its collection in a different place: a spreadsheet, a Tabletop.Events collection, a custom web page, or a BoardGameGeek (BGG) collection. Where to Play brings these sources together in one search.

The app has a React SPA (`client/`) and an API server (`server/`). The server reads from PostgreSQL: a local database in development, Supabase in production. See `docs/architecture.md` for how the parts fit together.

## Repo Structure

- `client/`: React SPA (Vite).
  - `src/routes/`: file-based routes (TanStack Router). `src/routeTree.gen.ts` is generated. Do not edit it.
  - `src/components/ui/`: shadcn/ui components. Add new ones with `pnpm dlx shadcn@latest add <name>` from `client/`.
  - `src/lib/api.ts`: typed API client (Hono RPC). It imports `AppType` from the server.
- `server/`: Hono API server. All routes are under `/api`.
  - `src/app.ts`: builds the app. It must not use Node-only APIs, so it can run on serverless runtimes.
  - `src/server.ts`: Node entry point for local development.
- `docs/`: architecture notes and decision records (`docs/decisions/`).
- `.github/workflows/ci.yml`: lint, typecheck, test, and build on each push and PR.

Stack: TypeScript, React 19, Vite, TanStack Router, TanStack Query, Tailwind CSS v4, shadcn/ui, Hono, Vitest, Biome. Package manager: pnpm workspaces.

## Key Commands

Run from the repo root:

```bash
pnpm install    # install dependencies
pnpm dev        # client on :5173 and server on :3000, with hot reload
pnpm build      # production build of the client
pnpm typecheck  # TypeScript check of all packages
pnpm test       # Vitest in all packages
pnpm lint       # Biome lint and format check (use lint:fix to auto-fix)
```

Run one package's script with `pnpm --filter @where-to-play/<client|server> <script>`.
