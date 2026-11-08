import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("GET /api/health", () => {
  it("reports that the server is up", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
