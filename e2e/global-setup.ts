import { execFileSync } from "node:child_process";
import { e2eDatabaseUrl } from "./environment";

export default function prepareE2eDatabase() {
  for (const script of ["db:migrate", "db:seed"]) {
    execFileSync("pnpm", ["--filter", "@where-to-play/server", script], {
      env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
      stdio: "inherit",
    });
  }
}
