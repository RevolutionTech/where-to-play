import { ensureOk, type Fetch, type Sleep } from "../../http";
import type { SourceGame } from "./index";

// Tabletop.Events asks API clients to wait 1 second between requests.
const REQUEST_GAP_MS = 1000;

type LibraryGamesPage = {
  result: {
    items: { name: string; bgg_id: number | string | null }[];
    paging: { next_page_number: number; total_pages: number };
  };
};

export async function fetchTabletopEventsLibrary(
  libraryId: string,
  { fetch, sleep }: { fetch: Fetch; sleep: Sleep },
): Promise<SourceGame[]> {
  const games: SourceGame[] = [];
  for (let pageNumber = 1; ; ) {
    const url = `https://tabletop.events/api/library/${encodeURIComponent(libraryId)}/librarygames?_page_number=${pageNumber}`;
    const { result } = (await (await ensureOk(await fetch(url))).json()) as LibraryGamesPage;
    for (const item of result.items) {
      // Tabletop.Events uses 0 or null when a game has no BGG ID.
      const bggId = Number(item.bgg_id);
      games.push({ name: item.name, bggId: Number.isInteger(bggId) && bggId > 0 ? bggId : null });
    }
    pageNumber = result.paging.next_page_number;
    if (pageNumber > result.paging.total_pages) return games;
    await sleep(REQUEST_GAP_MS);
  }
}
