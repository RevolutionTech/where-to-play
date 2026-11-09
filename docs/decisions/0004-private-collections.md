# 0004: Private and Individual Collections

Status: accepted (2026-11-08)

## Context

Some collections belong to individuals, not to cafes or conventions. The owner of the site wants to see these collections, but the public must not. The names of these individuals must not appear in version control. The repository and the logs of its workflows are public.

## Decision

- **A new collection kind, `individual`.**
- **A `collections.is_private` flag.** The public site must never show a private collection or its name. The site has no sign-in yet. A later feature will show private collections to the owner's account.
- **The collection list is not in version control.** `scripts/upsert-collections.ts` reads it from a JSON file that `.gitignore` excludes (`collections.*.json`). After the first run, the `collections` table is the source of truth.
- **Slugs of private collections do not name the individual,** because the import workflow prints slugs in its public log.
- **The importer removes query strings from URLs in its errors.** Query strings hold the Google Sheets API key and BGG usernames.

## Consequences

- Every query for public pages must filter on `is_private`.
- A private collection's BGG tag is public on BGG. Tags must not name the individual.
