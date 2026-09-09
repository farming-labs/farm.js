import { getMigrations } from "better-auth/db/migration";
import { auth, authDatabase } from "./auth.ts";

try {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  console.log("Better Auth migrations completed.");
} finally {
  await authDatabase.end();
}
