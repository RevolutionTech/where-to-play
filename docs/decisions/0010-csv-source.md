# 0010: CSV Source

Status: accepted (2026-11-23)

## Context

Level One Game Pub (Ottawa) keeps its library in a Google Sheet. Its website loads the sheet as CSV from a "publish to the web" link (`docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv`). The sheet has a column with a link to each game's BGG page, and a `Hidden?` column for games that the site does not show.

No existing source kind reads it:

- `google_sheet` uses the Sheets API. The API needs the spreadsheet ID, and a publish link does not contain it. It also reads only column A, with no BGG IDs.
- `web_page` reads HTML, and `json_api` reads JSON.

A published sheet is a common way for a small location to share a list. Other tools also export CSV.

## Decision

- **A `csv` source kind reads one CSV file with one header row.** Its config:
  - `url`: the address of the file.
  - `nameColumn`: the header of the column with the game name.
  - `bggIdColumn` (optional): the header of the column with the BGG ID.
  - `where` (optional): conditions that each row must pass, such as `{ "column": "Hidden?", "equals": "FALSE" }`.
- **Columns are header names, not positions**, so a new column in the sheet does not break the config.
- **A BGG ID is a positive integer, or a link to a game or an expansion on BoardGameGeek.** Sheets often hold the link, not the ID. Any other value means that the game has no BGG ID.
- **A missing column fails the import.** That means the sheet changed, and the config must change too.
- **The `csv-parse` package parses the file.** Fields can hold quotes, commas, and line breaks, and a parser of our own would have to handle all of them.

Level One's config:

```json
{
  "url": "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=1311831870&single=true&output=csv",
  "nameColumn": "Game",
  "bggIdColumn": "URL",
  "where": [{ "column": "Hidden?", "equals": "FALSE" }]
}
```

## Consequences

- A sheet that is shared as "anyone with the link" can still use `google_sheet`. A sheet that is published to the web can now use `csv`.
- A wrong BGG link in a sheet adds the wrong game, because the importer trusts a BGG ID over the name.
- `where` supports only `equals`. Add other conditions as optional fields when a source needs them.
