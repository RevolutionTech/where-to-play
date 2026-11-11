import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  type BggClient,
  type BggSearchResult,
  type BggThing,
  bggGameUrl,
  THINGS_PER_REQUEST,
} from "../bgg/client";
import type { Database } from "../db/client";
import { collectionGames, collections, games } from "../db/schema";

/** One thing request gives the thumbnails for one page. */
export const PAGE_SIZE = THINGS_PER_REQUEST;

// BGG data changes rarely. A shared cache keeps traffic on BGG low.
const CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

export type GamesDependencies = {
  db: Database;
  bgg: BggClient;
};

// Hono derives the client's query parameter names from these keys, and makes the optional keys
// optional for the client too.
type SearchQuery = {
  q: string;
  expansions?: boolean;
  /** Keep only games that a public collection owns. */
  available?: boolean;
  page?: number;
};

const searchQueryValidator = validator("query", (query, c): SearchQuery | Response => {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const page = query.page === undefined ? 1 : Number(query.page);
  if (q === "" || !Number.isInteger(page) || page < 1) {
    return c.json({ error: "Give a search text in q, and a page of 1 or more." as const }, 400);
  }
  return {
    q,
    expansions: query.expansions === "true",
    available: query.available === "true",
    page,
  };
});

const bggIdValidator = validator("param", (params, c) => {
  const bggId = Number(params.bggId);
  if (!Number.isInteger(bggId) || bggId < 1) {
    return c.json({ error: "Game not found." as const }, 404);
  }
  return { bggId };
});

export function createGamesRoutes({ db, bgg }: GamesDependencies) {
  return new Hono()
    .get("/", searchQueryValidator, async (c) => {
      const {
        q,
        expansions: includeExpansions,
        available: availableOnly,
        page = 1,
      } = c.req.valid("query");

      let searchResults: BggSearchResult[];
      try {
        searchResults = await bgg.searchGames(q);
      } catch (error) {
        console.error("BGG search failed:", error);
        return c.json({ error: "BoardGameGeek is not available. Try again later." as const }, 502);
      }

      const matches = includeExpansions
        ? searchResults
        : searchResults.filter((result) => !result.isExpansion);
      const collectionCounts = await countPublicCollections(
        db,
        matches.map((match) => match.bggId),
      );
      const filtered = availableOnly
        ? matches.filter((match) => collectionCounts.has(match.bggId))
        : matches;
      const sorted = sortByRelevance(filtered, q);
      const pageResults = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      let things: BggThing[];
      try {
        things = await bgg.fetchThings(pageResults.map((result) => result.bggId));
      } catch (error) {
        console.error("BGG thing request failed:", error);
        return c.json({ error: "BoardGameGeek is not available. Try again later." as const }, 502);
      }
      const thingsById = new Map(things.map((thing) => [thing.bggId, thing]));

      c.header("Cache-Control", CACHE_CONTROL);
      return c.json(
        {
          total: sorted.length,
          page,
          pageSize: PAGE_SIZE,
          results: pageResults.map((result) => {
            const thing = thingsById.get(result.bggId);
            return {
              bggId: result.bggId,
              // The search gives the name that matched, which can be an alternate name.
              name: thing?.name || result.name,
              yearPublished: result.yearPublished,
              isExpansion: result.isExpansion,
              thumbnailUrl: thing?.thumbnailUrl ?? null,
              placeCount:
                (collectionCounts.get(result.bggId) ?? 0) +
                (thing?.digitalImplementations.length ?? 0),
            };
          }),
        },
        200,
      );
    })
    .get("/:bggId", bggIdValidator, async (c) => {
      const { bggId } = c.req.valid("param");

      const [storedGame] = await db.select().from(games).where(eq(games.bggId, bggId));
      const owningCollections = storedGame
        ? await db
            .select({
              slug: collections.slug,
              name: collections.name,
              kind: collections.kind,
              websiteUrl: collections.websiteUrl,
              location: collections.location,
            })
            .from(collectionGames)
            .innerJoin(collections, eq(collections.id, collectionGames.collectionId))
            .where(and(eq(collectionGames.gameId, storedGame.id), eq(collections.isPrivate, false)))
            .orderBy(asc(collections.name))
        : [];

      let thing: BggThing | undefined;
      let bggFailed = false;
      try {
        [thing] = await bgg.fetchThings([bggId]);
      } catch (error) {
        console.error("BGG thing request failed:", error);
        bggFailed = true;
      }

      const details = thing ?? storedGame;
      if (!details) {
        return bggFailed
          ? c.json({ error: "BoardGameGeek is not available. Try again later." as const }, 502)
          : c.json({ error: "Game not found." as const }, 404);
      }

      if (thing) c.header("Cache-Control", CACHE_CONTROL);
      return c.json(
        {
          bggId,
          name: details.name,
          yearPublished: details.yearPublished,
          description: details.description,
          minPlayers: details.minPlayers,
          maxPlayers: details.maxPlayers,
          minPlaytimeMinutes: details.minPlaytimeMinutes,
          maxPlaytimeMinutes: details.maxPlaytimeMinutes,
          bggRating: details.bggRating,
          bggRank: details.bggRank,
          imageUrl: thing?.imageUrl ?? null,
          bggUrl: bggGameUrl(bggId),
          collections: owningCollections,
          digitalImplementations: thing?.digitalImplementations ?? [],
        },
        200,
      );
    });
}

/** Returns the number of public collections that own each game, for games that have any. */
async function countPublicCollections(db: Database, bggIds: number[]) {
  if (bggIds.length === 0) return new Map<number, number>();
  const rows = await db
    .select({ bggId: games.bggId, collectionCount: count() })
    .from(games)
    .innerJoin(collectionGames, eq(collectionGames.gameId, games.id))
    .innerJoin(collections, eq(collections.id, collectionGames.collectionId))
    .where(and(inArray(games.bggId, bggIds), eq(collections.isPrivate, false)))
    .groupBy(games.bggId);
  return new Map(rows.map((row) => [Number(row.bggId), row.collectionCount]));
}

/**
 * Exact name matches come first, then names that start with the query, then the rest. Newer
 * games come first in each group, because BGG's own order is close to random.
 */
function sortByRelevance(results: BggSearchResult[], query: string) {
  const normalizedQuery = normalize(query);
  const group = (result: BggSearchResult) => {
    const name = normalize(result.name);
    if (name === normalizedQuery) return 0;
    if (name.startsWith(normalizedQuery)) return 1;
    return 2;
  };
  return results
    .map((result) => ({ result, group: group(result) }))
    .sort(
      (a, b) =>
        a.group - b.group ||
        (b.result.yearPublished ?? 0) - (a.result.yearPublished ?? 0) ||
        a.result.name.localeCompare(b.result.name),
    )
    .map(({ result }) => result);
}

function normalize(name: string) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
