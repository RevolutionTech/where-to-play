// A fake BGG XML API for E2E tests. The API server sends its BGG requests here, so tests do not
// depend on the real BGG, its rate limits, or an API token.
// Run it with `node fake-bgg.ts <port>`. It imports nothing from the project, so Node can run it
// without a build step.
import { createServer } from "node:http";

type FakeGame = {
  bggId: number;
  name: string;
  yearPublished: number;
  isExpansion?: boolean;
  families?: string[];
};

// Games with a bggId from server/src/db/seed.ts get their collections from the E2E database.
const catalog: FakeGame[] = [
  {
    bggId: 13,
    name: "Catan",
    yearPublished: 1995,
    families: ["Animals: Sheep", "Digital Implementations: Board Game Arena"],
  },
  { bggId: 325, name: "Catan: Seafarers", yearPublished: 1997, isExpansion: true },
  { bggId: 2807, name: "Catan Junior", yearPublished: 2011 },
];

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) throw new Error("Usage: node fake-bgg.ts <port>");
const baseUrl = `http://localhost:${port}`;

function searchXml(query: string) {
  const matches = catalog.filter((game) => game.name.toLowerCase().includes(query.toLowerCase()));
  const item = (game: FakeGame, type: string) =>
    `<item type="${type}" id="${game.bggId}"><name type="primary" value="${game.name}"/><yearpublished value="${game.yearPublished}"/></item>`;
  // Like the real BGG, list each expansion as a board game and again as an expansion.
  const items = [
    ...matches.map((game) => item(game, "boardgame")),
    ...matches.filter((game) => game.isExpansion).map((game) => item(game, "boardgameexpansion")),
  ];
  return `<items total="${items.length}">${items.join("")}</items>`;
}

function thingXml(bggIds: number[]) {
  const items = catalog
    .filter((game) => bggIds.includes(game.bggId))
    .map(
      (game) => `
        <item type="${game.isExpansion ? "boardgameexpansion" : "boardgame"}" id="${game.bggId}">
          <thumbnail>${baseUrl}/images/${game.bggId}.svg</thumbnail>
          <image>${baseUrl}/images/${game.bggId}.svg</image>
          <name type="primary" sortindex="1" value="${game.name}"/>
          <description>A fake description of ${game.name}.</description>
          <yearpublished value="${game.yearPublished}"/>
          <minplayers value="2"/>
          <maxplayers value="4"/>
          <minplaytime value="30"/>
          <maxplaytime value="60"/>
          ${(game.families ?? [])
            .map(
              (family, index) =>
                `<link type="boardgamefamily" id="${index + 1}" value="${family}"/>`,
            )
            .join("")}
          <statistics page="1"><ratings>
            <average value="7.5"/>
            <ranks><rank type="subtype" id="1" name="boardgame" value="100"/></ranks>
          </ratings></statistics>
        </item>`,
    );
  return `<items>${items.join("")}</items>`;
}

const placeholderImage =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#ccc"/></svg>';

createServer((request, response) => {
  const url = new URL(request.url ?? "/", baseUrl);
  if (url.pathname === "/xmlapi2/search") {
    response.writeHead(200, { "Content-Type": "text/xml" });
    response.end(searchXml(url.searchParams.get("query") ?? ""));
  } else if (url.pathname === "/xmlapi2/thing") {
    response.writeHead(200, { "Content-Type": "text/xml" });
    response.end(thingXml((url.searchParams.get("id") ?? "").split(",").map(Number)));
  } else if (url.pathname.startsWith("/images/")) {
    response.writeHead(200, { "Content-Type": "image/svg+xml" });
    response.end(placeholderImage);
  } else {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end(`The fake BGG has no response for ${url.pathname}.`);
  }
}).listen(port, () => {
  console.log(`Fake BGG listening on ${baseUrl}`);
});
