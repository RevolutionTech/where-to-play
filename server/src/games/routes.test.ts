import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { BggClient } from "../bgg/client";
import { createDatabase } from "../db/client";
import { collectionGames, collections, gameNames, games } from "../db/schema";
import { testDatabaseUrl } from "../test/database";

const db = createDatabase(testDatabaseUrl());

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ${collectionGames}, ${collections}, ${gameNames}, ${games} RESTART IDENTITY`,
  );
});

type FakeBggGame = {
  bggId: number;
  name: string;
  yearPublished?: number;
  isExpansion?: boolean;
};

/** A BGG that knows the given games. Its search matches names that contain the query. */
function fakeBgg(catalog: FakeBggGame[], options: { down?: boolean } = {}) {
  const requests: URL[] = [];
  const fakeFetch = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requests.push(url);
    if (options.down) return new Response("Service Unavailable", { status: 503 });

    if (url.pathname === "/xmlapi2/search") {
      const query = (url.searchParams.get("query") ?? "").toLowerCase();
      const matches = catalog.filter((game) => game.name.toLowerCase().includes(query));
      const item = (game: FakeBggGame, type: string) => `
        <item type="${type}" id="${game.bggId}">
          <name type="primary" value="${game.name}"/>
          ${game.yearPublished ? `<yearpublished value="${game.yearPublished}"/>` : ""}
        </item>`;
      // Like the real BGG, list each expansion as a board game and again as an expansion.
      const items = [
        ...matches.map((game) => item(game, "boardgame")),
        ...matches
          .filter((game) => game.isExpansion)
          .map((game) => item(game, "boardgameexpansion")),
      ];
      return new Response(`<items total="${items.length}">${items.join("")}</items>`);
    }

    if (url.pathname === "/xmlapi2/thing") {
      const ids = (url.searchParams.get("id") ?? "").split(",").map(Number);
      const items = catalog
        .filter((game) => ids.includes(game.bggId))
        .map(
          (game) => `
            <item type="${game.isExpansion ? "boardgameexpansion" : "boardgame"}" id="${game.bggId}">
              <thumbnail>https://cf.geekdo-images.com/${game.bggId}-thumb.jpg</thumbnail>
              <image>https://cf.geekdo-images.com/${game.bggId}.jpg</image>
              <name type="primary" sortindex="1" value="${game.name}"/>
              <description>Trade &amp;amp; build.&amp;#10;Win.</description>
              <yearpublished value="${game.yearPublished ?? 0}"/>
              <minplayers value="3"/>
              <maxplayers value="4"/>
              <minplaytime value="60"/>
              <maxplaytime value="120"/>
              <statistics page="1"><ratings>
                <average value="7.1"/>
                <ranks><rank type="subtype" id="1" name="boardgame" value="575"/></ranks>
              </ratings></statistics>
            </item>`,
        );
      return new Response(`<items>${items.join("")}</items>`);
    }

    throw new Error(`No fake response for ${url}`);
  };

  const bgg = new BggClient({
    apiToken: "test-token",
    fetch: fakeFetch as typeof fetch,
    sleep: async () => {},
    minRequestGapMs: 0,
    maxRetries: 0,
  });
  return { bgg, requests };
}

type SearchBody = {
  total: number;
  page: number;
  results: { bggId: number; name: string }[];
};

async function searchBody(response: Response) {
  return (await response.json()) as SearchBody;
}

async function addCollection(
  name: string,
  options: { isPrivate?: boolean; websiteUrl?: string; location?: string } = {},
) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  const [collection] = await db
    .insert(collections)
    .values({
      slug,
      name,
      kind: "cafe",
      isPrivate: options.isPrivate ?? false,
      websiteUrl: options.websiteUrl,
      location: options.location,
      sourceKind: "bgg_collection",
      sourceConfig: { username: slug },
    })
    .returning();
  if (!collection) throw new Error("Could not add the collection.");
  return collection;
}

async function addGame(values: typeof games.$inferInsert, ownedBy: { id: number }[] = []) {
  const [game] = await db.insert(games).values(values).returning();
  if (!game) throw new Error("Could not add the game.");
  for (const collection of ownedBy) {
    await db.insert(collectionGames).values({ collectionId: collection.id, gameId: game.id });
  }
  return game;
}

describe("GET /api/games", () => {
  it("lists matching games with thumbnails, best matches first", async () => {
    const { bgg } = fakeBgg([
      { bggId: 3, name: "Star Wars: Catan", yearPublished: 2003 },
      { bggId: 13, name: "Catan", yearPublished: 1995 },
      { bggId: 27710, name: "Catan Dice Game", yearPublished: 2007 },
      { bggId: 2807, name: "Catan Junior", yearPublished: 2011 },
    ]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=catan");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(await response.json()).toEqual({
      total: 4,
      page: 1,
      pageSize: 20,
      results: [
        {
          bggId: 13,
          name: "Catan",
          yearPublished: 1995,
          isExpansion: false,
          thumbnailUrl: "https://cf.geekdo-images.com/13-thumb.jpg",
          collectionCount: 0,
        },
        expect.objectContaining({ bggId: 2807, name: "Catan Junior" }),
        expect.objectContaining({ bggId: 27710, name: "Catan Dice Game" }),
        expect.objectContaining({ bggId: 3, name: "Star Wars: Catan" }),
      ],
    });
  });

  it("leaves out expansions unless they are asked for", async () => {
    const { bgg } = fakeBgg([
      { bggId: 13, name: "Catan", yearPublished: 1995 },
      { bggId: 325, name: "Catan: Seafarers", yearPublished: 1997, isExpansion: true },
    ]);
    const app = createApp({ db, bgg });

    const withoutExpansions = await app.request("/api/games?q=catan");
    const withExpansions = await app.request("/api/games?q=catan&expansions=true");

    expect((await searchBody(withoutExpansions)).results).toEqual([
      expect.objectContaining({ bggId: 13 }),
    ]);
    expect((await searchBody(withExpansions)).results).toEqual([
      expect.objectContaining({ bggId: 13, isExpansion: false }),
      expect.objectContaining({ bggId: 325, isExpansion: true }),
    ]);
  });

  it("counts only public collections that own each game", async () => {
    const parlour = await addCollection("The Game Parlour");
    const kublacon = await addCollection("KublaCon");
    const privateShelf = await addCollection("Private Shelf", { isPrivate: true });
    await addGame({ name: "Catan", bggId: 13 }, [parlour, kublacon, privateShelf]);
    await addGame({ name: "Catan Junior", bggId: 2807 }, [privateShelf]);
    const { bgg } = fakeBgg([
      { bggId: 13, name: "Catan", yearPublished: 1995 },
      { bggId: 2807, name: "Catan Junior", yearPublished: 2011 },
    ]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=catan");

    expect((await searchBody(response)).results).toEqual([
      expect.objectContaining({ bggId: 13, collectionCount: 2 }),
      expect.objectContaining({ bggId: 2807, collectionCount: 0 }),
    ]);
  });

  it("shows only games that a public collection owns when available is set", async () => {
    const parlour = await addCollection("The Game Parlour");
    const privateShelf = await addCollection("Private Shelf", { isPrivate: true });
    await addGame({ name: "Catan Junior", bggId: 2807 }, [parlour]);
    await addGame({ name: "Catan", bggId: 13 }, [privateShelf]);
    const { bgg } = fakeBgg([
      { bggId: 13, name: "Catan", yearPublished: 1995 },
      { bggId: 2807, name: "Catan Junior", yearPublished: 2011 },
      { bggId: 27710, name: "Catan Dice Game", yearPublished: 2007 },
    ]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=catan&available=true");

    const body = await searchBody(response);
    expect(body.total).toBe(1);
    expect(body.results).toEqual([expect.objectContaining({ bggId: 2807 })]);
  });

  it("splits results into pages of 20 and asks BGG for one page of details at a time", async () => {
    const catalog = Array.from({ length: 45 }, (_, index) => ({
      bggId: index + 1,
      name: `Dungeon ${String(index + 1).padStart(2, "0")}`,
      yearPublished: 2000,
    }));
    const { bgg, requests } = fakeBgg(catalog);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=dungeon&page=3");

    const body = await searchBody(response);
    expect(body.total).toBe(45);
    expect(body.page).toBe(3);
    expect(body.results.map((result) => result.name)).toEqual([
      "Dungeon 41",
      "Dungeon 42",
      "Dungeon 43",
      "Dungeon 44",
      "Dungeon 45",
    ]);
    const thingRequests = requests.filter((url) => url.pathname === "/xmlapi2/thing");
    expect(thingRequests.map((url) => url.searchParams.get("id"))).toEqual(["41,42,43,44,45"]);
  });

  it("rejects a request with no search text", async () => {
    const { bgg, requests } = fakeBgg([]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=%20%20");

    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
  });

  it("reports when BGG is not available", async () => {
    const { bgg } = fakeBgg([], { down: true });
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games?q=catan");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "BoardGameGeek is not available. Try again later.",
    });
  });
});

describe("GET /api/games/:bggId", () => {
  it("gives BGG details and the public collections that own the game", async () => {
    const parlour = await addCollection("The Game Parlour", {
      websiteUrl: "https://gameparlour.example",
      location: "San Francisco, CA",
    });
    const kublacon = await addCollection("KublaCon");
    const privateShelf = await addCollection("Private Shelf", { isPrivate: true });
    await addGame({ name: "Catan", bggId: 13 }, [parlour, kublacon, privateShelf]);
    const { bgg } = fakeBgg([{ bggId: 13, name: "Catan", yearPublished: 1995 }]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games/13");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      bggId: 13,
      name: "Catan",
      yearPublished: 1995,
      description: "Trade & build.\nWin.",
      minPlayers: 3,
      maxPlayers: 4,
      minPlaytimeMinutes: 60,
      maxPlaytimeMinutes: 120,
      bggRating: 7.1,
      bggRank: 575,
      imageUrl: "https://cf.geekdo-images.com/13.jpg",
      bggUrl: "https://boardgamegeek.com/boardgame/13",
      collections: [
        { slug: "kublacon", name: "KublaCon", kind: "cafe", websiteUrl: null, location: null },
        {
          slug: "the-game-parlour",
          name: "The Game Parlour",
          kind: "cafe",
          websiteUrl: "https://gameparlour.example",
          location: "San Francisco, CA",
        },
      ],
    });
  });

  it("gives an empty list of collections for a game that no collection owns", async () => {
    const { bgg } = fakeBgg([{ bggId: 822, name: "Carcassonne", yearPublished: 2000 }]);
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games/822");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ name: "Carcassonne", collections: [] }),
    );
  });

  it("uses the stored details when BGG is not available", async () => {
    const parlour = await addCollection("The Game Parlour");
    await addGame({ name: "Catan", bggId: 13, yearPublished: 1995, minPlayers: 3, maxPlayers: 4 }, [
      parlour,
    ]);
    const { bgg } = fakeBgg([], { down: true });
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games/13");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        name: "Catan",
        yearPublished: 1995,
        minPlayers: 3,
        imageUrl: null,
        collections: [expect.objectContaining({ name: "The Game Parlour" })],
      }),
    );
  });

  it("reports when BGG is not available and the game is not stored", async () => {
    const { bgg } = fakeBgg([], { down: true });
    const app = createApp({ db, bgg });

    const response = await app.request("/api/games/13");

    expect(response.status).toBe(502);
  });

  it("answers 404 for a game that BGG does not know", async () => {
    const { bgg } = fakeBgg([]);
    const app = createApp({ db, bgg });

    expect((await app.request("/api/games/999999")).status).toBe(404);
    expect((await app.request("/api/games/not-a-number")).status).toBe(404);
  });
});
