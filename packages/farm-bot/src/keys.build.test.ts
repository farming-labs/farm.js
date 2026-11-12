import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBotKeys, type BotKeysConfig } from "./keys";
import { verifyBotCheck } from "./verify";

vi.mock("./build-mode", () => ({ isProductionBuild: () => true }));

const config: BotKeysConfig = {
  name: "acme",
  secretKeyEnv: "ACME_SECRET_KEY",
  testKeys: { siteKey: "test-site", secretKey: "test-secret" },
};

beforeEach(() => {
  vi.stubEnv("ACME_SECRET_KEY", "");
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a production build started with NODE_ENV=development", () => {
  it("doesn't fall back to the test secret", () => {
    expect(() => createBotKeys(config).secretKey()).toThrowError(
      expect.objectContaining({ code: "missing_secret_key" }),
    );
  });

  it("refuses a configured test secret", () => {
    expect(() => createBotKeys(config, { secretKey: "test-secret" }).secretKey()).toThrowError(
      expect.objectContaining({ code: "test_key_in_production" }),
    );
  });

  it("still honors an explicit testKeys: true, for staging", () => {
    expect(createBotKeys(config, { testKeys: true }).secretKey()).toEqual({
      value: "test-secret",
      isTest: true,
    });
  });

  it("doesn't trust the request's host for the hostname check", async () => {
    const provider = { name: "acme", verify: vi.fn(async () => ({ success: true as const })) };
    const settings = { provider, hostnames: undefined, timeoutMs: 5000 };
    await expect(verifyBotCheck(settings, "token")).rejects.toMatchObject({
      code: "missing_hostnames",
    });
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
