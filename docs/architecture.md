# Architecture

## Overview

```
Browser ──> client (React SPA) ──/api──> server (Hono) ──> PostgreSQL
```

- **Client:** a static SPA. It holds filter and search state in the URL, so views can be shared and bookmarked.
- **Server:** a stateless JSON API under `/api`. The client calls it through Hono's typed RPC client, so API types flow from server to client with no code generation.
- **Database:** PostgreSQL. Local in development (Docker), Supabase in production. One `DATABASE_URL` selects the database. The server uses Drizzle ORM with postgres.js. All tables are in the `where_to_play` schema. See [0002](decisions/0002-database.md).

## Same Origin

The client and server share one origin. In development, the Vite dev server sends `/api` requests to the server. In production, Vercel serves both the static files and `/api`. This removes the need for CORS configuration.

## Deployment

Production runs on Vercel's free Hobby plan. Vercel serves `client/dist` and runs the server as one Node.js function. GitHub Actions migrates the database and deploys after CI passes on `main`. See [0006](decisions/0006-deployment.md) and [deployment.md](deployment.md).

## Portable Server

The server runs on a free serverless tier, and it must be able to move to another one. For this reason:

- `server/src/app.ts` builds the app with web-standard APIs only. Each runtime gets a thin entry file: `server/src/server.ts` for local Node, and `server/src/vercel.ts` for Vercel.
- The entry file creates the database client and passes it to `createApp`. No module creates a client at top level.
- postgres.js runs with prepared statements turned off, so it works through Supabase's transaction pooler.
- The server keeps no state in memory between requests and runs no background jobs.

## Game Search

The search page and the game page get game data from the BGG API at request time, through the server. The server adds the public collections that own each game from the database. See [0005](decisions/0005-live-bgg-search.md).

## Collection Importer

A GitHub Actions workflow (`.github/workflows/import-collections.yml`) runs `server/scripts/import-collections.ts` each week. It reads the source of each row in `collections`, matches the games to BGG, updates `collection_games`, and keeps a BGG tag on each game in each collection. It is a separate process, so the server still runs no background jobs. See [0003](decisions/0003-collection-importer.md).
