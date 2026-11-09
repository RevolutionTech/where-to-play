import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { collections } from "../src/db/schema";

// The collection list is a JSON file outside version control, because private collections can
// name individuals. Running the script again changes each collection to match the file, by
// slug, and leaves its games as they are.
const [listPath] = process.argv.slice(2);
if (!listPath) throw new Error("Usage: pnpm collections:upsert <collections.json>");
const collectionList = JSON.parse(
  readFileSync(listPath, "utf8"),
) as (typeof collections.$inferInsert)[];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

const db = createDatabase(databaseUrl);
try {
  await db
    .insert(collections)
    .values(collectionList)
    .onConflictDoUpdate({
      target: collections.slug,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        isPrivate: sql`excluded.is_private`,
        websiteUrl: sql`excluded.website_url`,
        bggTag: sql`excluded.bgg_tag`,
        sourceKind: sql`excluded.source_kind`,
        sourceConfig: sql`excluded.source_config`,
      },
    });
  console.log(`Upserted ${collectionList.length} collections.`);
} finally {
  await db.$client.end();
}
