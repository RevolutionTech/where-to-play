import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(databaseUrl: string) {
  // Supabase's transaction pooler does not support named prepared statements.
  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}
