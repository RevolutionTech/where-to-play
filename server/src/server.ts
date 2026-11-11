import { serve } from "@hono/node-server";
import { createAppFromEnvironment } from "./app-from-environment";

const app = createAppFromEnvironment(process.env);
const port = Number(process.env.SERVER_PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
