# Architecture

## Overview

```
Browser ──> client (React SPA) ──/api──> server (Hono) ──> PostgreSQL
```

- **Client:** a static SPA. It holds filter and search state in the URL, so views can be shared and bookmarked.
- **Server:** a stateless JSON API under `/api`. The client calls it through Hono's typed RPC client, so API types flow from server to client with no code generation.
- **Database:** PostgreSQL. Local in development, Supabase in production. One `DATABASE_URL` selects the database.

## Same Origin

The client and server share one origin. In development, the Vite dev server sends `/api` requests to the server. In production, one host serves both the static files and `/api`. This removes the need for CORS configuration.

## Portable Server

The target hosting is a free serverless tier, such as Cloudflare Workers. For this reason:

- `server/src/app.ts` builds the app with web-standard APIs only. Each runtime gets a thin entry file (today: `server/src/server.ts` for Node).
- The server keeps no state in memory between requests and runs no background jobs.

## Not Yet Built

- Database schema, migrations, and connection (Drizzle ORM).
- Filter and search endpoints and UI.
- Deployment.
