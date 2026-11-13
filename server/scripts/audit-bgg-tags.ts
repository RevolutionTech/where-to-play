import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDatabase } from "../src/db/client";
import { auditBggTags, type BggTagExport, type TagAudit } from "../src/importer/bgg-tag-audit";

const { values: args, positionals } = parseArgs({
  options: { apply: { type: "boolean", default: false } },
  allowPositionals: true,
});
const [exportPath] = positionals;
if (!exportPath) throw new Error("Usage: pnpm tags:audit <bgg-tags.json> [--apply]");

const tagExport = JSON.parse(readFileSync(exportPath, "utf8")) as BggTagExport;
if (tagExport.games.length === 0) throw new Error(`${exportPath} lists no tagged games.`);
// Another account's tags would make every collection look untagged.
const bggUsername = process.env.BGG_USERNAME;
if (bggUsername && bggUsername.toLowerCase() !== tagExport.username.toLowerCase()) {
  throw new Error(`${exportPath} has the tags of ${tagExport.username}, not ${bggUsername}.`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
const db = createDatabase(databaseUrl);
let audit: TagAudit;
try {
  audit = await auditBggTags(db, tagExport, { apply: args.apply });
} finally {
  await db.$client.end();
}

console.log(formatSummary(audit, tagExport, args.apply));

function formatSummary(audit: TagAudit, tagExport: BggTagExport, applied: boolean) {
  const lines = [
    `## BGG tag audit${applied ? "" : " (nothing saved; add --apply to save)"}`,
    "",
    `Tags of ${tagExport.username} on BGG at ${tagExport.exportedAt}.`,
    "",
    "| Collection | Tag | Correct | Missing on BGG | Stale on BGG | Corrected state |",
    "| --- | --- | --- | --- | --- | --- |",
    ...audit.collections.map(
      (row) =>
        `| ${row.slug} | ${row.bggTag} | ${row.correctCount} | ${row.missingCount} | ${row.staleCount} | ${row.correctedStateCount} |`,
    ),
    "",
  ];
  if (tagExport.skippedRows.length > 0) {
    lines.push(
      "Rows of the BGG tags page with no BGG thing (not audited):",
      "",
      ...tagExport.skippedRows.map((row) => `- ${row}`),
      "",
    );
  }
  if (audit.otherTags.length > 0) {
    lines.push(
      "Tags that belong to no collection (a tag sync never changes them):",
      "",
      ...audit.otherTags.map(({ tag, gameCount }) => `- ${tag}: ${gameCount} games`),
      "",
    );
  }
  return lines.join("\n");
}
