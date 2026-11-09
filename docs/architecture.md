# Architecture

## Overview

```
Browser ──> client (React SPA) ──/api──> server (Hono) ──> PostgreSQL
```

- **Client:** a static SPA. It holds filter and search state in the URL, so views can be shared and bookmarked.
- **Server:** a stateless JSON API under `/api`. The client calls it through Hono's typed RPC client, so API types flow from server to client with no code generation.
- **Database:** PostgreSQL. Local in development (Docker), Supabase in production. One `DATABASE_URL` selects the database. The server uses Drizzle ORM with postgres.js. All tables are in the `where_to_play` schema. See [0002](decisions/0002-database.md).

## Same Origin

The client and server share one origin. In development, the Vite dev server sends `/api` requests to the server. In production, one host serves both the static files and `/api`. This removes the need for CORS configuration.

## Portable Server

The target hosting is a free serverless tier, such as Cloudflare Workers. For this reason:

- `server/src/app.ts` builds the app with web-standard APIs only. Each runtime gets a thin entry file (today: `server/src/server.ts` for Node).
- The entry file creates the database client and passes it to `createApp`. No module creates a client at top level.
- postgres.js runs with prepared statements turned off, so it works through Supabase's transaction pooler.
- The server keeps no state in memory between requests and runs no background jobs.

## Collection Importer

A GitHub Actions workflow (`.github/workflows/import-collections.yml`) runs `server/scripts/import-collections.ts` each week. It reads the source of each row in `collections`, matches the games to BGG, updates `collection_games`, and keeps a BGG tag on each game in each collection. It is a separate process, so the server still runs no background jobs. See [0003](decisions/0003-collection-importer.md).

## Not Yet Built

- Migration of data from the legacy project.
- Filter and search endpoints and UI.
- Deployment.
