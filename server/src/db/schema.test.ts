import { desc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/database";
import { createDatabase } from "./client";
import { gameNames, games } from "./schema";
import { seedDatabase } from "./seed";

describe("fuzzy game name matching", () => {
  const db = createDatabase(testDatabaseUrl());

  beforeAll(async () => {
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  async function closestGameTo(searchText: string) {
    const similarity = sql<number>`extensions.similarity(${gameNames.nameNormalized}, lower(${searchText}))`;
    const [match] = await db
      .select({ game: games.name })
      .from(gameNames)
      .innerJoin(games, sql`${games.id} = ${gameNames.gameId}`)
      .orderBy(desc(similarity))
      .limit(1);
    return match?.game;
  }

  it("matches a misspelled name to the game", async () => {
    expect(await closestGameTo("Wingspn")).toBe("Wingspan");
  });

  it("matches another name of a game to the game", async () => {
    expect(await closestGameTo("Settlers of Catan")).toBe("Catan");
  });
});

describe("game name uniqueness", () => {
  const db = createDatabase(testDatabaseUrl());

  beforeAll(async () => {
    await seedDatabase(db);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  it("rejects a name that differs from an existing name only in case and punctuation", async () => {
    const [anotherGame] = await db
      .insert(games)
      .values({ name: "Seven Wonders Duel" })
      .returning({ id: games.id });

    const insertDuplicate = db
      .insert(gameNames)
      .values({ gameId: anotherGame?.id ?? 0, name: "SEVEN-WONDERS!" });

    // 23505 is unique_violation.
    await expect(insertDuplicate).rejects.toMatchObject({ cause: { code: "23505" } });
  });
});
