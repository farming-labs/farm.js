import { isIP } from "node:net";
import { betterAuth } from "better-auth";
import { Pool, type PoolConfig } from "pg";

const isProduction = process.env.NODE_ENV === "production";
const authBaseUrl = process.env.BETTER_AUTH_URL;
const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (isProduction && !authBaseUrl) {
  throw new Error(
    "BETTER_AUTH_URL is required in production. Set it to the app's public origin, such as https://app.example.com.",
  );
}

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
  max: isProduction ? 5 : 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
};

export const authDatabase = new Pool(poolConfig);

/**
 * Without BETTER_AUTH_URL, `farm dev` trusts the origin it is serving the
 * request on, so another port, the Android emulator's 10.0.2.2, or a LAN
 * device under `farm dev --host` can sign in. Only localhost, *.localhost, and
 * IP addresses qualify, so a DNS-rebinding hostname is never trusted, and a
 * page on another origin is still rejected.
 */
export function devServerOrigin(request?: Request): string[] {
  if (!request) return [];
  const url = new URL(request.url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const local = hostname === "localhost" || hostname.endsWith(".localhost") || isIP(hostname) !== 0;
  return local ? [url.origin] : [];
}

export const auth = betterAuth({
  appName: "FARMJS Better Auth Starter",
  // Development without BETTER_AUTH_URL uses the port farm.config.ts pins.
  baseURL: authBaseUrl ?? "http://localhost:3000",
  database: authDatabase,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  secret,
  trustedOrigins: authBaseUrl ? [new URL(authBaseUrl).origin] : devServerOrigin,
});
