import { createDatabase } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
}

// The seed deletes all data first, so never let it reach a shared or production database.
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const { hostname } = new URL(databaseUrl);
if (!localHosts.has(hostname)) {
  throw new Error(`Refusing to seed a database that is not on localhost (host: ${hostname}).`);
}

const db = createDatabase(databaseUrl);
await seedDatabase(db);
await db.$client.end();
console.log("Seeded the database with sample data.");
