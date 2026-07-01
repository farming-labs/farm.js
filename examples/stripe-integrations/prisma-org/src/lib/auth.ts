import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { envPaths, getExampleEnv } from "./env.ts";

export const authDatabasePath = path.join(envPaths.exampleRoot, "better-auth.sqlite");
export const authDatabase = new Database(authDatabasePath);
const authBaseUrl =
  getExampleEnv("BETTER_AUTH_URL") ??
  getExampleEnv("APP_BASE_URL") ??
  "http://localhost:3001";

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret:
    getExampleEnv("BETTER_AUTH_SECRET") ??
    "farm-example-better-auth-secret-for-local-dev-only",
  database: authDatabase,
  trustedOrigins: [authBaseUrl, "http://127.0.0.1:3001"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4,
    maxPasswordLength: 128,
  },
  plugins: [
    twoFactor(),
    passkey(),
    organization({
      allowUserToCreateOrganization: true,
    }),
  ],
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
