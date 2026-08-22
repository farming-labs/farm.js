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

  state.runtime ||= createRuntime(state.config, state.options);
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
  const database = state.database;
  state.runtime = undefined;
  state.database = undefined;
  await closeDatabase(database);
}

export async function migrateFarmAuth(): Promise<void> {
  const state = getState();
  if (!state.config?.enabled || !state.options) {
    throw new Error("Farm Auth is not enabled in farm.config.ts.");
  }

  const options = await createBetterAuthOptions(state.config, state.options, {
    migration: true,
  });
  const { getMigrations } = await import("better-auth/db/migration");
  try {
    const migrations = await getMigrations(options);
    await migrations.runMigrations();
  } finally {
    await closeDatabase(options.database);
  }
}

async function createRuntime(
  config: ResolvedFarmAuthConfig,
  options: FarmAuthRuntimeOptions,
): Promise<BetterAuthRuntime> {
  const authOptions = await createBetterAuthOptions(config, options);
  getState().database = authOptions.database;

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
    baseURL: resolveBaseURL(options.mode),
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

function resolveBaseURL(mode: "development" | "production"): string | undefined {
  const configured = process.env.FARM_AUTH_URL || process.env.BETTER_AUTH_URL;
  if (configured) return configured;

  if (process.env.VERCEL_URL) {
    return process.env.VERCEL_URL.startsWith("http")
      ? process.env.VERCEL_URL
      : `https://${process.env.VERCEL_URL}`;
  }

  return mode === "development" ? "http://localhost:3000" : undefined;
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
