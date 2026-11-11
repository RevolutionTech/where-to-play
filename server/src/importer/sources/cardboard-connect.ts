import { ensureOk, type Fetch } from "../../http";
import type { SourceGame } from "./index";

const LIBRARY_URL =
  "https://api.cardboardconnect.com/my/instance/convention/public/library/games.json";
const PAGE_SIZE = 500;

type LibraryGamesPage = {
  status: number;
  data: { total: number; collection: { name: string; bgg: number }[] };
};

/** Reads every game of a convention library, including games that are checked out. */
export async function fetchCardboardConnectLibrary(
  instanceId: string,
  { fetch }: { fetch: Fetch },
): Promise<SourceGame[]> {
  const games: SourceGame[] = [];
  for (let pageNumber = 1; ; pageNumber++) {
    const url = `${LIBRARY_URL}?hidecheckedout=0&perpage=${PAGE_SIZE}&page=${pageNumber}`;
    const response = await ensureOk(await fetch(url, { headers: { "cbc-instance": instanceId } }));
    const page = (await response.json()) as LibraryGamesPage;
    // The API reports failures in the body, with a 200 response.
    if (page.status !== 1) throw new Error(`Cardboard Connect returned status ${page.status}.`);

    const { total, collection } = page.data;
    // Cardboard Connect uses 0 when a game has no BGG ID.
    for (const item of collection) games.push({ name: item.name, bggId: item.bgg || null });
    if (games.length >= total || collection.length === 0) return games;
  }
}
