# 0002: Database Setup and Initial Schema

Status: accepted (2026-11-07)

## Context

The server needs a database for local development, tests, and CI. Production will be Supabase on the free tier, which runs PostgreSQL 15.

Collections of games come from many places: BGG collections, Google Sheets, Tabletop.Events libraries, and web pages. A collection belongs to a cafe or a convention. Later, a collection may belong to an organization that moves its games to different locations. The name `collections` (not `venues`) leaves room for that. A legacy project holds data and importers that a later stage will move into this database.

## Decision

- **Local database: plain `postgres:15` in Docker Compose.** It matches the production major version, and CI runs the same image as a service. We rejected `supabase start`, because it runs many services that the app does not use and has its own migration system. We rejected Homebrew PostgreSQL, because its version can drift and CI would still need a container.
- **Drizzle ORM with postgres.js, prepared statements off.** Supabase's transaction pooler does not support named prepared statements. postgres.js also runs on Cloudflare Workers.
- **A separate `where_to_play` Postgres schema.** It keeps the app's tables apart from other tables in the database. Supabase does not expose it through its REST API by default.
- **`pg_trgm` in an `extensions` schema.** Supabase installs extensions there. SQL refers to it by full name, for example `extensions.similarity`, because `extensions` is not always on the `search_path`.
- **Tables:**
  - `games`: an internal ID is the primary key, because some games are not on BGG. `bgg_id` is unique and nullable. `name` is the name that the app shows.
  - `game_names`: the names that collections use for a game. Usually one of them is the same as `games.name`, but this is not required. `name_normalized` is generated: lowercase, with runs of punctuation and spaces changed to one space. It is unique, so each name resolves to exactly one game. It has a trigram index for fuzzy search.
  - `collections`: one row for each collection. `kind` is `cafe` or `convention`. We will add a new kind when a real collection needs it. `bgg_tag` is the BGG tag that the importer syncs with. The import source is in the same row (`source_kind` and a typed `source_config` JSON), because each collection has one source today. Every collection must have a source.
  - `collection_games`: which games are in which collection.

## Consequences

- Development needs Docker.
- If a collection needs more than one source, a migration must move the source columns into their own table.
- The rule in `name_normalized` decides which names count as the same. Changing it means a migration that can fail on new duplicates.
