# 0001: Tech Stack

Status: accepted (2026-11-07)

## Context

Where to Play is a hobby app. Its main feature is filter and search over database tables of hundreds to thousands of rows. It must fit within free hosting tiers.

## Decision

- **TypeScript everywhere, in one pnpm workspace.** One language and one install for client and server.
- **TanStack Router over React Router.** Routes declare typed, validated search parameters. Filter state lives in the URL, so this removes manual parsing on each page.
- **TanStack Query** for server state: caching, request deduplication, and loading states.
- **Tailwind CSS + shadcn/ui over CSS-in-JS (such as Emotion).** No runtime styling cost, active ecosystem, and shadcn/ui gives owned, accessible form components for filter UIs.
- **Hono** for the server. It is small, runs on Node and on serverless runtimes, and its RPC client shares API types with the client.
- **PostgreSQL (Supabase in production).** Postgres full-text search and `pg_trgm` are enough for search at this data size, with no extra search service.
- **Biome over ESLint + Prettier.** One tool and one config. We accept less complete type-aware lint rules.

## Consequences

- The server must stay free of Node-only APIs in `app.ts` to keep serverless hosting open.
- The Supabase free tier pauses a project after a period with no activity. Production needs a scheduled request or a manual restore.
