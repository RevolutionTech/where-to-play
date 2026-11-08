import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Database } from "./db/client";

export type AppDependencies = {
  db: Database;
};

// Keep this module free of Node-only APIs so the same app can run on serverless runtimes.
export function createApp({ db }: AppDependencies) {
  return new Hono().basePath("/api").get("/health", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok" as const, database: "ok" as const }, 200);
    } catch {
      return c.json({ status: "error" as const, database: "unreachable" as const }, 503);
    }
  });
}

export type AppType = ReturnType<typeof createApp>;
