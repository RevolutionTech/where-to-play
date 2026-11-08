-- Supabase installs extensions in the "extensions" schema. Do the same everywhere, so that
-- schema-qualified references such as extensions.gin_trgm_ops work in every database.
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
