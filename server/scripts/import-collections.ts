import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDatabase } from "../src/db/client";
import { BggClient } from "../src/importer/bgg";
import { sleep } from "../src/importer/http";
import { type CollectionReport, importCollections } from "../src/importer/import-collections";

const { values: args } = parseArgs({
  options: {
    collection: { type: "string", multiple: true },
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const dryRun = args["dry-run"];
const db = createDatabase(requiredEnv("DATABASE_URL"));
const bgg = new BggClient({
  apiToken: requiredEnv("BGG_API_TOKEN"),
  credentials: dryRun
    ? undefined
    : { username: requiredEnv("BGG_USERNAME"), password: requiredEnv("BGG_PASSWORD") },
});

let reports: CollectionReport[];
try {
  reports = await importCollections(
    db,
    { fetch, sleep, bgg, googleSheetsApiKey: process.env.GOOGLE_SHEETS_API_KEY },
    { slugs: args.collection, dryRun, force: args.force },
  );
} finally {
  await db.$client.end();
}

const summary = formatSummary(reports, dryRun);
console.log(`\n${summary}`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);

const needsAttention = reports.some(
  (report) => report.outcome !== "imported" || report.tagFailures.length > 0,
);
process.exitCode = needsAttention ? 1 : 0;

function formatSummary(reports: CollectionReport[], dryRun: boolean) {
  const lines = [
    `## Collection import${dryRun ? " (dry run, nothing saved)" : ""}`,
    "",
    "| Collection | Outcome | Source games | Added | Removed | New games | Refreshed | Unmatched | Tag failures |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...reports.map(
      (report) =>
        `| ${report.slug} | ${report.outcome} | ${report.sourceGameCount} | ${report.addedGameCount} | ${report.removedGameCount} | ${report.newGameCount} | ${report.refreshedGameCount} | ${report.unmatchedNames.length} | ${report.tagFailures.length} |`,
    ),
    "",
  ];
  for (const report of reports) {
    const details = [
      report.reason && `- ${report.reason}`,
      report.unmatchedNames.length > 0 && `- Unmatched names: ${report.unmatchedNames.join(", ")}`,
      report.unknownBggIds.length > 0 && `- Unknown BGG IDs: ${report.unknownBggIds.join(", ")}`,
      ...report.tagFailures.map((failure) => `- Tag failure: ${failure}`),
    ].filter(Boolean);
    if (details.length > 0) lines.push(`### ${report.slug}`, "", ...(details as string[]), "");
  }
  return lines.join("\n");
}
