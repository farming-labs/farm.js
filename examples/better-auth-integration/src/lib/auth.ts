import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

export const auth = betterAuth({
  database: new Database(process.env.BETTER_AUTH_DATABASE_PATH || "better-auth.sqlite"),
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "farm-example-better-auth-secret-for-local-development-only",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  emailAndPassword: {
    enabled: true,
  },
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
