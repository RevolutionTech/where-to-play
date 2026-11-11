# Deployment

Production runs on Vercel. See [0006](decisions/0006-deployment.md) for why. After the one-time setup below, each push to `main` deploys when CI passes (`.github/workflows/deploy.yml`).

## One-Time Setup

### Supabase

You need two connection strings. Find them under **Connect** in the Supabase dashboard.

- **Transaction pooler** (port 6543): for the Vercel function.
- **Session pooler** (port 5432): for migrations and the collection importer in GitHub Actions. GitHub runners have no IPv6, so they cannot use the direct connection.

### Vercel

1. Create a Vercel project from this repository. Keep the root directory at the repo root. `vercel.json` sets the build.
2. Under **Settings → Environment Variables**, add these for **Production**:
   - `DATABASE_URL`: the transaction pooler connection string.
   - `BGG_API_TOKEN`
3. Create an access token under **Account Settings → Tokens**.
4. Run `pnpm dlx vercel link` from the repo root. Then read `orgId` and `projectId` from `.vercel/project.json`. Git ignores this file.

### GitHub

In **Settings → Environments → production**, add these secrets:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- `DATABASE_URL`: the session pooler connection string. The importer uses it too.

Then run the **Deploy** workflow from the Actions tab.

### Domain

1. In Vercel, open **Settings → Domains** and add the domain. Vercel shows the DNS records that it needs.
2. In Namecheap, open **Domain List → Manage → Advanced DNS** and add them:
   - For a subdomain (`play.example.com`): a `CNAME` record with the value that Vercel shows.
   - For the bare domain (`example.com`): an `A` record with the IP address that Vercel shows, or an `ALIAS` record.
3. Wait until Vercel shows the domain as valid. Vercel then issues the HTTPS certificate.
4. In GitHub, under **Settings → Secrets and variables → Actions → Variables**, set `PRODUCTION_URL` to the site URL, for example `https://play.example.com`. The daily health check (`.github/workflows/health-check.yml`) uses it.

## Operations

- **Deploy by hand:** run the **Deploy** workflow from the Actions tab.
- **Roll back:** in Vercel, open **Deployments**, select an earlier production deployment, and select **Promote**. A rollback does not undo migrations.
- **Logs:** in Vercel, open the project and select **Logs**.
- **Check the shared cache:** a response from `/api/games` has the header `x-vercel-cache: HIT` when the CDN served it.
