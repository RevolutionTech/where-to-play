import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { BggClient } from "./bgg/client";
import { createDatabase } from "./db/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
}

const bggApiToken = process.env.BGG_API_TOKEN ?? "";
if (!bggApiToken) {
  console.warn("BGG_API_TOKEN is not set. Game search and game pages will fail.");
}

// A person waits for each request, so give up on a slow BGG quickly.
const bgg = new BggClient({
  apiToken: bggApiToken,
  baseUrl: process.env.BGG_BASE_URL || undefined,
  minRequestGapMs: 0,
  maxRetries: 2,
  maxBackoffMs: 1000,
});

const port = Number(process.env.SERVER_PORT ?? 3000);
const app = createApp({ db: createDatabase(databaseUrl), bgg });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
