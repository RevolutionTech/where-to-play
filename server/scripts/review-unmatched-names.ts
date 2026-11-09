import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BggClient } from "../src/bgg/client";
import { createDatabase } from "../src/db/client";
import {
  applyNameDecisions,
  listPendingNames,
  type NameDecision,
} from "../src/importer/review-unmatched-names";

const { values: args } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    apply: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (args.list === Boolean(args.apply)) {
  throw new Error("Usage: review-unmatched-names.ts --list | --apply <decisions.json> [--dry-run]");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const db = createDatabase(requiredEnv("DATABASE_URL"));
try {
  if (args.list) {
    console.log(JSON.stringify(await listPendingNames(db), null, 2));
  } else {
    const decisions = JSON.parse(readFileSync(args.apply as string, "utf8")) as NameDecision[];
    const bgg = new BggClient({ apiToken: requiredEnv("BGG_API_TOKEN") });
    const results = await applyNameDecisions(db, bgg, decisions, { dryRun: args["dry-run"] });
    if (args["dry-run"]) console.log("DRY RUN: nothing is saved.");
    console.table(results);
    if (results.some((result) => result.outcome === "skipped")) process.exitCode = 1;
  }
} finally {
  await db.$client.end();
}
