import { asc } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { collections } from "../src/db/schema";

// Prints the collections in the format that scripts/upsert-collections.ts reads. The output can
// name individuals, so do not save it in version control.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

const db = createDatabase(databaseUrl);
try {
  const rows = await db
    .select({
      slug: collections.slug,
      name: collections.name,
      kind: collections.kind,
      isPrivate: collections.isPrivate,
      websiteUrl: collections.websiteUrl,
      location: collections.location,
      bggTag: collections.bggTag,
      sourceKind: collections.sourceKind,
      sourceConfig: collections.sourceConfig,
    })
    .from(collections)
    .orderBy(asc(collections.slug));
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await db.$client.end();
}
