import { afterEach, describe, expect, it, vi } from "vitest";
import { BotError } from "./errors";
import { createBotKeys, type BotKeysConfig } from "./keys";

const config: BotKeysConfig = {
  name: "acme",
  siteKeyEnv: "ACME_SITE_KEY",
  secretKeyEnv: "ACME_SECRET_KEY",
  testKeys: { siteKey: "test-site", secretKey: "test-secret" },
};

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as { __env__?: unknown }).__env__;
});

describe("createBotKeys", () => {
  it("prefers the app's options, then the environment", () => {
    vi.stubEnv("ACME_SITE_KEY", "from-env");
    vi.stubEnv("ACME_SECRET_KEY", "env-secret");
    expect(createBotKeys(config).siteKey()).toBe("from-env");
    expect(createBotKeys(config).secretKey()).toEqual({ value: "env-secret", isTest: false });

    const keys = createBotKeys(config, { siteKey: "option", secretKey: "option-secret" });
    expect(keys.siteKey()).toBe("option");
    expect(keys.secretKey().value).toBe("option-secret");
  });

  it("reads Cloudflare bindings, where a custom provider's `process.env` finds nothing", () => {
    vi.stubEnv("NODE_ENV", "production");
    (globalThis as { __env__?: unknown }).__env__ = { ACME_SECRET_KEY: "bound" };
    expect(createBotKeys(config).secretKey().value).toBe("bound");
  });

  it("uses the published test keys in development and says so", () => {
    vi.stubEnv("NODE_ENV", "development");
    const keys = createBotKeys(config);
    expect(keys.siteKey()).toBe("test-site");
    expect(keys.secretKey()).toEqual({ value: "test-secret", isTest: true });
  });

  it("refuses a missing or test secret outside development, naming the variable", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createBotKeys(config).secretKey()).toThrowError(
      expect.objectContaining({
        code: "missing_secret_key",
        message: expect.stringContaining("ACME_SECRET_KEY"),
      }),
    );

    vi.stubEnv("ACME_SECRET_KEY", "test-secret");
    expect(() => createBotKeys(config).secretKey()).toThrowError(
      expect.objectContaining({ code: "test_key_in_production" }),
    );
    expect(createBotKeys(config, { testKeys: true }).secretKey().isTest).toBe(true);
  });

  it("refuses when NODE_ENV is unset, as on a deployed worker", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(() => createBotKeys(config).secretKey()).toThrow(BotError);
  });

  it("refuses a missing site key in a production build, naming the variable", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createBotKeys(config).siteKey()).toThrowError(
      expect.objectContaining({
        code: "missing_site_key",
        message: expect.stringContaining("ACME_SITE_KEY"),
      }),
    );
  });

  it("works for a checker with no environment variables or test keys", () => {
    vi.stubEnv("NODE_ENV", "development");
    const keys = createBotKeys({ name: "acme" });
    expect(() => keys.siteKey()).toThrowError(/Pass `siteKey` to `acme\(\)`/);
    expect(() => keys.secretKey()).toThrowError(/Pass `secretKey` to `acme\(\)`/);
  });

  it("rejects invalid options when the provider is created", () => {
    expect(() => createBotKeys(config, { secretKey: " " })).toThrow(/non-empty/);
    expect(() => createBotKeys(config, { testKeys: "yes" as never })).toThrow(/boolean/);
  });
});
