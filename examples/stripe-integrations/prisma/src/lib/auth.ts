import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { getExampleEnv } from "./env.ts";

const database = new Database(path.join(process.cwd(), "better-auth.sqlite"));
const authBaseUrl =
  getExampleEnv("BETTER_AUTH_URL") ??
  getExampleEnv("APP_BASE_URL") ??
  "http://localhost:3000";

export const auth = betterAuth({
  baseURL: authBaseUrl,
  secret:
    getExampleEnv("BETTER_AUTH_SECRET") ??
    "farm-example-better-auth-secret-for-local-dev-only",
  database,
  trustedOrigins: [authBaseUrl, "http://127.0.0.1:3000"],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4,
    maxPasswordLength: 128,
  },
  plugins: [twoFactor(), passkey(), organization()],
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
