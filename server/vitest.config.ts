import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Vitest does not read .env files into process.env. Variables that are already set take
// precedence, so CI can set TEST_DATABASE_URL directly.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    globalSetup: ["./src/test/migrate-test-database.ts"],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
