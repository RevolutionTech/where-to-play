import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env files. Variables that are already set take precedence.
if (existsSync(".env")) process.loadEnvFile(".env");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["where_to_play"],
  dbCredentials: { url: process.env.DATABASE_URL },
});
