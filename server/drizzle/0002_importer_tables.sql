CREATE TYPE "where_to_play"."unmatched_name_status" AS ENUM('pending', 'ignored');--> statement-breakpoint
CREATE TABLE "where_to_play"."unmatched_names" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "where_to_play"."unmatched_names_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_normalized" text GENERATED ALWAYS AS (btrim(regexp_replace(lower(name), '[^[:alnum:]]+', ' ', 'g'))) STORED NOT NULL,
	"status" "where_to_play"."unmatched_name_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unmatched_names_name_normalized_unique" UNIQUE("name_normalized")
);
--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "min_players" smallint;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "max_players" smallint;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "min_playtime_minutes" smallint;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "max_playtime_minutes" smallint;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "bgg_rating" real;--> statement-breakpoint
ALTER TABLE "where_to_play"."games" ADD COLUMN "bgg_rank" integer;