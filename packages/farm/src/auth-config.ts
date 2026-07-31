import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmIntegration } from "./integrations";

export interface FarmAuthEmailAndPasswordConfig {
  /** Require a verified email before creating a session. @default false */
  requireEmailVerification?: boolean;
  /** Smallest accepted password length. @default 8 */
  minPasswordLength?: number;
  /** Largest accepted password length. @default 128 */
  maxPasswordLength?: number;
}

export interface FarmAuthSessionConfig {
  /** Session lifetime in seconds. @default 604800 */
  expiresIn?: number;
  /** Session refresh interval in seconds. @default 86400 */
  updateAge?: number;
}

export interface FarmAuthDatabaseConfig {
  /**
   * Postgres connection string. Defaults to DATABASE_URL.
   * Local development falls back to SQLite when no URL is present.
   */
  url?: string;
  /** Local SQLite path. @default ".farm/auth.sqlite" */
  path?: string;
  /** Automatically update the auth schema in development. @default true */
  migrateInDevelopment?: boolean;
}

export interface FarmAuthConfig {
  /** Set false to disable auth without removing its configuration. @default true */
  enabled?: boolean;
  /** Display name used by authentication emails and metadata. */
  appName?: string;
  /** Route prefix for the auth endpoints. @default "/api/auth" */
  basePath?: string;
  /**
   * Email/password authentication. It is enabled by default; set false to
   * disable it when adding another sign-in method.
   */
  emailAndPassword?: boolean | FarmAuthEmailAndPasswordConfig;
  session?: FarmAuthSessionConfig;
  database?: FarmAuthDatabaseConfig;
}

export type FarmAuthUserConfig = boolean | FarmAuthConfig;

export interface ResolvedFarmAuthConfig {
  enabled: boolean;
  appName?: string;
  basePath: string;
  emailAndPassword: {
    enabled: boolean;
    requireEmailVerification: boolean;
    minPasswordLength: number;
    maxPasswordLength: number;
  };
  session: {
    expiresIn: number;
    updateAge: number;
  };
  database: {
    url?: string;
    path: string;
    migrateInDevelopment: boolean;
  };
}

interface FarmAuthRuntimeModule {
  createFarmAuthIntegration(
    config: ResolvedFarmAuthConfig,
    options: {
      root: string;
      mode: "development" | "production";
    },
  ): FarmIntegration;
}

export function resolveFarmAuthConfig(
  input: FarmAuthUserConfig | undefined,
): ResolvedFarmAuthConfig {
  const config = input === true ? {} : input && typeof input === "object" ? input : {};
  const passwordConfig = typeof config.emailAndPassword === "object" ? config.emailAndPassword : {};

  const resolved: ResolvedFarmAuthConfig = {
    enabled: input !== undefined && input !== false && config.enabled !== false,
    appName: config.appName,
    basePath: normalizeBasePath(config.basePath),
    emailAndPassword: {
      enabled: config.emailAndPassword !== false,
      requireEmailVerification: passwordConfig.requireEmailVerification ?? false,
      minPasswordLength: passwordConfig.minPasswordLength ?? 8,
      maxPasswordLength: passwordConfig.maxPasswordLength ?? 128,
    },
    session: {
      expiresIn: config.session?.expiresIn ?? 60 * 60 * 24 * 7,
      updateAge: config.session?.updateAge ?? 60 * 60 * 24,
    },
    database: {
      url: config.database?.url,
      path: config.database?.path || ".farm/auth.sqlite",
      migrateInDevelopment: config.database?.migrateInDevelopment ?? true,
    },
  };

  validateFarmAuthConfig(resolved);
  return resolved;
}

export async function resolveFarmAuthIntegration(
  config: ResolvedFarmAuthConfig,
  options: {
    root: string;
    mode: "development" | "production";
  },
): Promise<FarmIntegration | undefined> {
  if (!config.enabled) return undefined;

  const root = path.resolve(options.root);
  let modulePath: string;
  try {
    const resolveFromApp = createRequire(path.join(root, "package.json"));
    modulePath = resolveFromApp.resolve("@farm.js/auth/internal");
  } catch {
    throw new Error(
      "The `auth` config requires @farm.js/auth. Install it with `pnpm add @farm.js/auth` and try again.",
    );
  }

  const runtime = (await import(
    /* @vite-ignore */ pathToFileURL(modulePath).href
  )) as FarmAuthRuntimeModule;
  if (typeof runtime.createFarmAuthIntegration !== "function") {
    throw new Error(
      "The installed @farm.js/auth package is incompatible with this version of @farm.js/core.",
    );
  }

  return runtime.createFarmAuthIntegration(config, {
    ...options,
    root,
  });
}

function normalizeBasePath(value: string | undefined): string {
  const route = (value || "/api/auth").trim();
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized || "/api/auth";
}

function validateFarmAuthConfig(config: ResolvedFarmAuthConfig): void {
  const { minPasswordLength, maxPasswordLength } = config.emailAndPassword;
  if (!Number.isInteger(minPasswordLength) || minPasswordLength < 1) {
    throw new Error("auth.emailAndPassword.minPasswordLength must be a positive integer.");
  }
  if (!Number.isInteger(maxPasswordLength) || maxPasswordLength < minPasswordLength) {
    throw new Error(
      "auth.emailAndPassword.maxPasswordLength must be an integer greater than or equal to minPasswordLength.",
    );
  }
  if (!Number.isInteger(config.session.expiresIn) || config.session.expiresIn < 1) {
    throw new Error("auth.session.expiresIn must be a positive integer.");
  }
  if (!Number.isInteger(config.session.updateAge) || config.session.updateAge < 0) {
    throw new Error("auth.session.updateAge must be a non-negative integer.");
  }
}
