# 0003: Collection Importer

Status: accepted (2026-11-07)

## Context

A legacy Pipedream workflow imports collections. It fetches each source, matches names to BGG games, writes the result to the legacy Supabase tables, and keeps a BGG tag on each game in each collection. Pipedream's free tier limits how long a run can take. Because of this, the workflow imports a different part of the collections each day, and stops early when too many names need a BGG search.

## Decision

- **A TypeScript script in `server/`, run weekly by GitHub Actions.** It uses the Drizzle schema and connects with `DATABASE_URL`, because Supabase does not expose the `where_to_play` schema through its REST API. A GitHub Actions job can run for 6 hours, so each run imports all collections and searches BGG for every unknown name.
- **Collections come from the `collections` table.** The source of each collection is in `source_kind` and `source_config`, so a new collection needs no code change.
- **The importer uses all useful data in each BGG response.** The collection request asks for stats, which cost no extra request, and updates the details of games that are already in the database. Details can be stale, because they rarely change.
- **SQL normalizes names.** Lookups use `normalizeGameName`, the same rule as the generated `name_normalized` columns.
- **The name rule deletes apostrophes.** This changes the rule in 0002. Sources often leave out apostrophes, so "Aeons End" must match "Aeon's End". Other punctuation still becomes a space, so "Ticket-to-Ride" matches "Ticket to Ride" but not "Tickettoride". In the names from current sources, this rule differs from the legacy rule for 144 of 5,633 names. The rule from 0002 differed for 354.
- **Each collection imports in two phases.** First, the importer reads the source and calls BGG, with no open transaction. Then one short transaction writes the new games and names, and the change to `collection_games`. A dry run rolls back this transaction.
- **A source that shrinks a lot is not trusted.** If a source gives no games, or less than half of the games that the collection has now, the importer skips that collection. The usual cause is a web page or spreadsheet that changed layout. `--force` imports it anyway.
- **One failing collection does not stop the others.** The run exits with an error at the end if any collection failed.
- **Unmatched names go in `unmatched_names`.** `pending` names wait for a person to match them, and the importer searches BGG for them again on each run. `ignored` names are not games, and the importer leaves them out of collections.
- **Accessories are not games.** Some sources list playmats, terrain, and other accessories with a BGG ID. The importer asks BGG for the type of each new ID and leaves accessories out of collections without a report. It still reports IDs that BGG does not know at all.
- **BGG tags follow `collection_games`.** After the transaction commits, the importer adds the tag to each added game and removes it from each removed game. A tag error does not undo the database change. [0007](0007-bgg-tag-sync.md) changes how tag changes are kept and applied.

## Consequences

- If a tag change fails on BGG, the database and BGG disagree until a person fixes the tag. The run reports each failure. [0007](0007-bgg-tag-sync.md) replaces this: a failed change stays pending.
- The importer refreshes details of known games only when a BGG collection lists them. It does not send extra requests to refresh details.
- A collection's first import adds its BGG tag to every game, also to games that already have it.
