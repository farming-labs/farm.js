import { isProductionBuild } from "./build-mode.js";
import { BotError } from "./errors.js";

/** What an app can pass to a provider. Every provider built on `createBotKeys` takes these. */
export interface BotProviderKeys {
  /** The public site key. Read from the environment at build time when omitted. */
  siteKey?: string;
  /** The server-only secret. Read from the environment on every check when omitted. */
  secretKey?: string;
  /**
   * Fall back to the provider's always-passing test keys when a key is missing, and accept
   * checks made with them. Defaults to `true` when `NODE_ENV` is `development` or `test`. A
   * server in any other environment refuses test keys, so a missing key fails instead.
   */
  testKeys?: boolean;
}

export interface BotKeysConfig {
  /** The provider's name, as the app calls it: `acme` for `acme()`. Used in error messages. */
  name: string;
  /** The environment variable holding the site key. */
  siteKeyEnv?: string;
  /** The environment variable holding the secret key. */
  secretKeyEnv?: string;
  /** Always-passing keys the provider publishes. Without them, development needs real keys. */
  testKeys?: {
    siteKey: string;
    secretKey: string;
    /** Defaults to an exact match on `secretKey`. */
    isTestSecret?: (secret: string) => boolean;
  };
}

export interface BotKeys {
  /** The key for the browser. Call it from `client()`. Throws a `BotError` when it's missing. */
  siteKey(): string;
  /** The secret. Call it from `verify`, so it's read on the server that runs the check. */
  secretKey(): { value: string; isTest: boolean };
}

// Workers keep bindings on `__env__`, or on `process.env` from compatibility date 2025-04-01.
function readEnv(name: string): string | undefined {
  const bindings = (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const bound = bindings && typeof bindings === "object" ? bindings[name] : undefined;
  if (typeof bound === "string") return bound;
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

// A test secret passes every visitor, so a server that doesn't say what it is gets none, as on
// a deployed worker where `NODE_ENV` is often unset. A built server can't be started into test
// keys either, whatever its `NODE_ENV`. The hostname check uses the same rule for its default.
export function isDevelopment(): boolean {
  if (isProductionBuild()) return false;
  const mode = readEnv("NODE_ENV");
  return mode === "development" || mode === "test";
}

/**
 * Read a provider's keys the way the built-in providers do: from the app's options or the
 * environment, including Cloudflare bindings, and never accepting a test key in production.
 */
export function createBotKeys(config: BotKeysConfig, keys: BotProviderKeys = {}): BotKeys {
  const { name, siteKeyEnv, secretKeyEnv, testKeys } = config;

  for (const key of ["siteKey", "secretKey"] as const) {
    const value = keys[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      throw new TypeError(`${name}() \`${key}\` must be a non-empty string.`);
    }
  }
  if (keys.testKeys !== undefined && typeof keys.testKeys !== "boolean") {
    throw new TypeError(`${name}() \`testKeys\` must be a boolean.`);
  }

  // Read per use, not at creation: the same object runs at build time and in the server.
  const testSecretAllowed = () => testKeys !== undefined && (keys.testKeys ?? isDevelopment());

  // Config only loads under the CLI: `farm build` sets production, `farm dev` may set nothing yet.
  const testSiteKeyAllowed = () =>
    testKeys !== undefined && (keys.testKeys ?? readEnv("NODE_ENV") !== "production");

  const isTestSecret = (secret: string) =>
    testKeys !== undefined && (testKeys.isTestSecret?.(secret) ?? secret === testKeys.secretKey);

  return {
    siteKey() {
      const configured = keys.siteKey ?? (siteKeyEnv ? readEnv(siteKeyEnv) : undefined);
      if (configured) return configured;
      if (testSiteKeyAllowed()) return testKeys!.siteKey;
      const setEnv = siteKeyEnv ? `Set \`${siteKeyEnv}\` before building, or pass` : "Pass";
      throw new BotError(
        "missing_site_key",
        `${setEnv} \`siteKey\` to \`${name}()\`. The site key is public and is compiled into the browser bundle.`,
      );
    },

    secretKey() {
      const configured = keys.secretKey ?? (secretKeyEnv ? readEnv(secretKeyEnv) : undefined);
      if (!configured) {
        if (testSecretAllowed()) return { value: testKeys!.secretKey, isTest: true };
        const setEnv = secretKeyEnv
          ? `Set \`${secretKeyEnv}\` in the server environment, or pass`
          : "Pass";
        throw new BotError("missing_secret_key", `${setEnv} \`secretKey\` to \`${name}()\`.`);
      }
      const isTest = isTestSecret(configured);
      if (isTest && !testSecretAllowed()) {
        throw new BotError(
          "test_key_in_production",
          `\`${secretKeyEnv ?? "secretKey"}\` is ${name}'s test key, which passes every visitor. Set your real secret key, or pass \`testKeys: true\` to \`${name}()\` for a staging deployment.`,
        );
      }
      return { value: configured, isTest };
    },
  };
}
