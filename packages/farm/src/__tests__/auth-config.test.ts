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
});
