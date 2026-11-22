---
name: add-collection
description: "Adds a new game collection (a board game cafe, convention, or game library) to Where to Play: finds its metadata on the location's website, picks the source kind and source_config that read its game library, previews the source, proposes the new where_to_play.collections row, and after approval saves it, imports it, applies the BGG tags, and reviews the unmatched names. If no source kind can read the library, it plans a PR for a new, general source kind. Use this skill whenever the user gives a cafe, convention, or library website or a link to a game library and wants it in Where to Play, asks to add, onboard, or set up a collection or location, or asks which importer or source_config fits a game library, even if they do not say \"collection\"."
---

# Add a Collection

A collection is one place where people can play games from a library: a board game cafe, a convention, or (privately) an individual. Each row in `where_to_play.collections` says what the place is, and how the importer reads its game library (`source_kind` and `source_config`). After the row exists, the weekly import keeps the collection current. So the most important output of this skill is a source config that reads the right games, and keeps reading them when the library changes.

## Environment

- Run commands from `server/` in the current checkout.
- The production credentials are in `.env.production` at the root of the **main** checkout. In a worktree, that is not the current directory. Get the main checkout's path with `git worktree list --porcelain | sed -n '1s/^worktree //p'`, and use the absolute path in `--env-file`. The file has `DATABASE_URL`, `BGG_API_TOKEN`, `BGG_USERNAME`, `BGG_PASSWORD`, and `GOOGLE_SHEETS_API_KEY`. Never print the values.
- Scripts that this skill uses (all in `server/scripts/`):
  - `list-collections.ts` prints all collections as JSON.
  - `preview-sources.ts <list.json> [--names]` reads the sources of a collection list, with no database. It prints the game count, the count with a BGG ID, and a sample of names.
  - `upsert-collections.ts <list.json>` makes the collections match the list, by slug.
  - `import-collections.ts --collection <slug> [--dry-run]` imports collections and applies their BGG tag changes.
  - `sync-bgg-tags.ts --collection <slug>` applies BGG tag changes that an import left pending.
- Run each script as `pnpm exec tsx --env-file=<main checkout>/.env.production scripts/<script>.ts ...`.
- Never commit a collection list or the output of `list-collections.ts`. Private collections name individuals (`docs/decisions/0004-private-collections.md`).

## Step 1: Get the two inputs

You need:

1. **The game library**: a link to the place where the location publishes its games. For example, a BGG collection, a Google Sheet, a page on the location's website, or a library app.
2. **The location's website.**

Ask for any input that the user did not give. If the library is on the location's own website, do not ask for the website. Use the home page of that site. For a franchise with more than one location, use the page for this one location (for example `snakesandlattes.com/annex`, not `snakesandlattes.com`). In this case, the collection is the one location, not the franchise.

If the same library also serves other locations of the franchise, find each of them. In Step 6, offer to add them in the same proposal, with one row for each location. Add only the locations that the user accepts.

## Step 2: Make sure the collection is new

Run `list-collections.ts`. Look for a collection with the same website, a similar name, the same BGG tag, or the same source (for example, the same BGG username). If one exists, stop and tell the user. `upsert-collections.ts` overwrites a row that has the same slug, so a duplicate slug replaces a collection without a warning.

## Step 3: Find the metadata on the website

Read the website: the home page, the "About" and "Contact" pages, and the footer. Find:

| Field | Rule |
|---|---|
| `name` | The name that the location uses for itself. For one location of a franchise, use the name that the franchise uses for that location, for example "Snakes & Lattes Annex". |
| `kind` | `convention` for an event that occurs on some dates. `cafe` for a public place that is open on most days and lets people play its games: a cafe, game bar, game store with a play area, or game library. `individual` only if the user says that the collection belongs to a person. |
| `isPrivate` | `false`. `true` only for `individual`. |
| `websiteUrl` | The home page from Step 1, as the site serves it (https, with or without `www`). |
| `location` | The city. In the US: "City, ST" (for example "Berkeley, CA"). In other countries: "City, Region, Country" (for example "Kitchener, ON, Canada"). For a convention, use the city of its venue. |
| `slug` | The name in lowercase, with hyphens between words, and only ASCII letters and digits. Write "&" as "and". Keep "the". Example: "The Game Parlour" → `the-game-parlour`. |
| `bggTag` | `Collection:-` and then the words of the name, joined by hyphens. Keep the capital letters. Remove characters other than letters and digits, and write "&" as "and". Example: "EBBG Con" → `Collection:-EBBG-Con`. |

For an `individual` collection, the slug and the BGG tag must not name the person. The import log and BGG tags are public. Ask the user for a neutral name.

If the website does not show a field clearly, give your best guess and mark it in the proposal. Do not stop to ask.

## Step 4: Choose the source kind

Read `references/source-kinds.md`. It tells how to recognize each source kind and how to find each config value.

Look at the library in two ways:

- **As the importer sees it:** `curl -sL -A "Mozilla/5.0" <url>`. The `web_page` source reads only this HTML. It does not run JavaScript.
- **As a browser sees it**, with the network requests. A list that appears only in a browser usually comes from a JSON request, or from a library platform (Cardboard Connect, Tabletop.Events, Airtable). The network requests show where the data comes from.

When more than one source can read the library, prefer them in this order:

1. The source that the location itself links to as its game list. A list that the location does not keep current gives wrong results.
2. A source with BGG IDs (`bgg_collection`, `cardboard_connect`, `tabletop_events`, or `json_api` with `bggIdPath`). A BGG ID matches a game with no doubt. A name can match no game, or the wrong game.
3. A source that reads structured data (an API or a sheet) before one that scrapes a page. Page layouts change more often than APIs.

If no source kind can read the library, go to "When no source kind fits" below.

## Step 5: Preview the source

Write the proposed row as a one-item JSON array, in the format of `upsert-collections.ts`, in your scratchpad directory:

```json
[
  {
    "slug": "tabletop-library",
    "name": "Tabletop Library",
    "kind": "cafe",
    "isPrivate": false,
    "websiteUrl": "https://www.tabletoplibrary.com/",
    "location": "Berkeley, CA",
    "bggTag": "Collection:-Tabletop-Library",
    "sourceKind": "json_api",
    "sourceConfig": {
      "url": "https://www.tabletoplibrary.com/api/catalog",
      "itemsPath": "games",
      "namePath": "title",
      "bggIdPath": "bgg_id",
      "where": [{ "path": "copies_in_library", "greaterThan": 0 }]
    }
  }
]
```

Run `preview-sources.ts` on it, and then again with `--names`. Change the config until the result is correct:

- **The count is plausible.** If the library shows a total, the counts must be close. A count that is too small usually means pagination, a filter, or a scraper rule that is too narrow.
- **Only games that the location does not have for play are left out.** Leave out games for sale only, and games that are sold or lost. Keep games that are archived, in storage, or checked out.
- **Each name is one game.** There must be no prices, descriptions, headings, player counts, or menu items. Some non-games are acceptable (a deck of cards, a puzzle), because the unmatched name review ignores them.
- **No names are missing.** Choose a few games that the library shows in different places (the start, the middle, the end, a second page or tab), and make sure that the preview has them.
- **BGG IDs are present** if the source has them.

## Step 6: Propose the collection

Show the user:

1. A table of the fields from Step 3, with a short note on each field that you guessed.
2. The source kind and the `sourceConfig` as JSON, with one sentence on why you chose this source kind. Name other sources that you found, and say why you did not choose them.
3. The preview result: the game count, the count with a BGG ID, and about 10 sample names.

Then wait for the user to approve the proposal or change it. The next steps write to production and to BGG.

## Step 7: Add and import the collection

After the user approves:

1. Save the approved list to `server/collections.<slug>.json` in the main checkout. Git ignores this file. It is a record of what you added.
2. Run `upsert-collections.ts` with the file.
3. Run `import-collections.ts --collection <slug> --dry-run`. Make sure that the outcome is `imported`, and that the source game count is the same as in the preview. If it is not, stop and tell the user.
4. Run `import-collections.ts --collection <slug>`. Each name with no BGG ID needs a BGG search, so a large library can take many minutes. Run it in the background. The import also adds the collection's BGG tag to each game.
5. Show the user the summary table that the import prints.

## Step 8: Finish the BGG tags

Look at the "Tag failures" and "Tags pending" columns of the import summary. If either is more than 0, run `sync-bgg-tags.ts --collection <slug>`. If BGG refuses the login, tell the user. Do not retry in a loop. The tags stay pending, and a later `pnpm tags:sync` applies them.

## Step 9: Review the unmatched names

If the import reported unmatched names, use the `unmatched-name-review` skill. That skill reviews all pending names, and not only the names of this collection. Tell the user this before you start.

When the review matches names to games, run `import-collections.ts --collection <slug>` again. Then the matched games join the collection now, and not at the next weekly import.

End with a short report: the collection, the number of games in it, the tag status, and the number of names that are still pending.

## When no source kind fits

Do not add the collection. Propose a plan for a PR, and wait for the user to approve it.

A new source must be general. It must be possible, in theory, to use it for another collection. So:

- **First, try to extend an existing source kind** with an optional config field. `docs/decisions/0008-json-api-source.md` lists features that `json_api` does not have yet (pagination, request headers, errors in the body, other conditions). Use one of them if it is enough. A new optional field keeps existing configs working.
- **Name a new source kind after the platform or the data format**, never after the location. Examples: `tabletop_events` is a platform, and `json_api` is a format.
- **Put in the config only the values that differ between two sites** that use the same platform.

The plan must have:

1. What the library is, and why each existing source kind cannot read it.
2. The new source kind or the new config field, with the TypeScript shape of the config.
3. The config for this location, and how another site would use the same source.
4. The files to change:
   - `server/src/db/schema.ts`: the `sourceKind` enum and `SourceConfigByKind`.
   - A migration from `pnpm db:generate` (only for a new enum value).
   - A fetcher in `server/src/importer/sources/`, and its case in `sources/index.ts`.
   - Tests in `server/src/importer/import-collections.test.ts`, with a fake web response (`fakeWeb`).
   - A decision record in `docs/decisions/`, and the source kind list in `AGENTS.md`.
5. The risks, for example an unofficial API that can change without notice.

After the user approves the plan, make the change on a new branch, and follow `AGENTS.md`. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Preview the location with `preview-sources.ts`, to prove that the new source reads its games. Then open a PR, and stop. A new source kind goes into production only after the PR merges, because the deploy migrates the production enum. Tell the user to use this skill again after the deploy, to add the collection.
