# 0009: Web Page Pagination

Status: accepted (2026-11-22)

## Context

The `web_page` source read one page. Tabletop Cleve lists its games in server-rendered HTML, with 15 games on each page and a "next" link to the following page. It has no JSON API and no single page with all its games.

The site also refuses old browsers: it returns HTTP 406 to the Chrome 119 User-Agent that the source sent.

## Decision

- **An optional `nextPageRule` selects the link to the next page.** It is one scraper rule, applied to the whole page. The source reads the `href` of the first element that it selects, relative to the current page, and reads that page with the same scraper rules. It stops at a page that has no such link.
- **The source waits 1 second between pages**, so a long list does not send a burst of requests to a small site.
- **The source stops at a page that it already read, and fails after 200 pages.** A pager that links back to an earlier page, or that never ends, cannot make the import loop.
- **The User-Agent is a current Chrome version.** Update it when a site refuses it as too old.

Tabletop Cleve's config:

```json
{
  "url": "https://app.tabletopcleve.com/",
  "scraperRules": [
    { "element": "div", "attributes": { "id": "board_games" } },
    { "element": "p" },
    { "element": "a" }
  ],
  "nextPageRule": { "element": "a", "attributes": { "rel": "next" } }
}
```

## Consequences

- A paginated list costs one request for each page, and 1 second for each page after the first.
- The scraper rules cannot leave out an element by its text or by a missing attribute. For Tabletop Cleve, they also select a "Learn" video link next to some names. The unmatched name review marks such names as not a game.
