# Source Kinds

How to recognize each source kind, and how to find the values of its `sourceConfig`. The config types are `SourceConfigByKind` in `server/src/db/schema.ts`. The fetchers are in `server/src/importer/sources/`. Read a fetcher when this file does not answer a question.

| Source kind | Recognize it by | BGG IDs |
|---|---|---|
| `bgg_collection` | `boardgamegeek.com/collection/user/<username>` | Yes |
| `cardboard_connect` | A library on Cardboard Connect; requests to `api.cardboardconnect.com` | Yes, for most games |
| `tabletop_events` | A library on `tabletop.events`; requests to `tabletop.events/api/library/...` | Yes, for most games |
| `airtable_shared_page` | `airtable.com/app.../shr...` | No |
| `google_sheet` | `docs.google.com/spreadsheets/d/<id>` | No |
| `json_api` | Any page that loads the whole list in one JSON response | Only with `bggIdPath` |
| `web_page` | A page whose HTML (from `curl`) has the game names in it | No |

## bgg_collection

```json
{ "username": "Thegameparlour" }
```

- The username is the path segment after `/collection/user/`.
- The importer reads the games that the user marks as owned, and leaves out expansions. The query string of the link (`?own=1&subtype=boardgame`) has no effect. If the location uses a different filter on BGG (for example "for trade" for its library), tell the user that the importer reads owned games only.
- BGG gives stats with the collection. The importer uses them to refresh the details of the games.

## cardboard_connect

```json
{ "instanceId": "mbfrivpj" }
```

- Open the library in a browser, and read the network requests. The requests to `api.cardboardconnect.com` have the instance ID in the `cbc-instance` header.
- The importer reads all games, including games that are checked out.

## tabletop_events

```json
{ "username": "board-game-adventures", "libraryId": "3C08058E-31AC-11EE-83FD-F1B1818EEC5D" }
```

- `libraryId` is the ID in the requests to `tabletop.events/api/library/<libraryId>/librarygames`. Read it from the network requests of the library page, or from the Tabletop.Events API (`tabletop.events/api/...`).
- `username` is the convention organizer's handle in the Tabletop.Events URLs. The importer does not use it. It is there for people who read the config.

## airtable_shared_page

```json
{ "url": "https://airtable.com/appXXXXXXXXXXXXXX/shrXXXXXXXXXXXXXX" }
```

- Use the shared link or the embed link. The URL must contain both the `app...` ID and the `shr...` ID.
- The importer reads the primary column of each table that the page shows. If the game name is not the primary column, this source does not fit.
- Airtable has no public API for shared pages. The importer uses the request that the page makes in a browser.

## google_sheet

```json
{ "url": "https://docs.google.com/spreadsheets/d/<id>/edit", "sheetName": "Games" }
```

- The importer reads column A, under one header row. If the names are in another column, or the sheet has more than one header row, this source does not fit as it is.
- `sheetName` is the name of the tab. Leave it out to read the first visible tab.
- The sheet must be viewable by anyone with the link, because the importer reads it with an API key, not with an account.
- A sheet that the website embeds (`/pubhtml`, or an `iframe`) has the spreadsheet ID in its URL. A `/d/e/2PACX-...` link is a "publish to the web" link, and its ID is not the spreadsheet ID. Ask the user for the normal link, or try `web_page` on the published HTML.

## json_api

```json
{
  "url": "https://www.tabletoplibrary.com/api/catalog",
  "itemsPath": "games",
  "namePath": "title",
  "bggIdPath": "bgg_id",
  "where": [{ "path": "copies_in_library", "greaterThan": 0 }]
}
```

See `docs/decisions/0008-json-api-source.md`.

- Find the request in the browser's network requests: a JSON response that holds the list of games. Then fetch it with `curl`, to make sure that it works with no cookies or special headers.
- `itemsPath` is the path to the array of items. Leave it out when the response is the array.
- Paths are object keys joined by dots (`shelf.code`). They have no array indexes or wildcards.
- Use `where` to leave out items that the location does not have for play, for example games that it only sells, or games that it sold or lost. Look for a field such as a copy count or a status. Keep games that are archived, in storage, or checked out: the location still owns them, and a player can ask for them.
- The source makes one request. It has no pagination, no request headers, and no condition other than `greaterThan`. If the API needs one of these, see "When no source kind fits" in `SKILL.md`. Before you decide that the API has pages, try parameters that return everything, for example `?per_page=1000`, `?limit=10000`, or `?all=1`.

## web_page

```json
{
  "url": "https://www.adventurersguildcafe.com/games",
  "scraperRules": [
    { "element": "div", "attributes": { "role": "tabpanel", "aria-label": "BOARD GAMES" } },
    { "element": "div", "attributes": { "class": "menu-item-option" } }
  ]
}
```

- The importer reads the HTML that the server sends, with a browser User-Agent. It does not run JavaScript. If `curl` does not show the names, this source does not fit.
- Each rule selects elements inside the elements that the rule before it selected. The text of each element that the last rule selects is one game name. So the last rule must select elements that contain only the name: no price, no description, no player count.
- An attribute must match its whole value, except `class`, which matches one class of the element. A list of values matches any one of them, for example `{ "class": ["game", "expansion"] }`.
- Prefer attributes that describe the content (`role`, `aria-label`, semantic class names) to generated class names (`css-1x2y3z`), which change when the site is built again.
- The source reads one page. If the list has more than one page, this source does not fit as it is.
