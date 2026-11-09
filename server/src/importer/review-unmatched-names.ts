import { and, asc, eq, inArray, sql, TransactionRollbackError } from "drizzle-orm";
import type { BggClient } from "../bgg/client";
import type { Database } from "../db/client";
import { gameNames, games, normalizeGameName, unmatchedNames } from "../db/schema";
import { type DatabaseOrTransaction, saveThings } from "./import-collections";

/** A person's decision about one pending name. */
export type NameDecision = { name: string; bggId: number } | { name: string; ignore: true };

export type DecisionResult = {
  name: string;
  outcome: "matched" | "ignored" | "skipped";
  /** The game that the name now belongs to, or why the decision was skipped. */
  detail: string;
};

export async function listPendingNames(db: Database) {
  const rows = await db
    .select({ name: unmatchedNames.name })
    .from(unmatchedNames)
    .where(eq(unmatchedNames.status, "pending"))
    .orderBy(asc(unmatchedNames.name));
  return rows.map((row) => row.name);
}

/**
 * Matches pending names to BGG games, or marks them as not games. A game that is not in the
 * database yet is saved with its BGG details, because the weekly importer does not refresh the
 * details of games that it already has. The next weekly import adds the game to the collections
 * that list the name.
 */
export async function applyNameDecisions(
  db: Database,
  bgg: BggClient,
  decisions: NameDecision[],
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<DecisionResult[]> {
  const matchedBggIds = [
    ...new Set(decisions.flatMap((decision) => ("bggId" in decision ? [decision.bggId] : []))),
  ];
  const knownBggIds = new Set(
    matchedBggIds.length === 0
      ? []
      : (
          await db
            .select({ bggId: games.bggId })
            .from(games)
            .where(inArray(games.bggId, matchedBggIds))
        ).map((row) => row.bggId),
  );
  const things = await bgg.fetchThings(matchedBggIds.filter((bggId) => !knownBggIds.has(bggId)));
  const thingByBggId = new Map(things.map((thing) => [thing.bggId, thing]));

  const results: DecisionResult[] = [];
  try {
    await db.transaction(async (tx) => {
      await saveThings(
        tx,
        things.filter((thing) => !thing.isAccessory),
      );
      for (const decision of decisions) {
        results.push(await applyDecision(tx, decision, knownBggIds, thingByBggId));
      }
      if (dryRun) tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
  return results;
}

async function applyDecision(
  db: DatabaseOrTransaction,
  decision: NameDecision,
  knownBggIds: Set<number | null>,
  thingByBggId: Map<number, { isAccessory: boolean }>,
): Promise<DecisionResult> {
  const { name } = decision;
  const isThisName = sql`${unmatchedNames.nameNormalized} = ${normalizeGameName(sql`${name}`)}`;
  const [pending] = await db
    .select({ id: unmatchedNames.id })
    .from(unmatchedNames)
    .where(and(isThisName, eq(unmatchedNames.status, "pending")));
  if (!pending) return { name, outcome: "skipped", detail: "Not a pending name." };

  if ("ignore" in decision) {
    await db
      .update(unmatchedNames)
      .set({ status: "ignored" })
      .where(eq(unmatchedNames.id, pending.id));
    return { name, outcome: "ignored", detail: "Not a game." };
  }

  const thing = thingByBggId.get(decision.bggId);
  if (!knownBggIds.has(decision.bggId)) {
    if (!thing) return { name, outcome: "skipped", detail: `BGG has no game ${decision.bggId}.` };
    if (thing.isAccessory) {
      return { name, outcome: "skipped", detail: `${decision.bggId} is an accessory. Ignore it.` };
    }
  }

  const [game] = await db
    .select({ id: games.id, name: games.name })
    .from(games)
    .where(eq(games.bggId, decision.bggId));
  if (!game) return { name, outcome: "skipped", detail: `No game ${decision.bggId}.` };

  await db.insert(gameNames).values({ gameId: game.id, name }).onConflictDoNothing();
  const [owner] = await db
    .select({ gameId: gameNames.gameId, game: games.name })
    .from(gameNames)
    .innerJoin(games, eq(games.id, gameNames.gameId))
    .where(sql`${gameNames.nameNormalized} = ${normalizeGameName(sql`${name}`)}`);
  if (owner && owner.gameId !== game.id) {
    return { name, outcome: "skipped", detail: `The name already belongs to ${owner.game}.` };
  }

  await db.delete(unmatchedNames).where(eq(unmatchedNames.id, pending.id));
  return { name, outcome: "matched", detail: `${game.name} (${decision.bggId})` };
}
