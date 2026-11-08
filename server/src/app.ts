import { Hono } from "hono";

// Keep this module free of Node-only APIs so the same app can run on serverless runtimes.
export const app = new Hono()
  .basePath("/api")
  .get("/health", (c) => c.json({ status: "ok" as const }));

export type AppType = typeof app;
