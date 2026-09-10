import { describe, expect, it } from "vitest";
import { resolveFarmAuthConfig } from "../auth-config";

describe("Farm auth config", () => {
  it("stays disabled when omitted", () => {
    expect(resolveFarmAuthConfig(undefined).enabled).toBe(false);
  });

  it("enables email/password for the boolean shorthand", () => {
    const config = resolveFarmAuthConfig(true);

    expect(config.enabled).toBe(true);
    expect(config.basePath).toBe("/api/auth");
    expect(config.emailAndPassword.enabled).toBe(true);
    expect(config.emailAndPassword.minPasswordLength).toBe(8);
  });

  it("supports auth: { enabled: true }", () => {
    expect(resolveFarmAuthConfig({ enabled: true }).enabled).toBe(true);
  });

  it("rejects base paths that URL parsing could reinterpret", () => {
    for (const basePath of [
      "//example.com/auth",
      "https://example.com/auth",
      "/api/../auth",
      "/api/%2e%2e/auth",
      "/api%2fauth",
      "/api\\auth",
      "/api\u0000auth",
      "/api/auth?tenant=farm",
      "/api/auth#sign-in",
    ]) {
      expect(() => resolveFarmAuthConfig({ basePath })).toThrow();
    }
  });
});
