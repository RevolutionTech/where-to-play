import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { type BggClient, BggLoginError } from "../bgg/client";
import type { Database } from "../db/client";
import { bggTagRemovals, collectionGames, collections, games } from "../db/schema";

export type TagSyncResult = {
  addedTagCount: number;
  removedTagCount: number;
  failedTagCount: number;
  /** The first error, because one cause, such as a refused login, usually fails all of them. */
  firstTagFailure?: string;
  /** Tag changes that the next sync will try. */
  pendingTagCount: number;
};

export type TagSyncReport = TagSyncResult & { slug: string };

/** One line for a run summary, or undefined when no tag change failed. */
export function formatTagFailure(result: TagSyncResult) {
  if (result.failedTagCount === 0) return undefined;
  return `- Tag failures: ${result.failedTagCount}. First failure: ${result.firstTagFailure}`;
}

type TaggedCollection = { id: number; bggTag: string | null };

type TagChange = { description: string; apply: () => Promise<void> };

/** Makes BGG tags match `collection_games` and `bgg_tag_removals` for these collections. */
export async function syncBggTags(
  db: Database,
  bgg: BggClient,
  options: { slugs?: string[] } = {},
): Promise<TagSyncReport[]> {
  const selectedCollections = await db
    .select({ id: collections.id, slug: collections.slug, bggTag: collections.bggTag })
    .from(collections)
    .where(options.slugs?.length ? inArray(collections.slug, options.slugs) : undefined)
    .orderBy(asc(collections.slug));
  const missingSlugs = (options.slugs ?? []).filter(
    (slug) => !selectedCollections.some((collection) => collection.slug === slug),
  );
  if (missingSlugs.length > 0)
    throw new Error(`No collection has slug ${missingSlugs.join(", ")}.`);

  const reports: TagSyncReport[] = [];
  for (const collection of selectedCollections) {
    if (!collection.bggTag) continue;
    console.log(`Syncing BGG tags for ${collection.slug}...`);
    reports.push({ slug: collection.slug, ...(await syncCollectionTags(db, bgg, collection)) });
  }
  return reports;
}

export async function syncCollectionTags(
  db: Database,
  bgg: BggClient,
  collection: TaggedCollection,
): Promise<TagSyncResult> {
  const result: TagSyncResult = {
    addedTagCount: 0,
    removedTagCount: 0,
    failedTagCount: 0,
    pendingTagCount: 0,
  };
  const { bggTag } = collection;
  if (!bggTag) return result;

  const changes: TagChange[] = [
    ...(await pendingAdditions(db, collection.id)).map(({ gameId, bggId }) => ({
      description: `add to ${bggId}`,
      apply: async () => {
        await bgg.addTag(bggId, bggTag);
        await db
          .update(collectionGames)
          .set({ bggTaggedAt: new Date() })
          .where(
            and(
              eq(collectionGames.collectionId, collection.id),
              eq(collectionGames.gameId, gameId),
            ),
          );
        result.addedTagCount++;
      },
    })),
    ...(await pendingRemovals(db, bggTag)).map((bggId) => ({
      description: `remove from ${bggId}`,
      apply: async () => {
        await bgg.removeTag(bggId, bggTag);
        await db
          .delete(bggTagRemovals)
          .where(and(eq(bggTagRemovals.bggTag, bggTag), eq(bggTagRemovals.bggId, bggId)));
        result.removedTagCount++;
      },
    })),
  ];

  for (const [index, change] of changes.entries()) {
    try {
      await change.apply();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.firstTagFailure ??= `${change.description}: ${message}`;
      if (error instanceof BggLoginError) {
        result.failedTagCount += changes.length - index;
        break;
      }
      result.failedTagCount++;
    }
  }
  result.pendingTagCount = await countPendingTagChanges(db, collection);
  return result;
}

export async function countPendingTagChanges(db: Database, collection: TaggedCollection) {
  if (!collection.bggTag) return 0;
  const additions = await pendingAdditions(db, collection.id);
  const removals = await pendingRemovals(db, collection.bggTag);
  return additions.length + removals.length;
}

async function pendingAdditions(db: Database, collectionId: number) {
  const rows = await db
    .select({ gameId: collectionGames.gameId, bggId: games.bggId })
    .from(collectionGames)
    .innerJoin(games, eq(games.id, collectionGames.gameId))
    .where(
      and(
        eq(collectionGames.collectionId, collectionId),
        isNull(collectionGames.bggTaggedAt),
        isNotNull(games.bggId),
      ),
    )
    .orderBy(asc(games.bggId));
  return rows.map((row) => ({ gameId: row.gameId, bggId: row.bggId as number }));
}

async function pendingRemovals(db: Database, bggTag: string) {
  const rows = await db
    .select({ bggId: bggTagRemovals.bggId })
    .from(bggTagRemovals)
    .where(eq(bggTagRemovals.bggTag, bggTag))
    .orderBy(asc(bggTagRemovals.bggId));
  return rows.map((row) => row.bggId);
}
