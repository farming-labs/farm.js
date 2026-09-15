// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workos } from "../../../farm-workos/src/index";

// resolveEnv runs when workos() is called (config evaluation). The built server
// re-evaluates farm.config.ts at runtime, where Farm does not force
// NODE_ENV=production, so the cookie-password resolution must fail closed on an
// absent NODE_ENV rather than fall back to the public development password.
const WORKOS_ENV_KEYS = [
  "NODE_ENV",
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "FARM_WORKOS_COOKIE_PASSWORD",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of WORKOS_ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of WORKOS_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setBaseWorkOSEnv(): void {
  process.env.WORKOS_CLIENT_ID = "client_test";
  process.env.WORKOS_API_KEY = "sk_test";
  delete process.env.WORKOS_COOKIE_PASSWORD;
  delete process.env.FARM_WORKOS_COOKIE_PASSWORD;
}

describe("workos cookie password resolution", () => {
  it("requires an explicit cookie password when NODE_ENV is unset (production runtime)", () => {
    setBaseWorkOSEnv();
    delete process.env.NODE_ENV;

    expect(() => workos()).toThrow(/WORKOS_COOKIE_PASSWORD/);
  });

  it("requires an explicit cookie password in production", () => {
    setBaseWorkOSEnv();
    process.env.NODE_ENV = "production";

    expect(() => workos()).toThrow(/WORKOS_COOKIE_PASSWORD/);
  });

  it("does not fall back to the development password for an unknown NODE_ENV", () => {
    setBaseWorkOSEnv();
    process.env.NODE_ENV = "staging";

    expect(() => workos()).toThrow(/WORKOS_COOKIE_PASSWORD/);
  });

  it("allows the development fallback password only for explicit dev/test", () => {
    setBaseWorkOSEnv();
    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;
      expect(() => workos()).not.toThrow();
    }
  });

  it("accepts an explicit cookie password regardless of NODE_ENV", () => {
    setBaseWorkOSEnv();
    process.env.WORKOS_COOKIE_PASSWORD = "a-real-32-byte-cookie-password-000";
    delete process.env.NODE_ENV;

    expect(() => workos()).not.toThrow();
  });

  it("prefers an inline cookie password over environment resolution", () => {
    setBaseWorkOSEnv();
    delete process.env.NODE_ENV;

    expect(() => workos({ cookiePassword: "inline-cookie-password-000000000000" })).not.toThrow();
  });
});
