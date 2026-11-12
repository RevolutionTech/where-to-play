import { parseArgs } from "node:util";
import { BggClient } from "../src/bgg/client";
import { createDatabase } from "../src/db/client";
import { formatTagFailure, syncBggTags, type TagSyncReport } from "../src/importer/bgg-tags";

// BGG's firewall refuses logins from GitHub-hosted runners, so this runs on a machine that BGG
// lets log in. It applies the tag changes that imports left pending.
const { values: args } = parseArgs({
  options: { collection: { type: "string", multiple: true } },
});

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const db = createDatabase(requiredEnv("DATABASE_URL"));
const bgg = new BggClient({
  apiToken: requiredEnv("BGG_API_TOKEN"),
  credentials: { username: requiredEnv("BGG_USERNAME"), password: requiredEnv("BGG_PASSWORD") },
});

let reports: TagSyncReport[];
try {
  reports = await syncBggTags(db, bgg, { slugs: args.collection });
} finally {
  await db.$client.end();
}

console.log(`\n${formatSummary(reports)}`);
process.exitCode = reports.some((report) => report.failedTagCount > 0) ? 1 : 0;

function formatSummary(reports: TagSyncReport[]) {
  const lines = [
    "## BGG tag sync",
    "",
    "| Collection | Tags added | Tags removed | Tag failures | Tags pending |",
    "| --- | --- | --- | --- | --- |",
    ...reports.map(
      (report) =>
        `| ${report.slug} | ${report.addedTagCount} | ${report.removedTagCount} | ${report.failedTagCount} | ${report.pendingTagCount} |`,
    ),
    "",
  ];
  for (const report of reports) {
    const failure = formatTagFailure(report);
    if (failure) lines.push(`### ${report.slug}`, "", failure, "");
  }
  return lines.join("\n");
}
