CREATE TABLE "where_to_play"."bgg_tag_removals" (
	"bgg_tag" text NOT NULL,
	"bgg_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bgg_tag_removals_bgg_tag_bgg_id_pk" PRIMARY KEY("bgg_tag","bgg_id")
);
--> statement-breakpoint
ALTER TABLE "where_to_play"."collection_games" ADD COLUMN "bgg_tagged_at" timestamp with time zone;--> statement-breakpoint
-- Before this column, the importer tagged each game when it added it, and it reported each failed
-- tag in its run log. Existing rows count as tagged, so the first tag sync does not send a tag
-- request for every game again.
UPDATE "where_to_play"."collection_games" SET "bgg_tagged_at" = now();
