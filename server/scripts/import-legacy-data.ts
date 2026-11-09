/**
 * One-time import of the legacy "Board Games" data into the where_to_play schema.
 *
 * It reads JSON exports, not the legacy tables, so it never touches them:
 * - boardgames.json, boardgame_aliases.json, collections_global.json: the legacy tables.
 * - bgg-things.json: BGG details for the games that legacy has no details for, and for the
 *   games whose legacy aliases need their original BGG names.
 * - source-names.json: the names that current collection sources use.
 *
 * Legacy stored names in a normalized form that deletes punctuation ("Ticket-to-Ride" became
 * "tickettoride"). The import replaces each legacy name with an original spelling when one is
 * known, so the current rule normalizes it correctly.
 *
 * Run it again safely: every write skips or updates rows that exist. The collections must exist
 * first (scripts/upsert-collections.ts).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { normalizeGameName } from "../src/db/schema";
import type { BggThing } from "../src/importer/bgg";

type LegacyGame = {
  bgg_id: number;
  name: string;
  description: string | null;
  year_published: number | null;
  min_players: number | null;
  max_players: number | null;
  min_playtime: number | null;
  max_playtime: number | null;
  bgg_rating: number | null;
  bgg_rank: number | null;
};
type LegacyAlias = { bgg_id: number | null; name_clean: string; outside_of_bgg: boolean };
type LegacyCollectionRow = { collection_name: string; bgg_id: number };
type SourceGame = { name: string; bggId: number | null };

// Two games have the same name. When a source gives only that name, it means this game.
const PREFERRED_GAME_FOR_NAME: { name: string; bggId: number }[] = [
  { name: "Mountain Goats", bggId: 63975 },
  { name: "Sleeping Gods: Primeval Peril", bggId: 362205 },
];

const LEGACY_TAG_PREFIX = "Collection:-";

const { values: args } = parseArgs({
  options: {
    input: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!args.input)
  throw new Error("Usage: import-legacy-data.ts --input <export folder> [--dry-run]");
const read = <T>(file: string): T => JSON.parse(readFileSync(`${args.input}/${file}`, "utf8"));

const legacyGames = read<LegacyGame[]>("boardgames.json");
const legacyAliases = read<LegacyAlias[]>("boardgame_aliases.json");
const legacyCollectionRows = read<LegacyCollectionRow[]>("collections_global.json");
const thingByBggId = new Map(
  Object.values(read<Record<string, BggThing>>("bgg-things.json")).map((thing) => [
    thing.bggId,
    thing,
  ]),
);
const sourceNames = Object.values(read<Record<string, SourceGame[]>>("source-names.json"))
  .flat()
  .map((game) => game.name);

/** The legacy rule, from the Python importer. */
function legacyForm(name: string) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lettersAndDigits(name: string) {
  return legacyForm(name).replace(/[^\p{L}\p{N}]/gu, "");
}

// --- Games: legacy details, replaced by fresh BGG details where we have them.

const legacyBggIds = new Set(legacyGames.map((game) => game.bgg_id));
const nullIfZero = (value: number | null) => (value ? value : null);
const gameByBggId = new Map<number, Omit<BggThing, "alternateNames">>();
for (const game of legacyGames) {
  gameByBggId.set(game.bgg_id, {
    bggId: game.bgg_id,
    name: game.name,
    description: game.description || null,
    yearPublished: nullIfZero(game.year_published),
    minPlayers: nullIfZero(game.min_players),
    maxPlayers: nullIfZero(game.max_players),
    minPlaytimeMinutes: nullIfZero(game.min_playtime),
    maxPlaytimeMinutes: nullIfZero(game.max_playtime),
    bggRating: nullIfZero(game.bgg_rating),
    bggRank: nullIfZero(game.bgg_rank),
  });
}
for (const { alternateNames: _, ...thing } of thingByBggId.values()) {
  gameByBggId.set(thing.bggId, thing);
}

// --- Names. When two names normalize the same, the row that sorts first wins (see below).

type NameRow = { bggId: number; name: string; origin: string };
const nameRows: NameRow[] = PREFERRED_GAME_FOR_NAME.map(({ name, bggId }) => ({
  bggId,
  name,
  origin: "preferred",
}));
for (const game of gameByBggId.values()) {
  const origin = legacyBggIds.has(game.bggId) ? "legacy primary" : "new primary";
  nameRows.push({ bggId: game.bggId, name: game.name, origin });
}
for (const thing of thingByBggId.values()) {
  for (const name of thing.alternateNames) {
    nameRows.push({ bggId: thing.bggId, name, origin: "bgg alternate" });
  }
}

// Original spellings that legacy saw, by their legacy form.
const originalsByLegacyForm = new Map<string, Set<string>>();
function addOriginal(name: string) {
  const form = legacyForm(name);
  if (!originalsByLegacyForm.has(form)) originalsByLegacyForm.set(form, new Set());
  originalsByLegacyForm.get(form)?.add(name);
}
for (const game of legacyGames) addOriginal(game.name);
for (const name of sourceNames) addOriginal(name);

const aliasOutcomes: Record<string, number> = {};
const countOutcome = (outcome: string) => {
  aliasOutcomes[outcome] = (aliasOutcomes[outcome] ?? 0) + 1;
};

/** The spellings to store for a legacy name, or nothing when the name must be dropped. */
function spellingsFor(alias: LegacyAlias): { names: string[]; outcome: string } {
  const thing = alias.bgg_id === null ? undefined : thingByBggId.get(alias.bgg_id);
  const bggNames = thing ? [thing.name, ...thing.alternateNames] : [];
  const originals = new Set([
    ...bggNames.filter((name) => legacyForm(name) === alias.name_clean),
    ...(originalsByLegacyForm.get(alias.name_clean) ?? []),
  ]);
  if (originals.size > 0) return { names: [...originals], outcome: "original spelling" };
  // Legacy lost the spaces of some BGG names. BGG's own spelling is already in the names.
  const letters = alias.name_clean.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters === "") return { names: [], outcome: "dropped: empty" };
  if (bggNames.some((name) => lettersAndDigits(name) === letters)) {
    return { names: [], outcome: "dropped: BGG name without spaces" };
  }
  return { names: [alias.name_clean], outcome: "legacy form (mapped by hand)" };
}

type UnmatchedRow = { name: string; status: "pending" | "ignored"; origin: string };
const unmatchedRows: UnmatchedRow[] = [];
for (const alias of legacyAliases) {
  const { names, outcome } = spellingsFor(alias);
  if (alias.outside_of_bgg) {
    countOutcome(`ignored: ${outcome}`);
    for (const name of names)
      unmatchedRows.push({ name, status: "ignored", origin: "outside BGG" });
  } else if (alias.bgg_id === null) {
    countOutcome(`pending: ${outcome}`);
    for (const name of names) unmatchedRows.push({ name, status: "pending", origin: "no BGG ID" });
  } else if (!gameByBggId.has(alias.bgg_id)) {
    // BGG returns no board game for these IDs. They are accessories, not games.
    countOutcome(`ignored (not a game on BGG): ${outcome}`);
    for (const name of names) unmatchedRows.push({ name, status: "ignored", origin: "accessory" });
  } else {
    countOutcome(`game name: ${outcome}`);
    for (const name of names) nameRows.push({ bggId: alias.bgg_id, name, origin: "legacy alias" });
  }
}

const collectionCountByBggId = new Map<number, number>();
for (const row of legacyCollectionRows) {
  collectionCountByBggId.set(row.bgg_id, (collectionCountByBggId.get(row.bgg_id) ?? 0) + 1);
}
const moreCollectionsFirst = (a: number, b: number) =>
  (collectionCountByBggId.get(b) ?? 0) - (collectionCountByBggId.get(a) ?? 0) || a - b;

// Replay how legacy matched each current source name, and store that spelling for the same game.
// Then a source name keeps its legacy game, also when the current rule normalizes it differently
// ("Time Stories" matched "T.I.M.E Stories" in legacy).
function legacyPrimaryForm(name: string) {
  // The generated name_clean column of the legacy boardgames table.
  return name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .toLowerCase()
    .trim();
}
const legacyGameByPrimaryForm = new Map<string, number>();
for (const game of [...legacyGames].sort((a, b) => moreCollectionsFirst(a.bgg_id, b.bgg_id))) {
  const form = legacyPrimaryForm(game.name);
  if (!legacyGameByPrimaryForm.has(form)) legacyGameByPrimaryForm.set(form, game.bgg_id);
}
const legacyGameByAliasForm = new Map(
  legacyAliases.flatMap((alias) =>
    alias.bgg_id !== null && !alias.outside_of_bgg ? [[alias.name_clean, alias.bgg_id]] : [],
  ),
);
for (const name of new Set(sourceNames)) {
  const form = legacyForm(name);
  const bggId = legacyGameByPrimaryForm.get(form) ?? legacyGameByAliasForm.get(form);
  if (bggId !== undefined && gameByBggId.has(bggId)) {
    nameRows.push({ bggId, name, origin: "legacy match of a source name" });
  }
}

// The first levels repeat how legacy resolved a name: its primary names, then its aliases, some
// of which were made by hand. Names of games that legacy did not know come after them, so that
// each name keeps the game it had in legacy. Between games at the same level, the game in more
// collections is more likely the one that a source means.
const ORIGIN_PRIORITY = [
  "preferred",
  "legacy primary",
  "legacy match of a source name",
  "legacy alias",
  "new primary",
  "bgg alternate",
];
nameRows.sort(
  (a, b) =>
    ORIGIN_PRIORITY.indexOf(a.origin) - ORIGIN_PRIORITY.indexOf(b.origin) ||
    moreCollectionsFirst(a.bggId, b.bggId),
);

// --- Write everything in one transaction.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
const db = createDatabase(databaseUrl);
const json = (rows: unknown) => sql`${JSON.stringify(rows)}::json`;

try {
  await db.transaction(async (tx) => {
    const collectionNames = [...new Set(legacyCollectionRows.map((row) => row.collection_name))];
    const missingCollections = await tx.execute<{ name: string }>(sql`
      SELECT name FROM json_array_elements_text(${json(collectionNames)}) AS legacy(name)
      WHERE NOT EXISTS (
        SELECT FROM where_to_play.collections WHERE bgg_tag = ${LEGACY_TAG_PREFIX} || legacy.name
      )
    `);
    if (missingCollections.length > 0) {
      throw new Error(
        `No collection has the BGG tag for: ${missingCollections.map((row) => row.name).join(", ")}. Run scripts/upsert-collections.ts first.`,
      );
    }

    const savedGames = await tx.execute(sql`
      INSERT INTO where_to_play.games (bgg_id, name, description, year_published, min_players,
        max_players, min_playtime_minutes, max_playtime_minutes, bgg_rating, bgg_rank)
      SELECT "bggId", name, description, "yearPublished", "minPlayers", "maxPlayers",
        "minPlaytimeMinutes", "maxPlaytimeMinutes", "bggRating", "bggRank"
      FROM json_to_recordset(${json([...gameByBggId.values()])}) AS g(
        "bggId" integer, name text, description text, "yearPublished" smallint,
        "minPlayers" smallint, "maxPlayers" smallint, "minPlaytimeMinutes" integer,
        "maxPlaytimeMinutes" integer, "bggRating" real, "bggRank" integer)
      ON CONFLICT (bgg_id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        year_published = excluded.year_published, min_players = excluded.min_players,
        max_players = excluded.max_players, min_playtime_minutes = excluded.min_playtime_minutes,
        max_playtime_minutes = excluded.max_playtime_minutes, bgg_rating = excluded.bgg_rating,
        bgg_rank = excluded.bgg_rank, updated_at = now()
    `);

    await tx.execute(sql`
      CREATE TEMP TABLE legacy_names ON COMMIT DROP AS
      SELECT n.priority, n.bgg_id, n.name, n.origin,
        ${normalizeGameName(sql`n.name`)} AS name_normalized
      FROM ROWS FROM (json_to_recordset(${json(nameRows)}) AS ("bggId" integer, name text, origin text))
        WITH ORDINALITY AS n(bgg_id, name, origin, priority)
    `);
    const savedNames = await tx.execute(sql`
      INSERT INTO where_to_play.game_names (game_id, name)
      SELECT DISTINCT ON (n.name_normalized) games.id, n.name
      FROM legacy_names n JOIN where_to_play.games ON games.bgg_id = n.bgg_id
      WHERE n.name_normalized <> ''
      ORDER BY n.name_normalized, n.priority
      ON CONFLICT DO NOTHING
    `);
    const nameConflicts = await tx.execute<{
      name_normalized: string;
      kept: string;
      lost: string;
    }>(sql`
      SELECT n.name_normalized,
        min(kept_game.name) AS kept,
        string_agg(DISTINCT lost_game.name || ' (' || lost_game.bgg_id || ', ' || n.origin || ')', '; ') AS lost
      FROM legacy_names n
      JOIN where_to_play.game_names kept ON kept.name_normalized = n.name_normalized
      JOIN where_to_play.games kept_game ON kept_game.id = kept.game_id
      JOIN where_to_play.games lost_game ON lost_game.bgg_id = n.bgg_id
      WHERE lost_game.id <> kept.game_id
      GROUP BY n.name_normalized
      ORDER BY n.name_normalized
    `);

    await tx.execute(sql`
      CREATE TEMP TABLE legacy_unmatched ON COMMIT DROP AS
      SELECT u.priority, u.name, u.status, u.origin,
        ${normalizeGameName(sql`u.name`)} AS name_normalized
      FROM ROWS FROM (json_to_recordset(${json(unmatchedRows)}) AS (name text, status text, origin text))
        WITH ORDINALITY AS u(name, status, origin, priority)
    `);
    const savedUnmatched = await tx.execute(sql`
      INSERT INTO where_to_play.unmatched_names (name, status)
      SELECT DISTINCT ON (u.name_normalized) u.name, u.status::where_to_play.unmatched_name_status
      FROM legacy_unmatched u
      WHERE u.name_normalized <> ''
        AND NOT EXISTS (
          SELECT FROM where_to_play.game_names WHERE game_names.name_normalized = u.name_normalized
        )
      ORDER BY u.name_normalized, u.priority
      ON CONFLICT DO NOTHING
    `);
    const unmatchedThatAreGameNames = await tx.execute<{ name: string; game: string }>(sql`
      SELECT DISTINCT u.name, games.name AS game
      FROM legacy_unmatched u
      JOIN where_to_play.game_names ON game_names.name_normalized = u.name_normalized
      JOIN where_to_play.games ON games.id = game_names.game_id
      ORDER BY u.name
    `);

    const savedCollectionGames = await tx.execute(sql`
      INSERT INTO where_to_play.collection_games (collection_id, game_id)
      SELECT collections.id, games.id
      FROM json_to_recordset(${json(legacyCollectionRows)}) AS r(collection_name text, bgg_id integer)
      JOIN where_to_play.collections ON collections.bgg_tag = ${LEGACY_TAG_PREFIX} || r.collection_name
      JOIN where_to_play.games ON games.bgg_id = r.bgg_id
      ON CONFLICT DO NOTHING
    `);
    const skippedCollectionRows = legacyCollectionRows.filter(
      (row) => !gameByBggId.has(row.bgg_id),
    );

    console.log(args["dry-run"] ? "DRY RUN: nothing is saved.\n" : "");
    console.log("Legacy aliases:", aliasOutcomes);
    console.log("games saved:", savedGames.count, "of", gameByBggId.size);
    console.log("game_names saved:", savedNames.count, "from", nameRows.length, "candidate rows");
    console.log("unmatched_names saved:", savedUnmatched.count, "from", unmatchedRows.length);
    console.log(
      "collection_games saved:",
      savedCollectionGames.count,
      "of",
      legacyCollectionRows.length,
    );
    console.log("collection rows skipped (no game on BGG):", skippedCollectionRows.length);
    console.log(`\nNames that belong to another game (${nameConflicts.length}):`);
    for (const row of nameConflicts)
      console.log(`  "${row.name_normalized}": kept ${row.kept}; not for ${row.lost}`);
    console.log(
      `\nUnmatched names left out, because they are game names (${unmatchedThatAreGameNames.length}):`,
    );
    for (const row of unmatchedThatAreGameNames)
      console.log(`  "${row.name}" is a name of ${row.game}`);

    if (args["dry-run"]) tx.rollback();
  });
} catch (error) {
  if (!(error instanceof TransactionRollbackError)) throw error;
} finally {
  await db.$client.end();
}
