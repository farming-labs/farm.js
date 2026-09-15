import { describe, expect, it, vi } from "vitest";
import { resolveIntegrationSessionSecret } from "../integrations";

describe("resolveIntegrationSessionSecret", () => {
  const base = { integration: "example", envVar: "EXAMPLE_SECRET" } as const;

  it("prefers an explicit configured secret over everything", () => {
    expect(
      resolveIntegrationSessionSecret({
        ...base,
        configured: "explicit",
        env: "from-env",
        isProduction: true,
      }),
    ).toBe("explicit");
  });

  it("uses the first non-empty environment value", () => {
    expect(
      resolveIntegrationSessionSecret({
        ...base,
        env: [undefined, "", "second-env"],
        isProduction: true,
      }),
    ).toBe("second-env");
  });

  it("requires a secret in production when none is configured", () => {
    expect(() => resolveIntegrationSessionSecret({ ...base, isProduction: true })).toThrow(
      /requires EXAMPLE_SECRET in production/,
    );
  });

  it("never falls back to a fixed constant in development", () => {
    const warn = vi.fn();
    const secret = resolveIntegrationSessionSecret({
      integration: "dev-random",
      envVar: "EXAMPLE_SECRET",
      isProduction: false,
      warn,
    });
    // The published constants the fix removed. The fallback must be neither.
    expect(secret).not.toBe("farmjs-auth0-development-secret-2026");
    expect(secret).not.toBe("farmjs-workos-cookie-password-development-2026");
    // A 32-byte hex secret is unguessable, unlike a value shipped in the repo.
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is stable per integration but unique across integrations", () => {
    const a1 = resolveIntegrationSessionSecret({
      integration: "stable-a",
      envVar: "A",
      isProduction: false,
      warn: () => {},
    });
    const a2 = resolveIntegrationSessionSecret({
      integration: "stable-a",
      envVar: "A",
      isProduction: false,
      warn: () => {},
    });
    const b1 = resolveIntegrationSessionSecret({
      integration: "stable-b",
      envVar: "B",
      isProduction: false,
      warn: () => {},
    });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it("warns only once per integration", () => {
    const warn = vi.fn();
    const options = {
      integration: "warn-once",
      envVar: "WARN_ONCE",
      isProduction: false,
      warn,
    } as const;
    resolveIntegrationSessionSecret(options);
    resolveIntegrationSessionSecret(options);
    expect(warn).toHaveBeenCalledOnce();
  });
});
