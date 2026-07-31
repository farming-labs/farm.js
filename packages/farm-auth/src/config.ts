import type { FarmAuthUserConfig, ResolvedFarmAuthConfig } from "./types.js";

const DEFAULT_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const DEFAULT_SESSION_UPDATE_AGE = 60 * 60 * 24;

export function resolveFarmAuthConfig(
  input: FarmAuthUserConfig | undefined,
): ResolvedFarmAuthConfig {
  if (input === false || input === undefined) {
    return {
      enabled: false,
      basePath: "/api/auth",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },
      session: {
        expiresIn: DEFAULT_SESSION_EXPIRES_IN,
        updateAge: DEFAULT_SESSION_UPDATE_AGE,
      },
      database: {
        path: ".farm/auth.sqlite",
        migrateInDevelopment: true,
      },
    };
  }

  const config = input === true ? {} : input;
  const passwordConfig = typeof config.emailAndPassword === "object" ? config.emailAndPassword : {};
  const basePath = normalizeBasePath(config.basePath);

  const resolved: ResolvedFarmAuthConfig = {
    enabled: config.enabled !== false,
    appName: config.appName,
    basePath,
    emailAndPassword: {
      enabled: config.emailAndPassword !== false,
      requireEmailVerification: passwordConfig.requireEmailVerification ?? false,
      minPasswordLength: passwordConfig.minPasswordLength ?? 8,
      maxPasswordLength: passwordConfig.maxPasswordLength ?? 128,
    },
    session: {
      expiresIn: config.session?.expiresIn ?? DEFAULT_SESSION_EXPIRES_IN,
      updateAge: config.session?.updateAge ?? DEFAULT_SESSION_UPDATE_AGE,
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

function normalizeBasePath(value: string | undefined): string {
  const path = (value || "/api/auth").trim();
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
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
