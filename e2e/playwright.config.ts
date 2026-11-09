import { defineConfig, devices } from "@playwright/test";
import { clientPort, e2eDatabaseUrl, fakeBggPort, serverPort } from "./environment";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${clientPort}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node fake-bgg.ts ${fakeBggPort}`,
      url: `http://localhost:${fakeBggPort}/xmlapi2/search?query=catan`,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @where-to-play/server start",
      url: `http://localhost:${serverPort}/api/health`,
      env: {
        DATABASE_URL: e2eDatabaseUrl,
        SERVER_PORT: String(serverPort),
        BGG_BASE_URL: `http://localhost:${fakeBggPort}`,
        // Keeps the real token in server/.env away from the fake.
        BGG_API_TOKEN: "e2e-fake-token",
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @where-to-play/client exec vite --port ${clientPort}`,
      url: `http://localhost:${clientPort}`,
      env: { API_PROXY_TARGET: `http://localhost:${serverPort}` },
      reuseExistingServer: false,
    },
  ],
});
