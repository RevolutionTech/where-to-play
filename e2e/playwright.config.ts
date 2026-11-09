import { defineConfig, devices } from "@playwright/test";
import { clientPort, e2eDatabaseUrl, serverPort } from "./environment";

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
      command: "pnpm --filter @where-to-play/server start",
      url: `http://localhost:${serverPort}/api/health`,
      env: { DATABASE_URL: e2eDatabaseUrl, SERVER_PORT: String(serverPort) },
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
