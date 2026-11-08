CREATE SCHEMA "where_to_play";
--> statement-breakpoint
CREATE TYPE "where_to_play"."collection_kind" AS ENUM('cafe', 'convention');--> statement-breakpoint
CREATE TYPE "where_to_play"."source_kind" AS ENUM('bgg_collection', 'google_sheet', 'tabletop_events', 'web_page');--> statement-breakpoint
CREATE TABLE "where_to_play"."collection_games" (
	"collection_id" bigint NOT NULL,
	"game_id" bigint NOT NULL,
	CONSTRAINT "collection_games_collection_id_game_id_pk" PRIMARY KEY("collection_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "where_to_play"."collections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "where_to_play"."collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "where_to_play"."collection_kind" NOT NULL,
	"website_url" text,
	"bgg_tag" text,
	"source_kind" "where_to_play"."source_kind" NOT NULL,
	"source_config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "collections_bgg_tag_unique" UNIQUE("bgg_tag")
);
--> statement-breakpoint
CREATE TABLE "where_to_play"."game_names" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "where_to_play"."game_names_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" bigint NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text GENERATED ALWAYS AS (btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g'))) STORED NOT NULL,
	CONSTRAINT "game_names_name_normalized_unique" UNIQUE("name_normalized")
);
--> statement-breakpoint
CREATE TABLE "where_to_play"."games" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "where_to_play"."games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bgg_id" integer,
	"name" text NOT NULL,
	"year_published" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_bgg_id_unique" UNIQUE("bgg_id")
);
--> statement-breakpoint
ALTER TABLE "where_to_play"."collection_games" ADD CONSTRAINT "collection_games_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "where_to_play"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "where_to_play"."collection_games" ADD CONSTRAINT "collection_games_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "where_to_play"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "where_to_play"."game_names" ADD CONSTRAINT "game_names_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "where_to_play"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_games_game_id_idx" ON "where_to_play"."collection_games" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_names_name_normalized_trgm_idx" ON "where_to_play"."game_names" USING gin ("name_normalized" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "game_names_game_id_idx" ON "where_to_play"."game_names" USING btree ("game_id");