ALTER TABLE "where_to_play"."game_names" drop column "name_normalized";--> statement-breakpoint
ALTER TABLE "where_to_play"."game_names" ADD COLUMN "name_normalized" text GENERATED ALWAYS AS (btrim(regexp_replace(regexp_replace(lower(name), '[''‘’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "where_to_play"."unmatched_names" drop column "name_normalized";--> statement-breakpoint
ALTER TABLE "where_to_play"."unmatched_names" ADD COLUMN "name_normalized" text GENERATED ALWAYS AS (btrim(regexp_replace(regexp_replace(lower(name), '[''‘’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g'))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "where_to_play"."game_names" ADD CONSTRAINT "game_names_name_normalized_unique" UNIQUE("name_normalized");--> statement-breakpoint
CREATE INDEX "game_names_name_normalized_trgm_idx" ON "where_to_play"."game_names" USING gin ("name_normalized" extensions.gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "where_to_play"."unmatched_names" ADD CONSTRAINT "unmatched_names_name_normalized_unique" UNIQUE("name_normalized");
