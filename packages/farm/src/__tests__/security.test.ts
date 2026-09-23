import { describe, expect, it } from "vitest";
import {
  farmCspBlocksFrameworkInlineScripts,
  getFarmSecurityHeader,
  resolveFarmSecurityConfig,
  serializeFarmCspDirectives,
} from "../security";

describe("security.csp", () => {
  it("serializes camelCase directives without changing source expressions", () => {
    expect(
      serializeFarmCspDirectives({
        defaultSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: true,
      }),
    ).toBe("default-src 'self'; object-src 'none'; upgrade-insecure-requests");
  });

  it("resolves an enforcing policy string", () => {
    const security = resolveFarmSecurityConfig({
      csp: "default-src 'self'; object-src 'none';",
    });

    expect(getFarmSecurityHeader(security)).toEqual({
      key: "Content-Security-Policy",
      value: "default-src 'self'; object-src 'none'",
    });
  });

  it("supports report-only directives", () => {
    const security = resolveFarmSecurityConfig({
      csp: {
        reportOnly: true,
        directives: {
          defaultSrc: ["'self'"],
          reportTo: ["csp-endpoint"],
        },
      },
    });

    expect(getFarmSecurityHeader(security)).toEqual({
      key: "Content-Security-Policy-Report-Only",
      value: "default-src 'self'; report-to csp-endpoint",
    });
  });

  it("revalidates resolved policy values", () => {
    expect(
      resolveFarmSecurityConfig({
        csp: { value: "default-src 'self';", reportOnly: true },
      }),
    ).toEqual({
      csp: { value: "default-src 'self'", reportOnly: true },
    });

    expect(() =>
      resolveFarmSecurityConfig({
        csp: { value: "default-src 'self'\r\nX-Test: yes", reportOnly: false },
      }),
    ).toThrow(/single-line/);
  });

  it("rejects the long-form config key with an actionable diagnostic", () => {
    expect(() => resolveFarmSecurityConfig({ contentSecurityPolicy: true } as never)).toThrow(
      /Use security\.csp instead/,
    );
  });

  it("rejects duplicate directives and header injection", () => {
    expect(() =>
      serializeFarmCspDirectives({ defaultSrc: ["'self'"], "default-src": ["https:"] }),
    ).toThrow(/duplicate directive/);
    expect(() => resolveFarmSecurityConfig({ csp: "default-src 'self'\r\nX-Test: yes" })).toThrow(
      /single-line/,
    );
    expect(() => serializeFarmCspDirectives({ reportUri: ["/csp; object-src *"] })).toThrow(
      /Invalid security\.csp directive value/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: "" })).toThrow(/non-empty/);
  });

  it("rejects malformed runtime option shapes with actionable errors", () => {
    expect(() => resolveFarmSecurityConfig({ csp: null } as never)).toThrow(
      /policy string, false, or an options object/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: { policy: 42 } } as never)).toThrow(
      /non-empty single-line string/,
    );
    expect(() => resolveFarmSecurityConfig({ csp: { directives: null } } as never)).toThrow(
      /directives must be an object/,
    );
    expect(() =>
      resolveFarmSecurityConfig({
        csp: { policy: "default-src 'self'", reportOnly: "yes" },
      } as never),
    ).toThrow(/reportOnly must be a boolean/);
  });
});

describe("farmCspBlocksFrameworkInlineScripts", () => {
  const blocks = (csp: string) =>
    farmCspBlocksFrameworkInlineScripts(resolveFarmSecurityConfig({ csp }));

  it("flags a script-src allowlist with no inline mechanism", () => {
    expect(blocks("script-src 'self' https://cdn.example.com")).toBe(true);
  });

  it("flags default-src when script-src is absent", () => {
    expect(blocks("default-src 'self'")).toBe(true);
  });

  it("does not flag 'unsafe-inline'", () => {
    expect(blocks("script-src 'self' 'unsafe-inline'")).toBe(false);
  });

  it("does not flag a nonce or hash source", () => {
    expect(blocks("script-src 'self' 'nonce-abc123'")).toBe(false);
    expect(blocks("script-src 'self' 'sha256-abcd'")).toBe(false);
  });

  it("prefers script-src over default-src", () => {
    // default-src would block, but the explicit script-src allows inline.
    expect(blocks("default-src 'self'; script-src 'self' 'unsafe-inline'")).toBe(false);
    // and the reverse: permissive default, restrictive script-src.
    expect(blocks("default-src 'unsafe-inline'; script-src 'self'")).toBe(true);
  });

  it("does not flag a policy that governs no scripts", () => {
    expect(blocks("img-src 'self'; style-src 'self'")).toBe(false);
  });

  it("does not flag when CSP is disabled", () => {
    expect(farmCspBlocksFrameworkInlineScripts(resolveFarmSecurityConfig(undefined))).toBe(false);
  });
});
