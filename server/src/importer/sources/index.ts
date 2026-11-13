import type { BggClient, BggStats } from "../../bgg/client";
import type { collections, SourceConfigByKind } from "../../db/schema";
import type { Fetch, Sleep } from "../../http";
import { fetchAirtableSharedPage } from "./airtable-shared-page";
import { fetchCardboardConnectLibrary } from "./cardboard-connect";
import { fetchGoogleSheet } from "./google-sheet";
import { fetchJsonApi } from "./json-api";
import { fetchTabletopEventsLibrary } from "./tabletop-events";
import { fetchWebPage } from "./web-page";

/** One game as a source lists it. Only some sources give a BGG ID or BGG stats. */
export type SourceGame = { name: string; bggId: number | null; bggStats?: BggStats };

export type SourceContext = {
  fetch: Fetch;
  sleep: Sleep;
  bgg: BggClient;
  googleSheetsApiKey: string | undefined;
};

type CollectionSource = Pick<typeof collections.$inferSelect, "sourceKind" | "sourceConfig">;

/** Returns the games of a source, with blank and repeated names removed. */
export async function fetchSourceGames(
  source: CollectionSource,
  context: SourceContext,
): Promise<SourceGame[]> {
  const games = await fetchFromSource(source, context);
  const seen = new Set<string>();
  const uniqueGames: SourceGame[] = [];
  for (const game of games) {
    const name = game.name.trim();
    const key = game.bggId === null ? `name:${name}` : `bgg:${game.bggId}`;
    if ((name === "" && game.bggId === null) || seen.has(key)) continue;
    seen.add(key);
    uniqueGames.push({ ...game, name });
  }
  return uniqueGames;
}

async function fetchFromSource(
  { sourceKind, sourceConfig }: CollectionSource,
  context: SourceContext,
) {
  switch (sourceKind) {
    case "airtable_shared_page":
      return fetchAirtableSharedPage(
        sourceConfig as SourceConfigByKind["airtable_shared_page"],
        context,
      );
    case "bgg_collection": {
      const { username } = sourceConfig as SourceConfigByKind["bgg_collection"];
      const items = await context.bgg.fetchCollection(username);
      return items.map(({ bggId, name, stats }) => ({ bggId, name, bggStats: stats }));
    }
    case "cardboard_connect": {
      const { instanceId } = sourceConfig as SourceConfigByKind["cardboard_connect"];
      return fetchCardboardConnectLibrary(instanceId, context);
    }
    case "tabletop_events": {
      const { libraryId } = sourceConfig as SourceConfigByKind["tabletop_events"];
      return fetchTabletopEventsLibrary(libraryId, context);
    }
    case "google_sheet":
      return fetchGoogleSheet(sourceConfig as SourceConfigByKind["google_sheet"], {
        fetch: context.fetch,
        apiKey: context.googleSheetsApiKey,
      });
    case "json_api":
      return fetchJsonApi(sourceConfig as SourceConfigByKind["json_api"], context);
    case "web_page":
      return fetchWebPage(sourceConfig as SourceConfigByKind["web_page"], context);
  }
}
