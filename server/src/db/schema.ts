import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// A separate schema keeps the app's tables apart from anything else in the database, and
// Supabase does not expose non-public schemas through its REST API by default.
export const whereToPlay = pgSchema("where_to_play");

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const games = whereToPlay.table("games", {
  // Some games are not on BGG, so the BGG ID cannot be the primary key.
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  bggId: integer("bgg_id").unique(),
  name: text("name").notNull(),
  yearPublished: smallint("year_published"),
  ...timestamps,
});

export const gameNames = whereToPlay.table(
  "game_names",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    gameId: bigint("game_id", { mode: "number" })
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Unique, so that an importer resolves each name in a source to exactly one game.
    nameNormalized: text("name_normalized")
      .notNull()
      .unique()
      .generatedAlwaysAs(sql`btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g'))`),
  },
  (table) => [
    index("game_names_name_normalized_trgm_idx").using(
      "gin",
      // pg_trgm lives in the "extensions" schema, as on Supabase, which is not always on the
      // search_path.
      sql`${table.nameNormalized} extensions.gin_trgm_ops`,
    ),
    index("game_names_game_id_idx").on(table.gameId),
  ],
);

export const collectionKind = whereToPlay.enum("collection_kind", ["cafe", "convention"]);

export const sourceKind = whereToPlay.enum("source_kind", [
  "bgg_collection",
  "google_sheet",
  "tabletop_events",
  "web_page",
]);

export type ScraperRule = {
  element: string;
  attributes?: Record<string, string | string[]>;
};

export type SourceConfig =
  | { username: string }
  | { url: string; sheetName?: string }
  | { username: string; libraryId: string }
  | { url: string; scraperRules: ScraperRule[] };

export const collections = whereToPlay.table("collections", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: collectionKind("kind").notNull(),
  websiteUrl: text("website_url"),
  bggTag: text("bgg_tag").unique(),
  sourceKind: sourceKind("source_kind").notNull(),
  sourceConfig: jsonb("source_config").$type<SourceConfig>().notNull(),
  ...timestamps,
});

export const collectionGames = whereToPlay.table(
  "collection_games",
  {
    collectionId: bigint("collection_id", { mode: "number" })
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    gameId: bigint("game_id", { mode: "number" })
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.gameId] }),
    index("collection_games_game_id_idx").on(table.gameId),
  ],
);
