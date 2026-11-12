# 0007: BGG Tag Sync

Status: accepted (2026-11-11)

## Context

The importer keeps a BGG tag on each game in each collection ([0003](0003-collection-importer.md)). A tag change needs a BGG login. BGG's Cloudflare firewall refuses `POST /login/api/v1` from GitHub-hosted runners (Azure network), with a 403 "you have been blocked" page. The same request from a home network, and from the legacy Pipedream workflow, reaches BGG. The XML API, with the bearer token, still works from the runners.

Before this decision, a failed tag change was lost. The importer chose tag changes from the database change of the current run, so the next run did not try a failed change again. Each tag change also tried a new login, so one blocked run sent thousands of refused logins.

## Decision

- **The database keeps the tag state.** `collection_games.bgg_tagged_at` is null until BGG confirms the tag. `bgg_tag_removals` keeps each tag to remove until BGG confirms the removal. A tag sync tries every pending change, so a failed change is tried again on the next sync.
- **One refused login stops the sync.** The BGG client remembers a failed login and fails each later tag change with no request.
- **The weekly workflow skips tags.** It runs the import with `--skip-tags`, so it needs no BGG password. `pnpm tags:sync` applies the pending changes from a machine where BGG allows the login.
- **Existing rows count as tagged.** The migration sets `bgg_tagged_at` on all rows that existed before it. Changes that failed before then are not in the database, so they need a separate fix.

## Consequences

- Tags lag behind the database until someone runs `pnpm tags:sync`. The import summary shows the number of pending tag changes for each collection.
- A tag sync sends one request for each tag added, and two for each tag removed, 2 seconds apart. A new large collection takes hours to tag.
- Another host can run `pnpm tags:sync` on a schedule, if BGG allows its network. Pipedream did.
- The tag state in the database can still differ from BGG, for example when a person changes a tag on BGG. Only a full read of the tags on BGG can find this.
- A sync handles only the tags of current collections. When a collection is deleted, or its `bgg_tag` changes, its old tags stay on BGG, and so do its pending rows in `bgg_tag_removals`. These changes are rare, so a full read of the tags on BGG finds them instead.
