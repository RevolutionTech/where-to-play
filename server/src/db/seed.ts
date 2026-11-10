import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { collectionGames, collections, gameNames, games } from "./schema";

type SampleGame = {
  name: string;
  bggId: number | null;
  yearPublished: number | null;
  otherNames: string[];
};

const sampleGames: SampleGame[] = [
  { name: "Catan", bggId: 13, yearPublished: 1995, otherNames: ["The Settlers of Catan"] },
  { name: "Carcassonne", bggId: 822, yearPublished: 2000, otherNames: [] },
  { name: "Ticket to Ride", bggId: 9209, yearPublished: 2004, otherNames: [] },
  { name: "Pandemic", bggId: 30549, yearPublished: 2008, otherNames: [] },
  { name: "7 Wonders", bggId: 68448, yearPublished: 2010, otherNames: ["Seven Wonders"] },
  { name: "Splendor", bggId: 148228, yearPublished: 2014, otherNames: [] },
  { name: "Codenames", bggId: 178900, yearPublished: 2015, otherNames: [] },
  { name: "Terraforming Mars", bggId: 167791, yearPublished: 2016, otherNames: ["TFM"] },
  { name: "Azul", bggId: 230802, yearPublished: 2017, otherNames: [] },
  { name: "Wingspan", bggId: 266192, yearPublished: 2019, otherNames: [] },
  // A game that is not on BGG.
  { name: "Cafe House Trivia", bggId: null, yearPublished: null, otherNames: [] },
];

type SampleCollection = typeof collections.$inferInsert & { gameNames: string[] };

const sampleCollections: SampleCollection[] = [
  {
    slug: "the-game-parlour",
    name: "The Game Parlour",
    kind: "cafe",
    location: "San Francisco, CA",
    bggTag: "Collection:-The-Game-Parlour",
    sourceKind: "bgg_collection",
    sourceConfig: { username: "Thegameparlour" },
    gameNames: ["Catan", "Carcassonne", "Ticket to Ride", "Azul", "Wingspan", "Codenames"],
  },
  {
    slug: "kublacon",
    name: "KublaCon",
    kind: "convention",
    location: "Burlingame, CA",
    bggTag: "Collection:-KublaCon",
    sourceKind: "tabletop_events",
    sourceConfig: {
      username: "kublacon-game-library2",
      libraryId: "D464E3FE-0B24-11EA-A225-A8DCBC109BF6",
    },
    gameNames: ["Catan", "Pandemic", "7 Wonders", "Terraforming Mars", "Splendor"],
  },
  {
    slug: "adventurers-guild",
    name: "Adventurers Guild",
    kind: "cafe",
    websiteUrl: "https://www.adventurersguildcafe.com",
    location: "Kitchener, ON, Canada",
    bggTag: "Collection:-Adventurers-Guild",
    sourceKind: "web_page",
    sourceConfig: {
      url: "https://www.adventurersguildcafe.com/games",
      scraperRules: [
        { element: "div", attributes: { role: "tabpanel", "aria-label": "BOARD GAMES" } },
        { element: "div", attributes: { class: "menu-item-option" } },
      ],
    },
    gameNames: ["Wingspan", "Azul", "Splendor", "Cafe House Trivia"],
  },
];

/** Replaces all data in the where_to_play schema with a small set of sample data. */
export async function seedDatabase(db: Database) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`TRUNCATE ${collectionGames}, ${collections}, ${gameNames}, ${games} RESTART IDENTITY`,
    );

    const insertedGames = await tx
      .insert(games)
      .values(sampleGames.map(({ name, bggId, yearPublished }) => ({ name, bggId, yearPublished })))
      .returning({ id: games.id, name: games.name });
    const gameIdByName = new Map(insertedGames.map((game) => [game.name, game.id]));
    const gameIdFor = (name: string) => {
      const gameId = gameIdByName.get(name);
      if (gameId === undefined) throw new Error(`Seed data has no game named "${name}".`);
      return gameId;
    };

    await tx
      .insert(gameNames)
      .values(
        sampleGames.flatMap((game) =>
          [game.name, ...game.otherNames].map((name) => ({ gameId: gameIdFor(game.name), name })),
        ),
      );

    for (const { gameNames: namesInCollection, ...collection } of sampleCollections) {
      const [insertedCollection] = await tx
        .insert(collections)
        .values(collection)
        .returning({ id: collections.id });
      if (!insertedCollection) throw new Error(`Could not insert "${collection.name}".`);
      await tx.insert(collectionGames).values(
        namesInCollection.map((name) => ({
          collectionId: insertedCollection.id,
          gameId: gameIdFor(name),
        })),
      );
    }
  });
}
