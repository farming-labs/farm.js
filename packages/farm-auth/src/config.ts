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
  const route = (value || "/api/auth").trim();
  if (!route) return "/api/auth";
  assertStableBasePath(route);
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  const normalized = withLeadingSlash.replace(/\/+/g, "/").replace(/\/+$/, "");
  return normalized || "/api/auth";
}

function assertStableBasePath(route: string): void {
  if (route.includes("?") || route.includes("#")) {
    throw new Error("auth.basePath cannot contain a query string or fragment.");
  }
  if (route.startsWith("//") || /^[a-z][a-z\d+.-]*:\/\//i.test(route)) {
    throw new Error('auth.basePath must be an application pathname such as "/api/auth".');
  }
  if (hasUnstablePathCharacters(route)) {
    throw new Error("auth.basePath cannot contain backslashes or control characters.");
  }
  for (const segment of route.split("/")) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escapes remain literal URL pathname segments.
    }
    if (hasUnstablePathCharacters(decoded) || decoded.includes("/")) {
      throw new Error("auth.basePath cannot contain encoded path separators.");
    }
    if (decoded === "." || decoded === "..") {
      throw new Error('auth.basePath cannot contain "." or ".." path segments.');
    }
  }
}

function hasUnstablePathCharacters(value: string): boolean {
  return (
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  );
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
