// Ports differ from `pnpm dev` (5173 and 3000) and from the ports Vite tries when 5173 is
// taken. This way the tests never reach a dev server that reads the dev database.
export const clientPort = 5273;
export const serverPort = 3100;

export const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/where_to_play_e2e";
