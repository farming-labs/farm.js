import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { ResolvedFarmAuthConfig } from "./types.js";

const FARM_AUTH_STATE_KEY = Symbol.for("@farm.js/auth/runtime");
const CURRENT_REQUEST_RESOLVER_KEY = Symbol.for("farm.currentRequestResolver");
const loadNodeModule = createRequire(import.meta.url);

interface FarmAuthRuntimeOptions {
  root: string;
  mode: "development" | "production";
}

interface BetterAuthRuntime {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: { headers: Headers }): Promise<unknown>;
  };
}

interface RuntimeState {
  config?: ResolvedFarmAuthConfig;
  options?: FarmAuthRuntimeOptions;
  runtime?: Promise<BetterAuthRuntime>;
  /** Kept so the connection opened for the runtime can be closed again. */
  database?: unknown;
}

type GlobalAuthState = typeof globalThis & {
  [FARM_AUTH_STATE_KEY]?: RuntimeState;
  [CURRENT_REQUEST_RESOLVER_KEY]?: () => Request | undefined;
};

function getState(): RuntimeState {
  const runtime = globalThis as GlobalAuthState;
  runtime[FARM_AUTH_STATE_KEY] ||= {};
  return runtime[FARM_AUTH_STATE_KEY];
}

export function configureFarmAuth(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthRuntimeOptions,
): void {
  const state = getState();
  const changed =
    JSON.stringify(state.config) !== JSON.stringify(config) ||
    state.options?.root !== options.root ||
    state.options?.mode !== options.mode;

  state.config = config;
  state.options = options;
  if (changed) {
    const previous = state.database;
    state.runtime = undefined;
    state.database = undefined;
    if (previous) void closeDatabase(previous).catch(() => {});
  }
}

export async function getFarmAuthRuntime(): Promise<BetterAuthRuntime> {
  const state = getState();
  if (!state.config?.enabled || !state.options) {
    throw new Error(
      "Farm Auth is not enabled. Add `auth: true` to farm.config.ts before using @farm.js/auth.",
    );
  }

  if (!state.runtime) {
    const runtime = createRuntime(state.config, state.options, (database) => {
      // A dispose or reconfigure that raced this creation already closed what it
      // knew about, so an orphaned connection closes itself instead of leaking.
      if (state.runtime === runtime) {
        state.database = database;
      } else {
        void closeDatabase(database).catch(() => {});
      }
    });
    state.runtime = runtime;
    void runtime.catch(() => {
      if (state.runtime === runtime) {
        state.runtime = undefined;
        const database = state.database;
        state.database = undefined;
        if (database) void closeDatabase(database).catch(() => {});
      }
    });
  }
  return state.runtime;
}

export function getFarmAuthRequest(request?: Request): Request {
  if (request) return request;

  const current = (globalThis as GlobalAuthState)[CURRENT_REQUEST_RESOLVER_KEY]?.();
  if (!current) {
    throw new Error(
      "No current request is available. Farm Auth server helpers can only be used during a request, or with an explicit `request` option.",
    );
  }
  return current;
}

/**
 * Close the connection opened for the runtime and drop the cached instance.
 *
 * The runtime is cached on globalThis and its connection stays open for the life
 * of the process, which leaves a file lock behind on SQLite and a pool open on
 * every other driver. Call this from a teardown hook.
 */
export async function disposeFarmAuth(): Promise<void> {
  const state = getState();
  // Let an in-flight creation finish so its connection is registered and closed
  // here, instead of resolving before the handle even exists.
  if (state.runtime) await state.runtime.catch(() => {});
  const database = state.database;
  state.runtime = undefined;
  state.database = undefined;
  await closeDatabase(database);
}

export async function migrateFarmAuth(): Promise<void> {
  await withAuthMigrations(async (migrations) => {
    await migrations.runMigrations();
  });
}

/**
 * The statements `migrateFarmAuth` would run, for review before applying them.
 * Better Auth owns the schema, so the sql comes from its migrator rather than
 * from Farm's own table declarations.
 */
export async function compileFarmAuthMigration(): Promise<string> {
  return withAuthMigrations((migrations) => migrations.compileMigrations());
}

async function withAuthMigrations<T>(
  use: (migrations: {
    runMigrations: () => Promise<void>;
    compileMigrations: () => Promise<string>;
  }) => Promise<T>,
): Promise<T> {
  const state = getState();
  if (!state.config?.enabled || !state.options) {
    throw new Error("Farm Auth is not enabled in farm.config.ts.");
  }

  const options = await createBetterAuthOptions(state.config, state.options, {
    migration: true,
  });
  const { getMigrations } = await import("better-auth/db/migration");
  try {
    return await use(await getMigrations(options));
  } finally {
    await closeDatabase(options.database);
  }
}

async function createRuntime(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthRuntimeOptions,
  onDatabase: (database: unknown) => void,
): Promise<BetterAuthRuntime> {
  const authOptions = await createBetterAuthOptions(config, options);
  onDatabase(authOptions.database);

  if (options.mode === "development" && config.database.migrateInDevelopment) {
    const { getMigrations } = await import("better-auth/db/migration");
    const migrations = await getMigrations(authOptions);
    await migrations.runMigrations();
  }

  const { betterAuth } = await import("better-auth");
  return betterAuth(authOptions) as BetterAuthRuntime;
}

async function createBetterAuthOptions(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthRuntimeOptions,
  runtimeOptions: { migration?: boolean } = {},
): Promise<Record<string, unknown>> {
  const secret =
    process.env.FARM_AUTH_SECRET || process.env.AUTH_SECRET || process.env.BETTER_AUTH_SECRET;

  if (options.mode === "production" && !secret && !runtimeOptions.migration) {
    throw new Error(
      "Farm Auth requires FARM_AUTH_SECRET (or AUTH_SECRET) in production. Generate a random 32-byte secret and add it to your deployment environment.",
    );
  }

  return {
    appName: config.appName || "Farm app",
    baseURL: resolveFarmAuthBaseURL(options.mode),
    trustedOrigins: resolveFarmAuthTrustedOrigins(),
    basePath: config.basePath,
    secret: secret || "farm-auth-development-or-migration-secret",
    database: await createDatabase(config, options),
    emailAndPassword: {
      enabled: config.emailAndPassword.enabled,
      requireEmailVerification: config.emailAndPassword.requireEmailVerification,
      minPasswordLength: config.emailAndPassword.minPasswordLength,
      maxPasswordLength: config.emailAndPassword.maxPasswordLength,
    },
    session: {
      expiresIn: config.session.expiresIn,
      updateAge: config.session.updateAge,
    },
  };
}

/**
 * The origin Better Auth signs cookies and validates requests against.
 *
 * Better Auth trusts the baseURL's own origin and rejects everything else
 * with INVALID_ORIGIN, so this has to resolve to the host users actually
 * visit. Vercel exposes two: `VERCEL_URL` is unique per deployment
 * (`my-app-a1b2c3.vercel.app`) while `VERCEL_PROJECT_PRODUCTION_URL` is the
 * project's canonical domain. Pinning a production deployment to its
 * per-deployment hostname rejects every request arriving on the real domain,
 * so production prefers the canonical one and previews keep their own URL.
 */
export function resolveFarmAuthBaseURL(
  mode: "development" | "production",
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = env.FARM_AUTH_URL || env.BETTER_AUTH_URL;
  if (configured) return configured;

  const vercelHost =
    env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
      : env.VERCEL_URL;
  if (vercelHost) return toAbsoluteOrigin(vercelHost);

  return mode === "development" ? "http://localhost:3000" : undefined;
}

/**
 * Hosts that stay valid alongside the base URL.
 *
 * A production deployment is still reachable at its own deployment hostname,
 * and previews get a fresh one per build, so both are trusted explicitly
 * rather than leaving direct deployment-URL access broken.
 */
export function resolveFarmAuthTrustedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>();
  for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL]) {
    if (host) origins.add(toAbsoluteOrigin(host));
  }
  return [...origins];
}

function toAbsoluteOrigin(host: string): string {
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}

async function closeDatabase(database: unknown): Promise<void> {
  if (!database || typeof database !== "object") return;

  const connection = database as {
    close?: () => unknown;
    end?: () => unknown;
  };
  if (typeof connection.end === "function") {
    await connection.end();
    return;
  }
  if (typeof connection.close === "function") {
    await connection.close();
  }
}

async function createDatabase(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthRuntimeOptions,
): Promise<unknown> {
  const databaseUrl = config.database.url || process.env.DATABASE_URL;
  if (databaseUrl) {
    const { Pool } = await import("pg");
    return new Pool({ connectionString: databaseUrl });
  }

  if (options.mode === "production") {
    throw new Error(
      "Farm Auth requires DATABASE_URL in production. Config loading and `farm build` do not connect to the database; the connection is opened only by auth requests or `farm auth migrate`.",
    );
  }

  const databasePath = path.resolve(options.root, config.database.path);
  await mkdir(path.dirname(databasePath), { recursive: true });

  try {
    const { DatabaseSync } = loadNodeModule("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSync(databasePath);
  } catch {
    // node:sqlite is available on Node 22+. Keep the native package fallback
    // for supported older Node releases.
  }

  try {
    const imported = await import("better-sqlite3");
    const Database = imported.default;
    return new Database(databasePath);
  } catch (error) {
    throw new Error(
      `Farm Auth could not open its local SQLite database. Install better-sqlite3 or set DATABASE_URL. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
