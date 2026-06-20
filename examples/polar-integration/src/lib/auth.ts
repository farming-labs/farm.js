import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { organization } from "better-auth/plugins";

const authBaseUrl =
  process.env.BETTER_AUTH_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3002";

export const authDatabasePath = path.join(process.cwd(), "better-auth.sqlite");
export const authDatabase = new Database(authDatabasePath);

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "farm-example-polar-better-auth-secret-for-local-dev-only",
  database: authDatabase,
  trustedOrigins: [authBaseUrl, "http://127.0.0.1:3002"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4,
    maxPasswordLength: 128,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
    }),
  ],
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
