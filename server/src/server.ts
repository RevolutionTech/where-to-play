import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createDatabase } from "./db/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy server/.env.example to server/.env.");
}

const port = Number(process.env.SERVER_PORT ?? 3000);
const app = createApp({ db: createDatabase(databaseUrl) });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
