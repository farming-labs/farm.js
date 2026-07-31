import { describe, expect, it } from "vitest";
import { resolveFarmAuthConfig } from "../src/config.js";

describe("resolveFarmAuthConfig", () => {
  it("enables email/password with safe defaults for auth: true", () => {
    expect(resolveFarmAuthConfig(true)).toEqual({
      enabled: true,
      appName: undefined,
      basePath: "/api/auth",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: false,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },
      session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
      },
      database: {
        url: undefined,
        path: ".farm/auth.sqlite",
        migrateInDevelopment: true,
      },
    });
  });

  it("supports the explicit enabled form and high-level overrides", () => {
    const config = resolveFarmAuthConfig({
      enabled: true,
      emailAndPassword: {
        requireEmailVerification: true,
        minPasswordLength: 12,
      },
      session: {
        expiresIn: 3600,
      },
    });

    expect(config.enabled).toBe(true);
    expect(config.emailAndPassword.requireEmailVerification).toBe(true);
    expect(config.emailAndPassword.minPasswordLength).toBe(12);
    expect(config.session.expiresIn).toBe(3600);
  });

  it("rejects invalid password ranges", () => {
    expect(() =>
      resolveFarmAuthConfig({
        emailAndPassword: {
          minPasswordLength: 20,
          maxPasswordLength: 10,
        },
      }),
    ).toThrow(/maxPasswordLength/);
  });
});
