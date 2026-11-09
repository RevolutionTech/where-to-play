# 0005: Game Search Through the BGG API

Status: accepted (2026-11-08)

## Context

A user searches for a board game, then sees which collections own it. Our database knows only the games that some collection owns. A user must also be able to find a game that no collection owns, and learn that.

The BGG search API returns only the ID, name, year, and type of each match. Thumbnails, player counts, and ratings come from the BGG thing API, which accepts at most 20 IDs in one request. BGG needs an API token, and it rate-limits clients that send requests too fast.

## Decision

- **The server calls BGG at request time.** `GET /api/games` searches BGG, and `GET /api/games/:bggId` gets one game from BGG. The token stays on the server.
- **A page has 20 results,** so that one thing request gives all the thumbnails on a page. A search page costs two BGG requests.
- **Our database adds the collections.** One query counts the public collections that own each result. This count covers the full result list, so the "available" filter and the result total stay correct on each page.
- **The server sorts the results itself.** Exact name matches come first, then names that start with the query, then the rest. Newer games come first in each group. BGG's own order is weak, and a sort by BGG rank would need a thing request for every result.
- **Requests fail fast.** The web client of `BggClient` sends requests with no gap and retries at most twice, because a person waits for the answer. The importer keeps its slow, patient settings.
- **Responses allow shared caching** (`Cache-Control: public, s-maxage`). A CDN in front of the API can then answer repeated searches without BGG.
- **The details page falls back to our database.** If BGG fails, the server returns the stored details of the game with no image. It returns 502 only when the database does not have the game either.

## Consequences

- Search depends on BGG. When BGG is down, search does not work.
- The filters are limited to what the search response and our database give: expansions, and "available". Filters on player count or playtime would need details for every result. A later change can add them for games in our database only.
- If BGG rate-limits the site, a later change can store thumbnails in `games` (the importer already gets them) and skip the thing request for known games.
