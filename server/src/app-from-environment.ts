import { createApp } from "./app";
import { BggClient } from "./bgg/client";
import { createDatabase } from "./db/client";

/** Builds the app for a Node.js entry point. Call it once for each process. */
export function createAppFromEnvironment(environment: NodeJS.ProcessEnv) {
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. For local development, copy server/.env.example to server/.env.",
    );
  }

  const bggApiToken = environment.BGG_API_TOKEN ?? "";
  if (!bggApiToken) {
    console.warn("BGG_API_TOKEN is not set. Game search and game pages will fail.");
  }

  // A person waits for each request, so give up on a slow BGG quickly.
  const bgg = new BggClient({
    apiToken: bggApiToken,
    baseUrl: environment.BGG_BASE_URL || undefined,
    minRequestGapMs: 0,
    maxRetries: 2,
    maxBackoffMs: 1000,
  });

  return createApp({ db: createDatabase(databaseUrl), bgg });
}
