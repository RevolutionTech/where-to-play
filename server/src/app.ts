import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { BggClient } from "./bgg/client";
import type { Database } from "./db/client";
import { createGamesRoutes } from "./games/routes";

export type AppDependencies = {
  db: Database;
  bgg: BggClient;
};

// Keep this module free of Node-only APIs so the same app can run on serverless runtimes.
export function createApp({ db, bgg }: AppDependencies) {
  return new Hono()
    .basePath("/api")
    .get("/health", async (c) => {
      try {
        await db.execute(sql`select 1`);
        return c.json({ status: "ok" as const, database: "ok" as const }, 200);
      } catch {
        return c.json({ status: "error" as const, database: "unreachable" as const }, 503);
      }
    })
    .route("/games", createGamesRoutes({ db, bgg }));
}

export type AppType = ReturnType<typeof createApp>;
