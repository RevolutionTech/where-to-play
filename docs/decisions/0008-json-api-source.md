# 0008: JSON API Source

Status: accepted (2026-11-12)

## Context

Tabletop Library (Berkeley) publishes its whole catalogue as one JSON document at `https://www.tabletoplibrary.com/api/catalog`. The site marks the feed as unstable: it can add, rename, or drop fields. Its browse pages render in the browser, so the `web_page` source cannot read them.

Tabletop Library is one collection, and its catalogue software is its own. A source kind for only this site would add a code change for each similar site. The Tabletop.Events and Cardboard Connect sources are also JSON APIs, but each needs features that one site does not justify yet.

## Decision

- **A `json_api` source kind reads one JSON response.** Its config says where the data is, not how to process it:
  - `url`: the address to fetch.
  - `itemsPath`: the path to the array of items. With no `itemsPath`, the response is the array.
  - `namePath`: the path to the game name in each item.
  - `bggIdPath` (optional): the path to the BGG ID in each item.
  - `where` (optional): conditions that each item must pass, such as `{ "path": "copies_in_library", "greaterThan": 0 }`.
- **A path is a dot-separated list of object keys**, for example `shelf.code`. Paths have no array indexes or wildcards.
- **A BGG ID is a positive integer, or a string that holds one.** Any other value means the game has no BGG ID. Sources use 0, null, or a blank string for this.
- **A missing items array fails the import.** A renamed name or BGG ID field does not fail it. The importer's shrink check ([0003](0003-collection-importer.md)) stops that import, because most items then have no name and no BGG ID.

Tabletop Library's config:

```json
{
  "url": "https://www.tabletoplibrary.com/api/catalog",
  "itemsPath": "games",
  "namePath": "title",
  "bggIdPath": "bgg_id",
  "where": [{ "path": "copies_in_library", "greaterThan": 0 }]
}
```

The condition leaves out games that the site catalogues but does not lend, such as games that it only sells.

## Consequences

The source does not support these features yet. Add each one as an optional config field when a source needs it, so existing configs keep working:

- **Pagination.** Tabletop.Events gives a total page count, and Cardboard Connect gives a total item count.
- **Request headers.** Cardboard Connect needs a custom header.
- **Errors in the body.** Cardboard Connect reports errors in a 200 response. `json_api` checks only the HTTP status.
- **A gap between requests.** Tabletop.Events asks for 1 second between requests. One request needs no gap.
- **Other conditions.** `where` supports only `greaterThan`.
