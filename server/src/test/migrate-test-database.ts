import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../db/client";
import { testDatabaseUrl } from "./database";

export default async function migrateTestDatabase() {
  const db = createDatabase(testDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await db.$client.end();
  }
}
