import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Pool, type PoolConfig } from "pg";

const authBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Add your pooled Postgres connection string.");
}

if (!secret) {
  throw new Error(
    "BETTER_AUTH_SECRET is required. Copy .env.example to .env.local and generate a secret.",
  );
}

const databaseConnection = new URL(databaseUrl);
const enableChannelBinding = databaseConnection.searchParams.get("channel_binding") === "require";

if (databaseConnection.searchParams.get("sslmode") === "require") {
  databaseConnection.searchParams.set("sslmode", "verify-full");
}

const poolConfig: PoolConfig & { enableChannelBinding: boolean } = {
  connectionString: databaseConnection.toString(),
  enableChannelBinding,
  max: process.env.NODE_ENV === "production" ? 5 : 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
};

const database = new Pool(poolConfig);

export const auth = betterAuth({
  appName: "FARMJS Better Auth Starter",
  baseURL: authBaseUrl,
  database,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  secret,
  trustedOrigins: [new URL(authBaseUrl).origin],
});

const migrations = await getMigrations(auth.options);
await migrations.runMigrations();
