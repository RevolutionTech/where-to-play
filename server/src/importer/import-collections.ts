import { and, asc, eq, inArray, sql, TransactionRollbackError } from "drizzle-orm";
import type { BggStats, BggThing } from "../bgg/client";
import type { Database } from "../db/client";
import {
  bggTagRemovals,
  collectionGames,
  collections,
  gameNames,
  games,
  normalizeGameName,
  unmatchedNames,
} from "../db/schema";
import { countPendingTagChanges, syncCollectionTags, type TagSyncResult } from "./bgg-tags";
import { fetchSourceGames, type SourceContext } from "./sources";

export type ImportOptions = {
  /** Import only the collections with these slugs. All collections when empty. */
  slugs?: string[];
  /** Read sources and BGG, but write nothing to the database or to BGG. */
  dryRun?: boolean;
  /** Import collections even when their source shrinks a lot. */
  force?: boolean;
  /** Save the import, but leave BGG tag changes pending for a later tag sync. */
  skipTags?: boolean;
};

export type CollectionReport = {
  slug: string;
  outcome: "imported" | "skipped" | "failed";
  /** Why the collection was skipped or failed. */
  reason?: string;
  sourceGameCount: number;
  addedGameCount: number;
  removedGameCount: number;
  newGameCount: number;
  /** Games already in the database whose details the source's BGG stats updated. */
  refreshedGameCount: number;
  unmatchedNames: string[];
  /** BGG IDs that a source gives, but that BGG knows as neither a game nor an accessory. */
  unknownBggIds: number[];
  tags: TagSyncResult;
};

type Collection = typeof collections.$inferSelect;

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DatabaseOrTransaction = Database | Transaction;

// A source with less than this share of the collection's current games is probably broken.
const MIN_SHARE_OF_CURRENT_GAMES = 0.5;

class SkipCollection extends Error {}

export async function importCollections(
  db: Database,
  context: SourceContext,
  options: ImportOptions = {},
): Promise<CollectionReport[]> {
  const selectedCollections = await db
    .select()
    .from(collections)
    .where(options.slugs?.length ? inArray(collections.slug, options.slugs) : undefined)
    .orderBy(asc(collections.slug));
  const missingSlugs = (options.slugs ?? []).filter(
    (slug) => !selectedCollections.some((collection) => collection.slug === slug),
  );
  if (missingSlugs.length > 0)
    throw new Error(`No collection has slug ${missingSlugs.join(", ")}.`);

  const reports: CollectionReport[] = [];
  for (const collection of selectedCollections) {
    console.log(`Importing ${collection.slug} (${collection.sourceKind})...`);
    const report = emptyReport(collection.slug);
    try {
      await importCollection(db, collection, context, options, report);
      report.outcome = "imported";
    } catch (error) {
      report.outcome = error instanceof SkipCollection ? "skipped" : "failed";
      report.reason = error instanceof Error ? error.message : String(error);
      if (report.outcome === "failed") console.error(error);
    }
    reports.push(report);
  }
  return reports;
}

async function importCollection(
  db: Database,
  collection: Collection,
  context: SourceContext,
  options: ImportOptions,
  report: CollectionReport,
) {
  // Phase 1: read the source and BGG, with no open transaction.
  const sourceGames = await fetchSourceGames(collection, context);
  report.sourceGameCount = sourceGames.length;
  const sourceNames = sourceGames.filter((game) => game.bggId === null).map((game) => game.name);
  const sourceBggIds = sourceGames.flatMap((game) => (game.bggId === null ? [] : [game.bggId]));

  const namesToSearch = (await lookUpNames(db, sourceNames))
    .filter((match) => match.gameId === null && !match.ignored)
    .map((match) => match.name);
  const bggIdBySearchedName = new Map<string, number>();
  for (const name of namesToSearch) {
    const bggId = await context.bgg.search(name);
    if (bggId !== null) bggIdBySearchedName.set(name, bggId);
  }

  const wantedBggIds = [...new Set([...sourceBggIds, ...bggIdBySearchedName.values()])];
  const knownBggIds = new Set((await gameIdsByBggId(db, wantedBggIds)).keys());
  const fetchedThings = await context.bgg.fetchThings(
    wantedBggIds.filter((bggId) => !knownBggIds.has(bggId)),
  );
  // Accessories are not games, so collections leave them out.
  const newThings = fetchedThings.filter((thing) => !thing.isAccessory);
  const accessoryBggIds = new Set(
    fetchedThings.filter((thing) => thing.isAccessory).map((thing) => thing.bggId),
  );

  // Phase 2: write everything for this collection in one short transaction.
  try {
    await db.transaction(async (db) => {
      report.newGameCount = await saveThings(db, newThings);
      report.refreshedGameCount = await refreshStats(
        db,
        sourceGames.flatMap(({ bggId, bggStats }) =>
          bggId !== null && bggStats && knownBggIds.has(bggId) ? [{ bggId, ...bggStats }] : [],
        ),
      );

      const gameIdByBggId = await gameIdsByBggId(db, wantedBggIds);
      const searchedNames = [...bggIdBySearchedName].flatMap(([name, bggId]) => {
        const gameId = gameIdByBggId.get(bggId);
        return gameId === undefined ? [] : [{ gameId, name }];
      });
      // The next run then finds the name in the database, with no BGG search.
      if (searchedNames.length > 0) {
        await db.insert(gameNames).values(searchedNames).onConflictDoNothing();
      }

      const nameMatches = await lookUpNames(db, sourceNames);
      report.unmatchedNames = nameMatches
        .filter((match) => match.gameId === null && !match.ignored)
        .map((match) => match.name);
      if (report.unmatchedNames.length > 0) {
        await db
          .insert(unmatchedNames)
          .values(report.unmatchedNames.map((name) => ({ name })))
          .onConflictDoNothing();
      }
      await deleteResolvedUnmatchedNames(db);

      report.unknownBggIds = sourceBggIds.filter(
        (bggId) => !gameIdByBggId.has(bggId) && !accessoryBggIds.has(bggId),
      );
      const wantedGameIds = new Set([
        ...nameMatches.flatMap((match) => (match.gameId === null ? [] : [match.gameId])),
        ...sourceBggIds.flatMap((bggId) => gameIdByBggId.get(bggId) ?? []),
      ]);
      const currentGameIds = new Set(
        (
          await db
            .select({ gameId: collectionGames.gameId })
            .from(collectionGames)
            .where(eq(collectionGames.collectionId, collection.id))
        ).map((row) => row.gameId),
      );
      checkSourceIsTrusted(wantedGameIds.size, currentGameIds.size, options.force ?? false);

      const addedGameIds = [...wantedGameIds].filter((gameId) => !currentGameIds.has(gameId));
      const removedGameIds = [...currentGameIds].filter((gameId) => !wantedGameIds.has(gameId));
      report.addedGameCount = addedGameIds.length;
      report.removedGameCount = removedGameIds.length;
      if (addedGameIds.length > 0) {
        await db
          .insert(collectionGames)
          .values(addedGameIds.map((gameId) => ({ collectionId: collection.id, gameId })));
      }
      if (removedGameIds.length > 0) {
        await db
          .delete(collectionGames)
          .where(
            sql`${collectionGames.collectionId} = ${collection.id} AND ${inArray(collectionGames.gameId, removedGameIds)}`,
          );
      }

      if (collection.bggTag) {
        await recordTagRemovals(db, collection.bggTag, removedGameIds, addedGameIds);
      }
      if (options.dryRun) db.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }

  // Phase 3: BGG tags follow the committed change. A failed tag change stays pending.
  report.tags =
    options.dryRun || options.skipTags
      ? { ...report.tags, pendingTagCount: await countPendingTagChanges(db, collection) }
      : await syncCollectionTags(db, context.bgg, collection);
}

/**
 * Removed games need their tag removed. A game that came back keeps its tag, so its pending
 * removal is cancelled; its new row is untagged, and the next sync adds the tag again.
 */
async function recordTagRemovals(
  db: DatabaseOrTransaction,
  bggTag: string,
  removedGameIds: number[],
  addedGameIds: number[],
) {
  const removedBggIds = await bggIdsOf(db, removedGameIds);
  if (removedBggIds.length > 0) {
    await db
      .insert(bggTagRemovals)
      .values(removedBggIds.map((bggId) => ({ bggTag, bggId })))
      .onConflictDoNothing();
  }
  const addedBggIds = await bggIdsOf(db, addedGameIds);
  if (addedBggIds.length > 0) {
    await db
      .delete(bggTagRemovals)
      .where(and(eq(bggTagRemovals.bggTag, bggTag), inArray(bggTagRemovals.bggId, addedBggIds)));
  }
}

function emptyReport(slug: string): CollectionReport {
  return {
    slug,
    outcome: "failed",
    sourceGameCount: 0,
    addedGameCount: 0,
    removedGameCount: 0,
    newGameCount: 0,
    refreshedGameCount: 0,
    unmatchedNames: [],
    unknownBggIds: [],
    tags: { addedTagCount: 0, removedTagCount: 0, failedTagCount: 0, pendingTagCount: 0 },
  };
}

function checkSourceIsTrusted(wantedCount: number, currentCount: number, force: boolean) {
  if (force) return;
  if (wantedCount === 0) {
    throw new SkipCollection("The source gave no games that match a game. Use --force to import.");
  }
  if (wantedCount < currentCount * MIN_SHARE_OF_CURRENT_GAMES) {
    throw new SkipCollection(
      `The source matched ${wantedCount} games, but the collection has ${currentCount}. Use --force to import.`,
    );
  }
}

type NameMatch = { name: string; gameId: number | null; ignored: boolean };

async function lookUpNames(db: DatabaseOrTransaction, names: string[]): Promise<NameMatch[]> {
  if (names.length === 0) return [];
  const normalizedInput = normalizeGameName(sql`input.name`);
  const rows = await db.execute<{ name: string; game_id: string | null; ignored: boolean }>(sql`
    SELECT input.name, game_names.game_id, coalesce(unmatched_names.status = 'ignored', false) AS ignored
    FROM json_array_elements_text(${JSON.stringify(names)}::json) AS input(name)
    LEFT JOIN where_to_play.game_names ON game_names.name_normalized = ${normalizedInput}
    LEFT JOIN where_to_play.unmatched_names ON unmatched_names.name_normalized = ${normalizedInput}
  `);
  return rows.map((row) => ({
    name: row.name,
    gameId: row.game_id === null ? null : Number(row.game_id),
    ignored: row.ignored,
  }));
}

async function gameIdsByBggId(db: DatabaseOrTransaction, bggIds: number[]) {
  if (bggIds.length === 0) return new Map<number, number>();
  const rows = await db
    .select({ id: games.id, bggId: games.bggId })
    .from(games)
    .where(inArray(games.bggId, bggIds));
  return new Map(rows.map((row) => [row.bggId as number, row.id]));
}

async function bggIdsOf(db: DatabaseOrTransaction, gameIds: number[]) {
  if (gameIds.length === 0) return [];
  const rows = await db
    .select({ bggId: games.bggId })
    .from(games)
    .where(inArray(games.id, gameIds));
  return rows.flatMap((row) => (row.bggId === null ? [] : [row.bggId]));
}

/** Returns the number of games that were not in the database before. */
export async function saveThings(db: DatabaseOrTransaction, things: BggThing[]) {
  if (things.length === 0) return 0;
  const savedGames = await db
    .insert(games)
    .values(things.map(({ alternateNames: _, isAccessory: __, ...details }) => details))
    .onConflictDoUpdate({
      target: games.bggId,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        yearPublished: sql`excluded.year_published`,
        minPlayers: sql`excluded.min_players`,
        maxPlayers: sql`excluded.max_players`,
        minPlaytimeMinutes: sql`excluded.min_playtime_minutes`,
        maxPlaytimeMinutes: sql`excluded.max_playtime_minutes`,
        bggRating: sql`excluded.bgg_rating`,
        bggRank: sql`excluded.bgg_rank`,
      },
    })
    .returning({ id: games.id, bggId: games.bggId });

  const gameIdByBggId = new Map(savedGames.map((game) => [game.bggId, game.id]));
  const names = things.flatMap((thing) =>
    [thing.name, ...thing.alternateNames].map((name) => ({
      gameId: gameIdByBggId.get(thing.bggId) as number,
      name,
    })),
  );
  await db.insert(gameNames).values(names).onConflictDoNothing();
  return savedGames.length;
}

/** Returns the number of games that it updated. */
async function refreshStats(db: DatabaseOrTransaction, stats: (BggStats & { bggId: number })[]) {
  if (stats.length === 0) return 0;
  const updated = await db.execute(sql`
    UPDATE where_to_play.games
    SET year_published = fresh."yearPublished",
        min_players = fresh."minPlayers",
        max_players = fresh."maxPlayers",
        min_playtime_minutes = fresh."minPlaytimeMinutes",
        max_playtime_minutes = fresh."maxPlaytimeMinutes",
        bgg_rating = fresh."bggRating",
        bgg_rank = fresh."bggRank",
        updated_at = now()
    FROM json_to_recordset(${JSON.stringify(stats)}::json) AS fresh(
      "bggId" integer,
      "yearPublished" smallint,
      "minPlayers" smallint,
      "maxPlayers" smallint,
      "minPlaytimeMinutes" smallint,
      "maxPlaytimeMinutes" smallint,
      "bggRating" real,
      "bggRank" integer
    )
    WHERE games.bgg_id = fresh."bggId"
  `);
  return updated.count;
}

/** Deletes pending names that now resolve, for example after a person added the name. */
async function deleteResolvedUnmatchedNames(db: DatabaseOrTransaction) {
  await db.execute(sql`
    DELETE FROM where_to_play.unmatched_names
    WHERE status = 'pending'
      AND EXISTS (
        SELECT FROM where_to_play.game_names
        WHERE game_names.name_normalized = unmatched_names.name_normalized
      )
  `);
}
