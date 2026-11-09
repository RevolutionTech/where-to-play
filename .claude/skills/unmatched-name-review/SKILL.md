---
name: unmatched-name-review
description: "Reviews the pending names in the where_to_play.unmatched_names table: finds the BGG game for each name, shows a review table, then saves the names that the user confirms (matched to a game, or ignored as not a game). Use this skill whenever the user asks to review, resolve, match, or clean up unmatched names or aliases, asks to \"run the alias review\" or \"process unmatched names\", or asks why a game from a collection source did not import."
---

# Unmatched Name Review

The weekly collection importer (`server/scripts/import-collections.ts`) saves each source name that it cannot match to a game in `where_to_play.unmatched_names`, with `status = 'pending'`. This skill helps the user match those names to BGG games. The next weekly import then adds the games to the collections that list the names.

## Environment

- Run commands from `server/`. Production credentials are in `server/.env.prod`, which git ignores: `DATABASE_URL` and `BGG_API_TOKEN`. Never print either value.
- `scripts/review-unmatched-names.ts` does all reads and writes:
  - `--list` prints the pending names as a JSON array.
  - `--apply <decisions.json>` saves decisions in one transaction. Add `--dry-run` to see the result and save nothing.
- Do not write to the tables with SQL. The script saves new games with their BGG details, which the weekly importer never adds to games that it already has.

## Workflow

### Step 1: Get the queue

```bash
pnpm exec tsx --env-file=.env.prod scripts/review-unmatched-names.ts --list
```

If the list is empty, tell the user that there is nothing to review, and stop.

### Step 2: Find the BGG game for each name

The names are the spellings that sources use, for example "Trickarus (English edition)" or "Bananagrams - Braille". Search the web in batches for the best BGG match of each name. Keep the findings internal. The table in Step 3 is the only place where you show them.

For each name, decide:

- **`bggId`**: the number in the BGG URL `boardgamegeek.com/boardgame/<id>` or `boardgamegeek.com/boardgameexpansion/<id>`.
  - An edition, printing, language, or accessible version of a game (large print, braille, "English edition") gets the ID of that game, unless BGG lists it as a separate game.
  - An expansion has its own ID. Do not use the base game's ID for it.
  - A name that lists a game with its expansions ("Dominion with most expansions") gets the base game's ID.
- **`ignore`**: the name is not a board game or an expansion. Examples: playing cards, contest entries, playmats, terrain, miniature sets. Collections leave BGG accessories (`boardgamegeek.com/boardgameaccessory/<id>`) out, so an accessory is also `ignore`.
- **No match**: you found no plausible BGG entry, but the item looks like a game. Suggest `ignore`, so the name leaves the queue. The user can choose to leave it pending instead, to add the game by hand later.
- **Note**: a short flag for anything that the user must check. Examples: two plausible BGG entries, wording that differs from the BGG title, an edition mapped to its base game.

### Step 3: Show the review table

Render an HTML widget with `show_widget`. Do not print the table as text too.

| Column | Content |
|---|---|
| Name | The exact pending name, in monospace |
| BGG title | The BGG title, with designer · publisher · player count · year as a muted subtitle |
| BGG ID | A link to `boardgamegeek.com/boardgame/<id>` or `/boardgameexpansion/<id>` |
| Notes | A short flag, a red `ignore` badge, or a grey `no match` badge followed by the red `ignore` badge (the suggested decision) |

Style:

- Body text 13px. Column headers 11px, uppercase, muted.
- Borders 0.5px: `var(--color-border-tertiary)` for rows, `var(--color-border-secondary)` for the header.
- Row hover: `var(--color-background-secondary)`.
- Name column: `font-family: var(--font-mono)`, `color: var(--color-text-tertiary)`.
- BGG ID column: monospace, `color: var(--color-text-info)`, linked.
- `ignore` badge: `background: var(--color-background-danger); color: var(--color-text-danger)`.
- No thumbnails, because BGG's image CDN blocks cross-origin requests.
- Use `table-layout: fixed` with `<colgroup>` widths, so that long names do not overflow.
- Put all data in the HTML. Do not add a script that fetches data.

### Step 4: Confirm with the user

Ask the user which rows to save. They can accept all rows, change a BGG ID, change a row to `ignore`, or skip a row.

### Step 5: Save the decisions

Write the confirmed decisions to a JSON file in your scratchpad directory, not in the repo:

```json
[
  { "name": "Bananagrams - Braille", "bggId": 27225 },
  { "name": "THAT OLD WALLPAPER - SOCIAL MEDIA CONTEST", "ignore": true }
]
```

Use each name exactly as `--list` printed it. Run a dry run first, and show the user its result table:

```bash
pnpm exec tsx --env-file=.env.prod scripts/review-unmatched-names.ts --apply <file> --dry-run
```

If the user agrees, run it again without `--dry-run`. Each result is one of these:

- `matched`: the name now belongs to the game. If the game was not in the database, the script saved it with its BGG details.
- `ignored`: future imports leave the name out of collections.
- `skipped`: nothing changed for this name. The detail says why: the name is not pending, BGG has no such game, the ID is an accessory, or the name already belongs to another game. Tell the user each skipped row.

Then run `--list` again, and report how many names are still pending. Tell the user that the next weekly import adds the matched games to their collections. They can also run the "Import collections" workflow by hand.
