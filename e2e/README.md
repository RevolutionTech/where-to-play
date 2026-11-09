# E2E Tests

Playwright tests that drive the real client, server, and database in Chromium.

## Run

From the repo root:

```bash
pnpm --filter @where-to-play/e2e exec playwright install chromium  # once
pnpm test:e2e                                                      # run all tests
pnpm --filter @where-to-play/e2e test:e2e:ui                       # Playwright UI mode
```

The tests use their own database, `where_to_play_e2e`. Before the tests run, the global setup migrates it and loads the sample data from `server/src/db/seed.ts`. Assert on that sample data.

Playwright starts the server on port 3100 and the client on port 5273. These ports differ from `pnpm dev`, so the tests never use the dev database.

If your local database volume is older than this package, it has no `where_to_play_e2e` database. Run `pnpm db:reset`, or create the database by hand:

```bash
docker compose exec postgres createdb -U postgres where_to_play_e2e
```

## Locators

- Use `getByRole` for elements that have a clear accessible name, such as headings, links, and buttons.
- Use `getByTestId` for other elements that a test reads or uses, such as status text, inputs, and result rows.
- Add a `data-testid` only to an element that a test uses.
- Write test IDs in kebab-case. Name what the element is, not how it looks: `api-status`, `game-search-input`.
- For items in a list, put a stable key in the test ID, such as a collection slug: `search-result-kublacon`. Do not use the position in the list.
