import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { bggTagRemovals, collectionGames, collections, games } from "../db/schema";

/** The file that `scripts/export-bgg-tags.browser.js` downloads. */
export type BggTagExport = {
  exportedAt: string;
  username: string;
  games: { bggId: number; tags: string[] }[];
  /** Rows of the BGG tags page with no BGG thing, such as a tagged person. The audit ignores them. */
  skippedRows: string[];
};

export type CollectionTagAudit = {
  slug: string;
  bggTag: string;
  /** Games in the collection that have the tag on BGG. */
  correctCount: number;
  /** Games in the collection that do not have the tag on BGG. */
  missingCount: number;
  /** Games with the tag on BGG that are not in the collection. */
  staleCount: number;
  /** Rows in the database whose tag state the audit corrects. */
  correctedStateCount: number;
};

export type TagAudit = {
  collections: CollectionTagAudit[];
  /** Tags in the export that belong to no collection. A tag sync never changes them. */
  otherTags: { tag: string; gameCount: number }[];
};

/**
 * Compares the tags on BGG with `collection_games`. With `apply`, it makes the database's tag
 * state match BGG, so that `pnpm tags:sync` adds each missing tag and removes each stale one.
 * It changes nothing on BGG.
 */
export async function auditBggTags(
  db: Database,
  tagExport: BggTagExport,
  options: { apply?: boolean } = {},
): Promise<TagAudit> {
  // BGG matches tags with no regard to case: its tag URLs are lowercase.
  const bggIdsByTag = new Map<string, Set<number>>();
  const tagNames = new Map<string, string>();
  for (const { bggId, tags } of tagExport.games) {
    for (const tag of tags) {
      const key = tag.toLowerCase();
      tagNames.set(key, tagNames.get(key) ?? tag);
      bggIdsByTag.set(key, (bggIdsByTag.get(key) ?? new Set()).add(bggId));
    }
  }

  const taggedCollections = await db
    .select({ id: collections.id, slug: collections.slug, bggTag: collections.bggTag })
    .from(collections)
    .where(isNotNull(collections.bggTag))
    .orderBy(asc(collections.slug));

  const audits: CollectionTagAudit[] = [];
  await db.transaction(async (tx) => {
    for (const collection of taggedCollections) {
      const bggTag = collection.bggTag as string;
      const onBgg = bggIdsByTag.get(bggTag.toLowerCase()) ?? new Set<number>();
      const rows = await tx
        .select({
          gameId: collectionGames.gameId,
          bggId: games.bggId,
          bggTaggedAt: collectionGames.bggTaggedAt,
        })
        .from(collectionGames)
        .innerJoin(games, eq(games.id, collectionGames.gameId))
        .where(and(eq(collectionGames.collectionId, collection.id), isNotNull(games.bggId)));
      const inCollection = new Set(rows.map((row) => row.bggId as number));
      const pendingRemovals = new Set(
        (
          await tx
            .select({ bggId: bggTagRemovals.bggId })
            .from(bggTagRemovals)
            .where(eq(bggTagRemovals.bggTag, bggTag))
        ).map((row) => row.bggId),
      );

      const confirmedGameIds = rows
        .filter((row) => onBgg.has(row.bggId as number) && row.bggTaggedAt === null)
        .map((row) => row.gameId);
      const unconfirmedGameIds = rows
        .filter((row) => !onBgg.has(row.bggId as number) && row.bggTaggedAt !== null)
        .map((row) => row.gameId);
      const staleBggIds = [...onBgg].filter((bggId) => !inCollection.has(bggId));
      const newRemovals = staleBggIds.filter((bggId) => !pendingRemovals.has(bggId));
      const unneededRemovals = [...pendingRemovals].filter((bggId) => !onBgg.has(bggId));

      audits.push({
        slug: collection.slug,
        bggTag,
        correctCount: rows.filter((row) => onBgg.has(row.bggId as number)).length,
        missingCount: rows.filter((row) => !onBgg.has(row.bggId as number)).length,
        staleCount: staleBggIds.length,
        correctedStateCount:
          confirmedGameIds.length +
          unconfirmedGameIds.length +
          newRemovals.length +
          unneededRemovals.length,
      });
      if (!options.apply) continue;

      const inThisCollection = eq(collectionGames.collectionId, collection.id);
      if (confirmedGameIds.length > 0) {
        await tx
          .update(collectionGames)
          .set({ bggTaggedAt: new Date() })
          .where(
            and(
              inThisCollection,
              inArray(collectionGames.gameId, confirmedGameIds),
              isNull(collectionGames.bggTaggedAt),
            ),
          );
      }
      if (unconfirmedGameIds.length > 0) {
        await tx
          .update(collectionGames)
          .set({ bggTaggedAt: null })
          .where(and(inThisCollection, inArray(collectionGames.gameId, unconfirmedGameIds)));
      }
      if (newRemovals.length > 0) {
        await tx
          .insert(bggTagRemovals)
          .values(newRemovals.map((bggId) => ({ bggTag, bggId })))
          .onConflictDoNothing();
      }
      if (unneededRemovals.length > 0) {
        await tx
          .delete(bggTagRemovals)
          .where(
            and(eq(bggTagRemovals.bggTag, bggTag), inArray(bggTagRemovals.bggId, unneededRemovals)),
          );
      }
    }
  });

  const collectionTags = new Set(
    taggedCollections.map((collection) => (collection.bggTag as string).toLowerCase()),
  );
  const otherTags = [...bggIdsByTag]
    .filter(([key]) => !collectionTags.has(key))
    .map(([key, bggIds]) => ({ tag: tagNames.get(key) as string, gameCount: bggIds.size }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
  return { collections: audits, otherTags };
}
