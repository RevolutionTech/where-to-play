import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BggClient } from "../bgg/client";
import { createDatabase } from "../db/client";
import {
  collectionGames,
  collections,
  gameNames,
  games,
  type SourceConfigByKind,
  unmatchedNames,
} from "../db/schema";
import { testDatabaseUrl } from "../test/database";
import { importCollections } from "./import-collections";

const db = createDatabase(testDatabaseUrl());

afterAll(async () => {
  await db.$client.end();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE ${collectionGames}, ${collections}, ${gameNames}, ${games}, ${unmatchedNames} RESTART IDENTITY`,
  );
});

type Route = (url: URL, init: RequestInit) => Response | undefined;

/** A fetch that answers from routes, and records each request. */
function fakeWeb(...routes: Route[]) {
  const requests: { method: string; url: URL; headers: Headers; body: string }[] = [];
  const fakeFetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    requests.push({
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      body: String(init.body ?? ""),
    });
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`No fake response for ${init.method ?? "GET"} ${url}`);
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

function importWith(web: ReturnType<typeof fakeWeb>, options = {}) {
  const sleep = async () => {};
  const bgg = new BggClient({
    apiToken: "test-token",
    credentials: { username: "importer", password: "secret" },
    fetch: web.fetch,
    sleep,
    minRequestGapMs: 0,
  });
  return importCollections(
    db,
    { fetch: web.fetch, sleep, bgg, googleSheetsApiKey: "test-key" },
    options,
  );
}

const bggLogin: Route = (url) =>
  url.pathname === "/login/api/v1"
    ? new Response(null, { status: 204, headers: { "Set-Cookie": "SessionID=abc; Path=/" } })
    : undefined;

const bggAddTag: Route = (url, init) =>
  url.pathname === "/api/tags" && init.method === "POST" ? Response.json({}) : undefined;

type FakeCollectionItem = { bggId: number; name: string; minPlayers?: number; rank?: number };

function bggCollection(username: string, items: FakeCollectionItem[]): Route {
  return (url) =>
    url.pathname === "/xmlapi2/collection" && url.searchParams.get("username") === username
      ? new Response(
          `<items>${items
            .map(
              (item) => `
                <item objecttype="thing" objectid="${item.bggId}" subtype="boardgame">
                  <name sortindex="1">${item.name}</name>
                  <yearpublished>1995</yearpublished>
                  <stats minplayers="${item.minPlayers ?? 2}" maxplayers="4" minplaytime="60" maxplaytime="90">
                    <rating value="N/A">
                      <average value="7.25"/>
                      <ranks><rank type="subtype" id="1" name="boardgame" value="${item.rank ?? "Not Ranked"}"/></ranks>
                    </rating>
                  </stats>
                </item>`,
            )
            .join("")}</items>`,
        )
      : undefined;
}

function bggSearch(query: string, bggId: number | null): Route {
  return (url) =>
    url.pathname === "/xmlapi2/search" && url.searchParams.get("query") === query
      ? new Response(
          bggId === null
            ? `<items total="0"></items>`
            : `<items total="1"><item type="boardgame" id="${bggId}"><name type="primary" value="${query}"/></item></items>`,
        )
      : undefined;
}

type FakeThing = {
  bggId: number;
  name: string;
  alternateNames?: string[];
  minPlayers?: number;
  isAccessory?: boolean;
};

function bggThings(...things: FakeThing[]): Route {
  return (url) => {
    if (url.pathname !== "/xmlapi2/thing") return undefined;
    const ids = (url.searchParams.get("id") ?? "").split(",").map(Number);
    const items = things
      .filter((thing) => ids.includes(thing.bggId))
      .map(
        (thing) => `
          <item type="${thing.isAccessory ? "boardgameaccessory" : "boardgame"}" id="${thing.bggId}">
            <name type="primary" sortindex="1" value="${thing.name}"/>
            ${(thing.alternateNames ?? []).map((name) => `<name type="alternate" sortindex="1" value="${name}"/>`).join("")}
            <description>A game about &amp;quot;${thing.name}&amp;quot;.</description>
            <yearpublished value="2000"/>
            <minplayers value="${thing.minPlayers ?? 2}"/>
            <maxplayers value="4"/>
            <minplaytime value="30"/>
            <maxplaytime value="60"/>
            <statistics page="1"><ratings>
              <average value="7.5"/>
              <ranks><rank type="subtype" id="1" name="boardgame" value="100"/></ranks>
            </ratings></statistics>
          </item>`,
      );
    return new Response(`<items>${items.join("")}</items>`);
  };
}

function googleSheet(spreadsheetId: string, rows: string[][]): Route {
  return (url) =>
    url.hostname === "sheets.googleapis.com" && url.pathname.includes(`/${spreadsheetId}/`)
      ? Response.json({ values: rows })
      : undefined;
}

function webPage(pageUrl: string, html: string): Route {
  return (url) => (url.href === pageUrl ? new Response(html) : undefined);
}

async function addCollection<Kind extends keyof SourceConfigByKind>(
  slug: string,
  sourceKind: Kind,
  sourceConfig: SourceConfigByKind[Kind],
) {
  const [collection] = await db
    .insert(collections)
    .values({
      slug,
      name: slug,
      kind: "cafe",
      bggTag: `Collection:-${slug}`,
      sourceKind,
      sourceConfig,
    })
    .returning();
  if (!collection) throw new Error("Could not add the collection.");
  return collection;
}

async function addGame(name: string, bggId: number | null, otherNames: string[] = []) {
  const [game] = await db.insert(games).values({ name, bggId }).returning();
  if (!game) throw new Error("Could not add the game.");
  await db
    .insert(gameNames)
    .values([name, ...otherNames].map((n) => ({ gameId: game.id, name: n })));
  return game;
}

async function gamesIn(slug: string) {
  const rows = await db
    .select({ name: games.name })
    .from(collectionGames)
    .innerJoin(games, eq(games.id, collectionGames.gameId))
    .innerJoin(collections, eq(collections.id, collectionGames.collectionId))
    .where(eq(collections.slug, slug))
    .orderBy(asc(games.name));
  return rows.map((row) => row.name);
}

describe("importing a BGG collection", () => {
  it("adds new games with their BGG details and tags them on BGG", async () => {
    await addCollection("parlour", "bgg_collection", { username: "parlour-bgg" });
    let collectionRequestCount = 0;
    const web = fakeWeb(
      // BGG answers 202 while it prepares a collection.
      (url) => {
        if (url.pathname !== "/xmlapi2/collection") return undefined;
        collectionRequestCount++;
        return collectionRequestCount === 1 ? new Response("", { status: 202 }) : undefined;
      },
      bggCollection("parlour-bgg", [
        { bggId: 13, name: "Catan" },
        { bggId: 822, name: "Carcassonne" },
      ]),
      bggThings(
        { bggId: 13, name: "Catan", alternateNames: ["Die Siedler von Catan"], minPlayers: 3 },
        { bggId: 822, name: "Carcassonne" },
      ),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", addedGameCount: 2, newGameCount: 2 });
    expect(await gamesIn("parlour")).toEqual(["Carcassonne", "Catan"]);
    const [catan] = await db.select().from(games).where(eq(games.bggId, 13));
    expect(catan).toMatchObject({
      description: 'A game about "Catan".',
      minPlayers: 3,
      bggRating: 7.5,
      bggRank: 100,
    });
    const catanNames = await db
      .select({ name: gameNames.name })
      .from(gameNames)
      .where(eq(gameNames.gameId, catan?.id ?? 0));
    expect(catanNames.map((row) => row.name).sort()).toEqual(["Catan", "Die Siedler von Catan"]);

    const tagRequests = web.requests.filter((request) => request.url.pathname === "/api/tags");
    expect(tagRequests.map((request) => JSON.parse(request.body))).toEqual([
      { newtags: "Collection:-parlour", objecttype: "thing", objectid: expect.any(Number) },
      { newtags: "Collection:-parlour", objecttype: "thing", objectid: expect.any(Number) },
    ]);
    expect(tagRequests.map((request) => JSON.parse(request.body).objectid).sort()).toEqual([
      13, 822,
    ]);
    expect(tagRequests.every((request) => request.headers.get("Cookie") === "SessionID=abc")).toBe(
      true,
    );
  });

  it("removes a game that left the source, and removes its BGG tag", async () => {
    const collection = await addCollection("parlour", "bgg_collection", {
      username: "parlour-bgg",
    });
    const catan = await addGame("Catan", 13);
    const azul = await addGame("Azul", 230802);
    await db.insert(collectionGames).values([
      { collectionId: collection.id, gameId: catan.id },
      { collectionId: collection.id, gameId: azul.id },
    ]);
    const web = fakeWeb(
      bggCollection("parlour-bgg", [{ bggId: 13, name: "Catan" }]),
      bggLogin,
      (url, init) =>
        url.pathname === "/api/tags" && init.method === undefined
          ? Response.json({
              mytags: [
                { rawtag: "Collection:-other", pinid: 54 },
                { rawtag: "Collection:-parlour", pinid: 55 },
              ],
            })
          : undefined,
      (url, init) =>
        url.pathname === "/api/pins/55" && init.method === "DELETE" ? Response.json({}) : undefined,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", addedGameCount: 0, removedGameCount: 1 });
    expect(await gamesIn("parlour")).toEqual(["Catan"]);
    const tagLookup = web.requests.find((request) => request.url.pathname === "/api/tags");
    expect(tagLookup?.url.searchParams.get("objectid")).toBe("230802");
    expect(web.requests.some((request) => request.url.pathname === "/api/pins/55")).toBe(true);
  });

  it("updates details of known games from the collection's stats, with no thing request", async () => {
    await addCollection("parlour", "bgg_collection", { username: "parlour-bgg" });
    const catan = await addGame("Catan", 13);
    const web = fakeWeb(
      bggCollection("parlour-bgg", [{ bggId: 13, name: "Catan", minPlayers: 3, rank: 575 }]),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", refreshedGameCount: 1 });
    const [refreshed] = await db.select().from(games).where(eq(games.id, catan.id));
    expect(refreshed).toMatchObject({
      name: "Catan",
      yearPublished: 1995,
      minPlayers: 3,
      maxPlayers: 4,
      minPlaytimeMinutes: 60,
      maxPlaytimeMinutes: 90,
      bggRating: 7.25,
      bggRank: 575,
    });
    expect(web.requests.some((request) => request.url.pathname === "/xmlapi2/thing")).toBe(false);
  });
});

describe("importing a Google Sheet", () => {
  it("resolves names from the database, from a BGG search, or records them as unmatched", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    await addGame("Catan", 13, ["The Settlers of Catan"]);
    await db.insert(unmatchedNames).values({ name: "Deck of Cards", status: "ignored" });
    const web = fakeWeb(
      googleSheet("sheet-1", [
        ["Game"],
        ["the settlers of catan!"],
        ["Wingspan"],
        ["Mystery Game"],
        ["deck of cards"],
        [""],
      ]),
      bggSearch("Wingspan", 266192),
      bggSearch("Mystery Game", null),
      bggSearch("mystery game", null),
      bggThings({ bggId: 266192, name: "Wingspan" }),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", unmatchedNames: ["Mystery Game"] });
    expect(await gamesIn("gamescape")).toEqual(["Catan", "Wingspan"]);
    const searchedNames = web.requests
      .filter((request) => request.url.pathname === "/xmlapi2/search")
      .map((request) => request.url.searchParams.get("query"));
    expect(searchedNames).toEqual(["Wingspan", "Mystery Game", "mystery game"]);
    const unmatched = await db
      .select({ name: unmatchedNames.name, status: unmatchedNames.status })
      .from(unmatchedNames)
      .orderBy(asc(unmatchedNames.name));
    expect(unmatched).toEqual([
      { name: "Deck of Cards", status: "ignored" },
      { name: "Mystery Game", status: "pending" },
    ]);
  });

  it("stores a searched name, so the next import finds it without a BGG search", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    const sheet = googleSheet("sheet-1", [["Game"], ["Wingspan (2nd printing)"]]);
    await importWith(
      fakeWeb(
        sheet,
        bggSearch("Wingspan (2nd printing)", 266192),
        bggThings({ bggId: 266192, name: "Wingspan" }),
        bggLogin,
        bggAddTag,
      ),
    );

    const secondImport = fakeWeb(sheet);
    const [report] = await importWith(secondImport);

    expect(report).toMatchObject({ outcome: "imported", addedGameCount: 0 });
    expect(await gamesIn("gamescape")).toEqual(["Wingspan"]);
    expect(secondImport.requests.map((request) => request.url.hostname)).toEqual([
      "sheets.googleapis.com",
    ]);
  });

  it("matches names that leave out apostrophes or use spaces for other punctuation", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    await addGame("Aeon's End", 191189);
    await addGame("Ticket to Ride", 9209);
    await addGame("Dominion", 36218, ["Deck-Building Game"]);
    const web = fakeWeb(
      googleSheet("sheet-1", [
        ["Game"],
        ["Aeons End"],
        ["Deck Building Game"],
        ["Ticket-to-Ride"],
        ["Tickettoride"],
      ]),
      bggSearch("Tickettoride", null),
      bggSearch("tickettoride", null),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(await gamesIn("gamescape")).toEqual(["Aeon's End", "Dominion", "Ticket to Ride"]);
    expect(report?.unmatchedNames).toEqual(["Tickettoride"]);
  });

  it("deletes a pending unmatched name once a game has that name", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    await db.insert(unmatchedNames).values({ name: "Mystery Game" });
    await addGame("Mystery Game Deluxe", null, ["Mystery Game"]);

    await importWith(fakeWeb(googleSheet("sheet-1", [["Game"], ["Mystery Game"]]), bggLogin));

    expect(await db.select().from(unmatchedNames)).toEqual([]);
    expect(await gamesIn("gamescape")).toEqual(["Mystery Game Deluxe"]);
  });
});

describe("importing a web page", () => {
  it("follows the scraper rules to find game names", async () => {
    await addCollection("guildhouse", "web_page", {
      url: "https://example.com/games",
      scraperRules: [
        { element: "table", attributes: { class: "waffle" } },
        { element: "tr" },
        { element: "td", attributes: { class: ["s2", "s6"] } },
      ],
    });
    await addGame("Catan", 13);
    await addGame("Azul", 230802);
    await addGame("Splendor", 148228);
    const html = `
      <table class="other"><tr><td class="s2">Splendor</td></tr></table>
      <table class="grid waffle"><tbody>
        <tr><td class="s1">Header</td></tr>
        <tr><td class="s2">  Catan </td><td class="s3">Not a game</td></tr>
        <tr><td class="x s6">Azul</td></tr>
      </tbody></table>`;

    const [report] = await importWith(
      fakeWeb(webPage("https://example.com/games", html), bggLogin, bggAddTag),
    );

    expect(report).toMatchObject({ outcome: "imported", sourceGameCount: 2 });
    expect(await gamesIn("guildhouse")).toEqual(["Azul", "Catan"]);
  });
});

describe("importing a Tabletop.Events library", () => {
  it("reads every page, and uses the BGG ID when the library has one", async () => {
    await addCollection("kublacon", "tabletop_events", {
      username: "kublacon-library",
      libraryId: "LIB-1",
    });
    await addGame("Azul", 230802);
    const web = fakeWeb(
      (url) => {
        if (url.hostname !== "tabletop.events") return undefined;
        const page = Number(url.searchParams.get("_page_number"));
        const items =
          page === 1 ? [{ name: "Catan: Base Game", bgg_id: 13 }] : [{ name: "Azul", bgg_id: 0 }];
        return Response.json({
          result: { items, paging: { next_page_number: page + 1, total_pages: 2 } },
        });
      },
      bggThings({ bggId: 13, name: "Catan" }),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", sourceGameCount: 2 });
    expect(await gamesIn("kublacon")).toEqual(["Azul", "Catan"]);
    expect(web.requests.some((request) => request.url.pathname === "/xmlapi2/search")).toBe(false);
  });

  it("leaves out accessories, and reports BGG IDs that BGG does not know", async () => {
    await addCollection("kublacon", "tabletop_events", {
      username: "kublacon-library",
      libraryId: "LIB-1",
    });
    const web = fakeWeb(
      (url) =>
        url.hostname === "tabletop.events"
          ? Response.json({
              result: {
                items: [
                  { name: "Catan", bgg_id: 13 },
                  { name: "Century: Spice Road Playmat", bgg_id: 225260 },
                  { name: "City Tycoon", bgg_id: 1044994 },
                ],
                paging: { next_page_number: 2, total_pages: 1 },
              },
            })
          : undefined,
      bggThings(
        { bggId: 13, name: "Catan" },
        { bggId: 225260, name: "Century: Spice Road – Playmat", isAccessory: true },
      ),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", unknownBggIds: [1044994] });
    expect(await gamesIn("kublacon")).toEqual(["Catan"]);
    expect(await db.select({ bggId: games.bggId }).from(games)).toEqual([{ bggId: 13 }]);
  });
});

describe("importing a Cardboard Connect library", () => {
  function cardboardConnect(
    instanceId: string,
    pages: { total: number; collection: { name: string; bgg: number }[] }[],
  ): Route {
    return (url, init) => {
      if (url.hostname !== "api.cardboardconnect.com") return undefined;
      if (new Headers(init.headers).get("cbc-instance") !== instanceId) {
        return Response.json({ status: 0, data: [] });
      }
      const page = pages[Number(url.searchParams.get("page")) - 1];
      return Response.json({ status: 1, data: page ?? { total: 0, collection: [] } });
    };
  }

  it("reads every page, and uses the BGG ID when the library has one", async () => {
    await addCollection("ragecon", "cardboard_connect", { instanceId: "inst-1" });
    await addGame("Azul", 230802);
    const web = fakeWeb(
      cardboardConnect("inst-1", [
        { total: 2, collection: [{ name: "Catan: Base Game", bgg: 13 }] },
        { total: 2, collection: [{ name: " Azul ", bgg: 0 }] },
      ]),
      bggThings({ bggId: 13, name: "Catan" }),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", sourceGameCount: 2 });
    expect(await gamesIn("ragecon")).toEqual(["Azul", "Catan"]);
    expect(web.requests.some((request) => request.url.pathname === "/xmlapi2/search")).toBe(false);
  });

  it("fails, and keeps the collection's games, when the library refuses the request", async () => {
    const collection = await addCollection("ragecon", "cardboard_connect", {
      instanceId: "inst-1",
    });
    const azul = await addGame("Azul", 230802);
    await db.insert(collectionGames).values({ collectionId: collection.id, gameId: azul.id });
    const web = fakeWeb(cardboardConnect("other-instance", []));

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "failed", reason: expect.stringContaining("status") });
    expect(await gamesIn("ragecon")).toEqual(["Azul"]);
  });
});

describe("importing an Airtable shared page", () => {
  const accessPolicy = JSON.stringify({ shareId: "shrPage1", signature: "signed" });

  function airtableSharedPage(tables: { tableId: string; names: string[] }[]): Route[] {
    const page: Route = (url) =>
      url.href === "https://airtable.com/embed/appBase1/shrPage1"
        ? new Response(
            `<script>initData = {"sharedPageId":"pagPage1","accessPolicy":${JSON.stringify(accessPolicy)}}</script>`,
          )
        : undefined;
    const pageData: Route = (url, init) => {
      if (url.pathname !== "/v0.3/application/appBase1/readForSharedPages") return undefined;
      if (
        url.searchParams.get("accessPolicy") !== accessPolicy ||
        new Headers(init.headers).get("x-airtable-application-id") !== "appBase1"
      ) {
        return Response.json({ error: { type: "INVALID_REQUEST" } }, { status: 422 });
      }
      return Response.json({
        data: {
          tableSchemas: tables.map(({ tableId }) => ({
            id: tableId,
            primaryColumnId: `fldName${tableId}`,
          })),
          preloadPageQueryResults: {
            querySlices: tables.map(({ tableId, names }) => ({
              tableId,
              rowIds: names.map((_, index) => `rec${tableId}${index}`),
            })),
            tableDataById: Object.fromEntries(
              tables.map(({ tableId, names }) => [
                tableId,
                {
                  partialRowById: Object.fromEntries(
                    names.map((name, index) => [
                      `rec${tableId}${index}`,
                      {
                        cellValuesByColumnId: {
                          [`fldName${tableId}`]: name,
                          fldFirstLetter: name[0],
                        },
                      },
                    ]),
                  ),
                },
              ]),
            ),
          },
        },
      });
    };
    return [page, pageData];
  }

  it("reads the name column of each table on the page", async () => {
    await addCollection("dogpatch", "airtable_shared_page", {
      url: "https://airtable.com/appBase1/shrPage1",
    });
    await addGame("Azul", 230802);
    await addGame("Catan", 13);
    await addGame("Wingspan", 266192);
    const web = fakeWeb(
      ...airtableSharedPage([
        { tableId: "tblGames", names: ["Azul", "Catan"] },
        { tableId: "tblNewArrivals", names: ["Wingspan"] },
      ]),
      bggThings(),
      bggLogin,
      bggAddTag,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "imported", sourceGameCount: 3 });
    expect(await gamesIn("dogpatch")).toEqual(["Azul", "Catan", "Wingspan"]);
  });

  it("fails, and keeps the collection's games, when the link is not a shared page", async () => {
    const collection = await addCollection("dogpatch", "airtable_shared_page", {
      url: "https://airtable.com/appBase1/shrPage1",
    });
    const azul = await addGame("Azul", 230802);
    await db.insert(collectionGames).values({ collectionId: collection.id, gameId: azul.id });
    const web = fakeWeb((url) =>
      url.hostname === "airtable.com" ? new Response("<html>Sign in</html>") : undefined,
    );

    const [report] = await importWith(web);

    expect(report).toMatchObject({ outcome: "failed", reason: expect.stringContaining("shared") });
    expect(await gamesIn("dogpatch")).toEqual(["Azul"]);
  });
});

describe("reporting a failed source", () => {
  it("leaves the API key out of the reason, because workflow logs are public", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    const web = fakeWeb((url) => {
      if (url.hostname !== "sheets.googleapis.com") return undefined;
      const response = new Response("The caller does not have permission", { status: 403 });
      Object.defineProperty(response, "url", { value: url.href });
      return response;
    });

    const [report] = await importWith(web);

    expect(report?.outcome).toBe("failed");
    expect(report?.reason).toContain("403");
    expect(report?.reason).not.toContain("test-key");
  });
});

describe("protecting collections from broken sources", () => {
  async function addCollectionWithGames(slug: string, pageUrl: string, gameCount: number) {
    const collection = await addCollection(slug, "web_page", {
      url: pageUrl,
      scraperRules: [{ element: "li" }],
    });
    for (let index = 1; index <= gameCount; index++) {
      const game = await addGame(`${slug} game ${index}`, null);
      await db.insert(collectionGames).values({ collectionId: collection.id, gameId: game.id });
    }
  }

  it("skips a collection whose source lost more than half of its games", async () => {
    await addCollectionWithGames("broken", "https://example.com/broken", 3);
    const web = fakeWeb(webPage("https://example.com/broken", "<ul><li>broken game 1</li></ul>"));

    const [report] = await importWith(web);

    expect(report?.outcome).toBe("skipped");
    expect(await gamesIn("broken")).toHaveLength(3);
  });

  it("imports a collection whose source shrank, when forced", async () => {
    await addCollectionWithGames("broken", "https://example.com/broken", 3);
    const web = fakeWeb(webPage("https://example.com/broken", "<ul><li>broken game 1</li></ul>"));

    const [report] = await importWith(web, { force: true });

    expect(report?.outcome).toBe("imported");
    expect(await gamesIn("broken")).toEqual(["broken game 1"]);
  });

  it("imports the other collections when one source fails", async () => {
    await addCollection("a-down", "web_page", {
      url: "https://example.com/down",
      scraperRules: [{ element: "li" }],
    });
    await addCollection("b-up", "web_page", {
      url: "https://example.com/up",
      scraperRules: [{ element: "li" }],
    });
    await addGame("Catan", 13);
    const web = fakeWeb(
      (url) =>
        url.href === "https://example.com/down" ? new Response("", { status: 500 }) : undefined,
      webPage("https://example.com/up", "<ul><li>Catan</li></ul>"),
      bggLogin,
      bggAddTag,
    );

    const reports = await importWith(web);

    expect(reports.map((report) => [report.slug, report.outcome])).toEqual([
      ["a-down", "failed"],
      ["b-up", "imported"],
    ]);
    expect(await gamesIn("b-up")).toEqual(["Catan"]);
  });
});

describe("a dry run", () => {
  it("reports the changes, but saves nothing and changes no BGG tags", async () => {
    await addCollection("gamescape", "google_sheet", {
      url: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    });
    const web = fakeWeb(
      googleSheet("sheet-1", [["Game"], ["Wingspan"], ["Mystery Game"]]),
      bggSearch("Wingspan", 266192),
      bggSearch("Mystery Game", null),
      bggSearch("mystery game", null),
      bggThings({ bggId: 266192, name: "Wingspan" }),
    );

    const [report] = await importWith(web, { dryRun: true });

    expect(report).toMatchObject({
      outcome: "imported",
      addedGameCount: 1,
      newGameCount: 1,
      unmatchedNames: ["Mystery Game"],
    });
    expect(await db.select().from(games)).toEqual([]);
    expect(await db.select().from(unmatchedNames)).toEqual([]);
    expect(web.requests.some((request) => request.url.pathname.startsWith("/api/"))).toBe(false);
  });
});
