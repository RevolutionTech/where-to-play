# 0006: Deployment on Vercel

Status: accepted (2026-11-10)

## Context

The client and the server must run on a free hosting tier. They must share one origin, so the app needs no CORS. The site must use an existing domain whose DNS stays at Namecheap, so the host must accept a CNAME record (or an A record for the bare domain) from an outside DNS provider.

[0001](0001-tech-stack.md) kept the server free of Node-only APIs so that it could run on Cloudflare Workers. Workers can serve a custom domain only when Cloudflare runs the DNS of that domain. A CNAME-only setup needs a Business plan.

## Decision

- **Vercel Hobby hosts the client and the server in one project.** Vercel serves `client/dist` as static files and runs the API as one Node.js function (`api/index.js`). Rewrites send `/api/*` to the function and every other path that is not a file to `index.html`. Vercel accepts a CNAME from Namecheap and issues the HTTPS certificate.
- **esbuild bundles the server into one file** (`server/dist/vercel.js`) before Vercel builds the function. Vercel's own TypeScript compile keeps imports with no file extension, and Node.js cannot load those in an ES module package. The bundle also needs no `node_modules`.
- **The function runs in `iad1`,** next to the Supabase project in `us-east-1`.
- **The function connects through Supabase's transaction pooler.** It keeps `prepare: false` ([0002](0002-database.md)).
- **GitHub Actions deploys, not Vercel's Git integration.** The deploy workflow runs after CI passes on `main`. It migrates the database, then builds and deploys with the Vercel CLI. Vercel's Git deploys are off, because they could make new code live before its migration runs. This also turns off preview deploys, which would use the production database.
- **No Terraform.** The setup is one project, two environment variables, one domain, and two DNS records. Namecheap gives API access only to accounts that meet its requirements, and only from listed IP addresses. `vercel.json` holds the settings that change with the code. [deployment.md](../deployment.md) lists the one-time steps.
- **A daily health check** calls `/api/health`. It finds outages, and its database query keeps the free Supabase project from a pause.

## Consequences

- The Hobby plan is for non-commercial use only.
- A function that was idle has a cold start. Workers would not have one.
- Vercel's CDN honors `s-maxage`, so it caches BGG search results ([0005](0005-live-bgg-search.md)) with no extra code.
- PRs get no preview deploy. Previews need a separate preview database first.
- `server/src/app.ts` stays free of Node-only APIs, so a move to Workers stays possible.
