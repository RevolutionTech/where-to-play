ALTER TYPE "where_to_play"."collection_kind" ADD VALUE 'individual';--> statement-breakpoint
ALTER TABLE "where_to_play"."collections" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;