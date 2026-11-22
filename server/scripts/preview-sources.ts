import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BggClient } from "../src/bgg/client";
import type { collections } from "../src/db/schema";
import { sleep } from "../src/http";
import { fetchSourceGames } from "../src/importer/sources";

// Reads the sources of a collection list without a database, so a new collection's source
// config can be checked before the collection is in the table.
const { values: args, positionals } = parseArgs({
  options: { names: { type: "boolean", default: false } },
  allowPositionals: true,
});
const [listPath] = positionals;
if (!listPath) throw new Error("Usage: pnpm collections:preview <collections.json> [--names]");
const collectionList = JSON.parse(readFileSync(listPath, "utf8")) as Pick<
  typeof collections.$inferInsert,
  "slug" | "sourceKind" | "sourceConfig"
>[];

const SAMPLE_SIZE = 15;
const bggApiToken = process.env.BGG_API_TOKEN;
if (!bggApiToken && collectionList.some(({ sourceKind }) => sourceKind === "bgg_collection")) {
  throw new Error("BGG_API_TOKEN is not set.");
}
const bgg = new BggClient({ apiToken: bggApiToken ?? "" });

for (const { slug, sourceKind, sourceConfig } of collectionList) {
  try {
    const sourceGames = await fetchSourceGames(
      { sourceKind, sourceConfig },
      { fetch, sleep, bgg, googleSheetsApiKey: process.env.GOOGLE_SHEETS_API_KEY },
    );
    const bggIdCount = sourceGames.filter(({ bggId }) => bggId !== null).length;
    const shownGames = args.names ? sourceGames : sourceGames.slice(0, SAMPLE_SIZE);
    console.log(
      `\n${slug} (${sourceKind}): ${sourceGames.length} games, ${bggIdCount} with a BGG ID`,
    );
    for (const { name, bggId } of shownGames) console.log(`  ${name}${bggId ? ` [${bggId}]` : ""}`);
    if (shownGames.length < sourceGames.length) {
      console.log(`  ... and ${sourceGames.length - shownGames.length} more (use --names)`);
    }
  } catch (error) {
    console.error(`\n${slug} (${sourceKind}): failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
