import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BggClient } from "../bgg/client";
import { createDatabase } from "../db/client";
import { collectionGames, collections, gameNames, games, unmatchedNames } from "../db/schema";
import { testDatabaseUrl } from "../test/database";
import { applyNameDecisions, listPendingNames } from "./review-unmatched-names";

const db = createDatabase(testDatabaseUrl());

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ${collectionGames}, ${collections}, ${gameNames}, ${games}, ${unmatchedNames} RESTART IDENTITY`,
  );
});

/** A BGG client whose thing API knows only these items. */
function fakeBgg(items: { bggId: number; name: string; type?: string }[]) {
  const requestedIds: number[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const ids = (url.searchParams.get("id") ?? "").split(",").map(Number);
    requestedIds.push(...ids);
    const xml = items
      .filter((item) => ids.includes(item.bggId))
      .map(
        (item) => `
          <item type="${item.type ?? "boardgame"}" id="${item.bggId}">
            <name type="primary" sortindex="1" value="${item.name}"/>
            <description>About ${item.name}.</description>
            <minplayers value="2"/>
          </item>`,
      )
      .join("");
    return new Response(`<items>${xml}</items>`);
  };
  const bgg = new BggClient({
    apiToken: "test-token",
    fetch: fakeFetch as typeof fetch,
    sleep: async () => {},
    minRequestGapMs: 0,
  });
  return { bgg, requestedIds };
}

async function addGame(name: string, bggId: number) {
  const [game] = await db.insert(games).values({ name, bggId }).returning();
  if (!game) throw new Error("Could not add the game.");
  await db.insert(gameNames).values({ gameId: game.id, name });
  return game;
}

async function namesOf(bggId: number) {
  const rows = await db
    .select({ name: gameNames.name })
    .from(gameNames)
    .innerJoin(games, eq(games.id, gameNames.gameId))
    .where(eq(games.bggId, bggId))
    .orderBy(asc(gameNames.name));
  return rows.map((row) => row.name);
}

describe("reviewing unmatched names", () => {
  it("lists only pending names", async () => {
    await db
      .insert(unmatchedNames)
      .values([
        { name: "Mystery Game" },
        { name: "Deck of Cards", status: "ignored" },
        { name: "Another Mystery" },
      ]);

    expect(await listPendingNames(db)).toEqual(["Another Mystery", "Mystery Game"]);
  });

  it("adds a matched name to a game that is already in the database", async () => {
    await addGame("Bananagrams", 27225);
    await db.insert(unmatchedNames).values({ name: "Bananagrams - Braille" });
    const { bgg, requestedIds } = fakeBgg([]);

    const results = await applyNameDecisions(db, bgg, [
      { name: "Bananagrams - Braille", bggId: 27225 },
    ]);

    expect(results).toEqual([
      { name: "Bananagrams - Braille", outcome: "matched", detail: "Bananagrams (27225)" },
    ]);
    expect(await namesOf(27225)).toEqual(["Bananagrams", "Bananagrams - Braille"]);
    expect(await listPendingNames(db)).toEqual([]);
    expect(requestedIds).toEqual([]);
  });

  it("saves a new game with its BGG details before it adds the name", async () => {
    await db.insert(unmatchedNames).values({ name: "Trickarus (English edition)" });
    const { bgg } = fakeBgg([{ bggId: 401234, name: "Trickarus" }]);

    const [result] = await applyNameDecisions(db, bgg, [
      { name: "Trickarus (English edition)", bggId: 401234 },
    ]);

    expect(result?.outcome).toBe("matched");
    const [game] = await db.select().from(games).where(eq(games.bggId, 401234));
    expect(game).toMatchObject({
      name: "Trickarus",
      description: "About Trickarus.",
      minPlayers: 2,
    });
    expect(await namesOf(401234)).toEqual(["Trickarus", "Trickarus (English edition)"]);
  });

  it("marks a name that is not a game as ignored", async () => {
    await db.insert(unmatchedNames).values({ name: "That Old Wallpaper - Social Media Contest" });
    const { bgg } = fakeBgg([]);

    const [result] = await applyNameDecisions(db, bgg, [
      { name: "THAT OLD WALLPAPER - SOCIAL MEDIA CONTEST", ignore: true },
    ]);

    expect(result?.outcome).toBe("ignored");
    const rows = await db.select({ status: unmatchedNames.status }).from(unmatchedNames);
    expect(rows).toEqual([{ status: "ignored" }]);
  });

  it("refuses an accessory, because collections leave accessories out", async () => {
    await db.insert(unmatchedNames).values({ name: "Spice Road Playmat" });
    const { bgg } = fakeBgg([
      { bggId: 225260, name: "Century: Spice Road – Playmat", type: "boardgameaccessory" },
    ]);

    const [result] = await applyNameDecisions(db, bgg, [
      { name: "Spice Road Playmat", bggId: 225260 },
    ]);

    expect(result).toMatchObject({ outcome: "skipped" });
    expect(await db.select().from(games)).toEqual([]);
    expect(await listPendingNames(db)).toEqual(["Spice Road Playmat"]);
  });

  it("refuses a name that already belongs to another game", async () => {
    await addGame("Akropolis", 357563);
    await addGame("Akropolis (1993)", 16108);
    await db.insert(unmatchedNames).values({ name: "akropolis!" });
    const { bgg } = fakeBgg([]);

    const [result] = await applyNameDecisions(db, bgg, [{ name: "akropolis!", bggId: 16108 }]);

    expect(result).toMatchObject({ outcome: "skipped" });
    expect(await namesOf(16108)).toEqual(["Akropolis (1993)"]);
    expect(await listPendingNames(db)).toEqual(["akropolis!"]);
  });

  it("saves nothing in a dry run", async () => {
    await db.insert(unmatchedNames).values({ name: "Trickarus (English edition)" });
    const { bgg } = fakeBgg([{ bggId: 401234, name: "Trickarus" }]);

    const [result] = await applyNameDecisions(
      db,
      bgg,
      [{ name: "Trickarus (English edition)", bggId: 401234 }],
      { dryRun: true },
    );

    expect(result?.outcome).toBe("matched");
    expect(await db.select().from(games)).toEqual([]);
    expect(await listPendingNames(db)).toEqual(["Trickarus (English edition)"]);
  });
});
