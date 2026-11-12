// Downloads the BGG collection tags of one account as `bgg-tags.json`, for `pnpm tags:audit`.
//
// Run it in the browser console on your BGG tags page (https://boardgamegeek.com/tags/user/<you>),
// signed in as the account that owns the collection tags. BGG's Cloudflare firewall serves these
// pages only to real browsers, so the audit cannot fetch them itself.
(async () => {
  const COLLECTION_TAG_PREFIX = "collection:-";
  // BGG "things" share one ID space, so an RPG item's ID cannot be a board game's ID.
  const THING_LINK =
    /^\/(?:boardgame|boardgameexpansion|boardgameaccessory|rpgitem|videogame)\/(\d+)/;
  // The same gap as the BGG client in `src/bgg/client.ts`.
  const REQUEST_GAP_MS = 2000;
  const MAX_RETRIES = 3;

  const username = window.location.pathname.match(/^\/tags\/user\/([^/]+)/)?.[1];
  if (!username) throw new Error("Open https://boardgamegeek.com/tags/user/<username> first.");

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const progress = { pagesRead: 0, games: 0, skippedRows: 0, done: false, error: null };
  window.bggTagExport = progress;

  async function fetchPage(pageNumber) {
    const url = `/tags/user/${username}/page/${pageNumber}`;
    for (let retry = 0; ; retry++) {
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) return new DOMParser().parseFromString(await response.text(), "text/html");
      if (retry >= MAX_RETRIES) throw new Error(`${response.status} from ${url}`);
      await sleep(30_000);
    }
  }

  try {
    const games = [];
    const skippedRows = [];
    for (let pageNumber = 1; ; pageNumber++) {
      const rows = [...(await fetchPage(pageNumber)).querySelectorAll("div.tagouter")];
      // A page past the last one lists no games.
      if (rows.length === 0) break;
      for (const row of rows) {
        const bggIds = new Set(
          [...row.querySelectorAll("a")].flatMap((link) => {
            const match = (link.getAttribute("href") ?? "").match(THING_LINK);
            return match ? [Number(match[1])] : [];
          }),
        );
        if (bggIds.size > 1)
          throw new Error(`Page ${pageNumber} has a row with ${bggIds.size} games.`);
        if (bggIds.size === 0) {
          skippedRows.push(row.textContent.replace(/\s+/g, " ").trim());
          continue;
        }
        // A tag with characters such as "&" links to /geektag.php instead of /tag/.
        const tags = [...row.querySelectorAll('a[href^="/tag/"], a[href^="/geektag.php"]')]
          .map((link) => link.textContent.trim())
          .filter((tag) => tag.toLowerCase().startsWith(COLLECTION_TAG_PREFIX));
        if (tags.length > 0) games.push({ bggId: [...bggIds][0], tags });
      }
      progress.pagesRead = pageNumber;
      progress.games = games.length;
      progress.skippedRows = skippedRows.length;
      console.log(`Read page ${pageNumber}: ${games.length} games with collection tags.`);
      await sleep(REQUEST_GAP_MS);
    }

    const tagExport = { exportedAt: new Date().toISOString(), username, games, skippedRows };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(tagExport)], { type: "application/json" }),
    );
    link.download = "bgg-tags.json";
    link.click();
    // Revoking the link at once can cancel the download before it starts.
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    progress.done = true;
    console.log(`Saved bgg-tags.json with ${games.length} games.`);
  } catch (error) {
    progress.error = String(error);
    throw error;
  }
})();
