import { type SQL, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
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
  description: text("description"),
  minPlayers: smallint("min_players"),
  maxPlayers: smallint("max_players"),
  minPlaytimeMinutes: integer("min_playtime_minutes"),
  maxPlaytimeMinutes: integer("max_playtime_minutes"),
  bggRating: real("bgg_rating"),
  bggRank: integer("bgg_rank"),
  ...timestamps,
});

/**
 * The rule that decides which names count as the same name. Importers must compare names with
 * this rule in SQL, so that there is only one definition of it.
 *
 * Apostrophes are deleted, because sources often leave them out ("Aeons End" for "Aeon's End").
 * Other punctuation becomes a space, so that "Deck-Building" and "Deck Building" match.
 */
export function normalizeGameName(name: SQL) {
  return sql`btrim(regexp_replace(regexp_replace(lower(${name}), '[''‘’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))`;
}

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
      .generatedAlwaysAs(normalizeGameName(sql.raw("name"))),
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

export const collectionKind = whereToPlay.enum("collection_kind", [
  "cafe",
  "convention",
  "individual",
]);

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

export type SourceConfigByKind = {
  bgg_collection: { username: string };
  google_sheet: { url: string; sheetName?: string };
  tabletop_events: { username: string; libraryId: string };
  web_page: { url: string; scraperRules: ScraperRule[] };
};

export type SourceConfig = SourceConfigByKind[keyof SourceConfigByKind];

export const collections = whereToPlay.table("collections", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: collectionKind("kind").notNull(),
  // The public site must never show a private collection or its name.
  isPrivate: boolean("is_private").notNull().default(false),
  websiteUrl: text("website_url"),
  // Free text for people to read, for example "Oakland, CA". It is not parsed or filtered.
  location: text("location"),
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

export const unmatchedNameStatus = whereToPlay.enum("unmatched_name_status", [
  // Waiting for a person to match it to a game. Importers search BGG for it again on each run.
  "pending",
  // Not a game, for example "Deck of cards". Importers leave it out of collections.
  "ignored",
]);

/** Names from collection sources that do not resolve to a game. */
export const unmatchedNames = whereToPlay.table("unmatched_names", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  nameNormalized: text("name_normalized")
    .notNull()
    .unique()
    .generatedAlwaysAs(normalizeGameName(sql.raw("name"))),
  status: unmatchedNameStatus("status").notNull().default("pending"),
  ...timestamps,
});
