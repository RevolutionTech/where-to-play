import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createDatabase } from "./db/client";
import { testDatabaseUrl } from "./test/database";

describe("GET /api/health", () => {
  const db = createDatabase(testDatabaseUrl());

  afterAll(async () => {
    await db.$client.end();
  });

  it("reports that the server and the database are up", async () => {
    const app = createApp({ db });

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("reports an error when the database is unreachable", async () => {
    const unreachableDb = createDatabase("postgres://postgres:postgres@localhost:1/none");
    const app = createApp({ db: unreachableDb });

    const response = await app.request("/api/health");

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", database: "unreachable" });
    await unreachableDb.$client.end();
  });
});
