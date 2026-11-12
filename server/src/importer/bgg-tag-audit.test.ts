import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BggClient } from "../bgg/client";
import { createDatabase } from "../db/client";
import { bggTagRemovals, collectionGames, collections, gameNames, games } from "../db/schema";
import { testDatabaseUrl } from "../test/database";
import { auditBggTags, type BggTagExport } from "./bgg-tag-audit";
import { syncBggTags } from "./bgg-tags";

const db = createDatabase(testDatabaseUrl());

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ${bggTagRemovals}, ${collectionGames}, ${collections}, ${gameNames}, ${games} RESTART IDENTITY`,
  );
});

/** A fake BGG that answers logins, tag additions, and tag removals, and records each tag request. */
function fakeBgg(tagsOnBgg: Record<number, string[]>) {
  const tagRequests: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/login/api/v1")
      return new Response(null, { status: 204, headers: { "Set-Cookie": "SessionID=abc" } });
    if (url.pathname === "/api/tags" && init.method === "POST") {
      tagRequests.push(`add ${JSON.parse(String(init.body)).objectid}`);
      return Response.json({});
    }
    if (url.pathname === "/api/tags") {
      const bggId = Number(url.searchParams.get("objectid"));
      return Response.json({
        mytags: (tagsOnBgg[bggId] ?? []).map((rawtag) => ({ rawtag, pinid: bggId })),
      });
    }
    if (url.pathname.startsWith("/api/pins/") && init.method === "DELETE") {
      tagRequests.push(`remove ${url.pathname.split("/").pop()}`);
      return Response.json({});
    }
    throw new Error(`No fake response for ${init.method ?? "GET"} ${url}`);
  };
  const bgg = new BggClient({
    apiToken: "test-token",
    credentials: { username: "importer", password: "secret" },
    fetch: fakeFetch as typeof fetch,
    sleep: async () => {},
    minRequestGapMs: 0,
  });
  return { bgg, tagRequests };
}

function tagExport(tagsOnBgg: Record<number, string[]>): BggTagExport {
  return {
    exportedAt: "2026-11-12T10:00:00.000Z",
    username: "importer",
    games: Object.entries(tagsOnBgg).map(([bggId, tags]) => ({ bggId: Number(bggId), tags })),
    skippedRows: [],
  };
}

async function addCollection(slug: string) {
  const [collection] = await db
    .insert(collections)
    .values({
      slug,
      name: slug,
      kind: "cafe",
      bggTag: `Collection:-${slug}`,
      sourceKind: "bgg_collection",
      sourceConfig: { username: slug },
    })
    .returning();
  if (!collection) throw new Error("Could not add the collection.");
  return collection;
}

/** Adds games to the collection, marked as tagged, as the migration marked existing rows. */
async function addTaggedGames(collectionId: number, bggIds: number[]) {
  for (const bggId of bggIds) {
    const [game] = await db
      .insert(games)
      .values({ name: `Game ${bggId}`, bggId })
      .onConflictDoUpdate({ target: games.bggId, set: { name: `Game ${bggId}` } })
      .returning();
    if (!game) throw new Error("Could not add the game.");
    await db
      .insert(collectionGames)
      .values({ collectionId, gameId: game.id, bggTaggedAt: new Date() });
  }
}

describe("auditing BGG tags", () => {
  it("reports correct, missing, and stale tags, and tags that belong to no collection", async () => {
    const parlour = await addCollection("parlour");
    await addTaggedGames(parlour.id, [13, 822, 230802]);
    const tagsOnBgg = {
      13: ["Collection:-parlour", "Collection:-gone"],
      822: ["Collection:-gone"],
      266192: ["Collection:-parlour"],
    };

    const audit = await auditBggTags(db, tagExport(tagsOnBgg));

    expect(audit).toEqual({
      collections: [
        {
          slug: "parlour",
          bggTag: "Collection:-parlour",
          correctCount: 1,
          missingCount: 2,
          staleCount: 1,
          correctedStateCount: 3,
        },
      ],
      otherTags: [{ tag: "Collection:-gone", gameCount: 2 }],
    });
  });

  it("changes nothing without apply, so a later sync has nothing to do", async () => {
    const parlour = await addCollection("parlour");
    await addTaggedGames(parlour.id, [13, 822]);
    const tagsOnBgg = { 13: ["Collection:-parlour"], 266192: ["Collection:-parlour"] };

    await auditBggTags(db, tagExport(tagsOnBgg));
    const { bgg, tagRequests } = fakeBgg(tagsOnBgg);
    await syncBggTags(db, bgg);

    expect(tagRequests).toEqual([]);
  });

  it("with apply, makes the next sync add each missing tag and remove each stale one", async () => {
    const parlour = await addCollection("parlour");
    await addTaggedGames(parlour.id, [13, 822, 230802]);
    const tagsOnBgg = { 13: ["Collection:-parlour"], 266192: ["Collection:-parlour"] };

    await auditBggTags(db, tagExport(tagsOnBgg), { apply: true });
    const { bgg, tagRequests } = fakeBgg(tagsOnBgg);
    const [report] = await syncBggTags(db, bgg);

    expect(tagRequests).toEqual(["add 822", "add 230802", "remove 266192"]);
    expect(report).toMatchObject({ addedTagCount: 2, removedTagCount: 1, pendingTagCount: 0 });
  });

  it("matches tags with no regard to case, as BGG does", async () => {
    const parlour = await addCollection("parlour");
    await addTaggedGames(parlour.id, [13]);
    const tagsOnBgg = { 13: ["collection:-PARLOUR"], 266192: ["COLLECTION:-parlour"] };

    const audit = await auditBggTags(db, tagExport(tagsOnBgg), { apply: true });
    const { bgg, tagRequests } = fakeBgg(tagsOnBgg);
    await syncBggTags(db, bgg);

    expect(audit.collections[0]).toMatchObject({ correctCount: 1, missingCount: 0, staleCount: 1 });
    expect(audit.otherTags).toEqual([]);
    expect(tagRequests).toEqual(["remove 266192"]);
  });

  it("with apply, drops pending changes that BGG already shows as done", async () => {
    const parlour = await addCollection("parlour");
    await addTaggedGames(parlour.id, [13]);
    await db.update(collectionGames).set({ bggTaggedAt: null });
    await db.insert(bggTagRemovals).values({ bggTag: "Collection:-parlour", bggId: 822 });
    const tagsOnBgg = { 13: ["Collection:-parlour"] };

    const audit = await auditBggTags(db, tagExport(tagsOnBgg), { apply: true });
    const { bgg, tagRequests } = fakeBgg(tagsOnBgg);
    const [report] = await syncBggTags(db, bgg);

    expect(audit.collections[0]).toMatchObject({ correctCount: 1, correctedStateCount: 2 });
    expect(tagRequests).toEqual([]);
    expect(report).toMatchObject({ pendingTagCount: 0 });
  });
});
