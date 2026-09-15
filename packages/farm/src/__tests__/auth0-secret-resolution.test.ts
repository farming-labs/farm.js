// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auth0 } from "../../../farm-auth0/src/index";

// resolveEnv runs when auth0() is called (config evaluation). The built server
// re-evaluates farm.config.ts at runtime, where Farm does not force
// NODE_ENV=production, so the secret resolution must fail closed on an absent
// NODE_ENV rather than fall back to the public development secret.
const AUTH0_ENV_KEYS = [
  "NODE_ENV",
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of AUTH0_ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of AUTH0_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setBaseAuth0Env(): void {
  process.env.AUTH0_DOMAIN = "tenant.us.auth0.com";
  process.env.AUTH0_CLIENT_ID = "client_test";
  delete process.env.AUTH0_SECRET;
}

describe("auth0 secret resolution", () => {
  it("requires an explicit secret when NODE_ENV is unset (production runtime)", () => {
    setBaseAuth0Env();
    delete process.env.NODE_ENV;

    expect(() => auth0()).toThrow(/AUTH0_SECRET/);
  });

  it("requires an explicit secret in production", () => {
    setBaseAuth0Env();
    process.env.NODE_ENV = "production";

    expect(() => auth0()).toThrow(/AUTH0_SECRET/);
  });

  it("does not fall back to the development secret for an unknown NODE_ENV", () => {
    setBaseAuth0Env();
    process.env.NODE_ENV = "staging";

    expect(() => auth0()).toThrow(/AUTH0_SECRET/);
  });

  it("allows the development fallback secret only for explicit dev/test", () => {
    setBaseAuth0Env();
    for (const mode of ["development", "test"]) {
      process.env.NODE_ENV = mode;
      expect(() => auth0()).not.toThrow();
    }
  });

  it("accepts an explicit secret regardless of NODE_ENV", () => {
    setBaseAuth0Env();
    process.env.AUTH0_SECRET = "a-real-32-byte-secret-value-000000";
    delete process.env.NODE_ENV;

    expect(() => auth0()).not.toThrow();
  });

  it("prefers an inline secret over environment resolution", () => {
    setBaseAuth0Env();
    delete process.env.NODE_ENV;

    expect(() => auth0({ secret: "inline-secret-value-000000000000" })).not.toThrow();
  });
});
