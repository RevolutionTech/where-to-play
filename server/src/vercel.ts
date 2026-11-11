import { createAppFromEnvironment } from "./app-from-environment";

// Vercel reuses a function instance for many requests, so the app and its connection pool
// are built once for each instance, not for each request.
const app = createAppFromEnvironment(process.env);

export default { fetch: app.fetch };
