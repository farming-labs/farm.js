// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearRequestCookie,
  createRequestCookie,
  getCookieValue,
  parseCookieHeaderList,
  parseCookieHeaderMap,
} from "../../../farm-integration-utils/src/cookies";
import {
  getReturnTo,
  resolveAppPath,
  toAbsoluteUrl,
} from "../../../farm-integration-utils/src/url";

describe("getReturnTo open-redirect hardening", () => {
  it("keeps ordinary root-relative paths", () => {
    expect(getReturnTo("/dashboard", "/")).toBe("/dashboard");
    expect(getReturnTo("/a/b?c=1#d", "/")).toBe("/a/b?c=1#d");
    expect(getReturnTo("/", "/fallback")).toBe("/");
  });

  it("rejects protocol-relative and backslash targets that resolve off-origin", () => {
    for (const evil of [
      "//evil.com",
      "/\\evil.com",
      "/\\/evil.com",
      "//evil.com/path",
      "/\t/evil.com",
      "/\r/evil.com",
      "/\n/evil.com",
    ]) {
      expect(getReturnTo(evil, "/dashboard")).toBe("/dashboard");
      // The whole point: the rejected value must not resolve to a foreign origin.
      const resolved = new URL(getReturnTo(evil, "/dashboard"), "https://app.example.com");
      expect(resolved.origin).toBe("https://app.example.com");
    }
  });

  it("rejects absolute URLs and empty values", () => {
    expect(getReturnTo("https://evil.com", "/dashboard")).toBe("/dashboard");
    expect(getReturnTo("javascript:alert(1)", "/dashboard")).toBe("/dashboard");
    expect(getReturnTo("", "/dashboard")).toBe("/dashboard");
    expect(getReturnTo(null, "/dashboard")).toBe("/dashboard");
    expect(getReturnTo(undefined)).toBe("/");
  });
});

describe("resolveAppPath open-redirect hardening", () => {
  it("keeps same-origin application paths", () => {
    const request = new Request("https://app.example.com/account");
    const path = resolveAppPath("/billing/success?plan=pro", "Checkout successPath");

    expect(path).toBe("/billing/success?plan=pro");
    expect(toAbsoluteUrl(path!, request).origin).toBe("https://app.example.com");
  });

  it("rejects path forms that browsers resolve to another origin", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\r/evil.example",
      "/\n/evil.example",
    ]) {
      expect(() => resolveAppPath(value, "Checkout successPath")).toThrow(
        "same-origin root-relative path",
      );
    }
  });
});

describe("cookie parsing tolerates malformed percent-encoding", () => {
  it("decodes valid values and falls back to raw for invalid ones", () => {
    const map = parseCookieHeaderMap("good=%41; bad=%zz; partial=%; sid=abc123");
    expect(map.good).toBe("A");
    expect(map.bad).toBe("%zz");
    expect(map.partial).toBe("%");
    expect(map.sid).toBe("abc123");
  });

  it("does not throw when a single cookie is malformed", () => {
    expect(() => parseCookieHeaderMap("session=%E9%; other=ok")).not.toThrow();
    const headers = new Headers({ cookie: "auth=%C3%28; keep=value" });
    expect(getCookieValue(headers, "auth")).toBe("%C3%28");
    expect(getCookieValue(headers, "keep")).toBe("value");
  });
});

describe("cookie parsing ignores object prototype properties", () => {
  it("returns null for absent prototype-named cookies", () => {
    const headers = new Headers({ cookie: "session=abc123" });

    expect(getCookieValue(headers, "constructor")).toBeNull();
    expect(getCookieValue(headers, "toString")).toBeNull();
    expect(getCookieValue(headers, "hasOwnProperty")).toBeNull();
  });

  it("preserves explicitly provided prototype-named cookies", () => {
    const headers = new Headers({
      cookie: "constructor=ctor; toString=string; hasOwnProperty=own",
    });

    expect(getCookieValue(headers, "constructor")).toBe("ctor");
    expect(getCookieValue(headers, "toString")).toBe("string");
    expect(getCookieValue(headers, "hasOwnProperty")).toBe("own");
  });

  it("creates parsed maps without inherited entries", () => {
    const cookies = parseCookieHeaderMap("session=abc123");

    expect(Object.getPrototypeOf(cookies)).toBeNull();
    expect(cookies["constructor"]).toBeUndefined();
  });
});

describe("integration request-cookie duplicate handling", () => {
  const header = "sid=path-specific; theme=dark; sid=domain-wide";

  it("preserves every cookie in wire order for Supabase getAll", () => {
    expect(parseCookieHeaderList(header)).toEqual([
      { name: "sid", value: "path-specific" },
      { name: "theme", value: "dark" },
      { name: "sid", value: "domain-wide" },
    ]);
  });

  it("uses the first value for Auth0 map lookup", () => {
    expect(parseCookieHeaderMap(header).sid).toBe("path-specific");
  });

  it("uses the first value for WorkOS single-cookie lookup", () => {
    expect(getCookieValue(new Headers({ cookie: header }), "sid")).toBe("path-specific");
  });
});

describe("integration request-cookie serialization", () => {
  const httpRequest = new Request("http://localhost:3000/auth/callback");

  it("forces Secure for SameSite=None on an http request", () => {
    // A browser rejects SameSite=None without Secure, so the cookie would
    // never be stored in local development.
    const header = createRequestCookie("state", "value", httpRequest, { sameSite: "None" });

    expect(header).toContain("SameSite=None");
    expect(header).toContain("Secure");
    expect(
      createRequestCookie("state", "value", httpRequest, { sameSite: "None", secure: false }),
    ).toContain("Secure");
    expect(clearRequestCookie("state", httpRequest, { sameSite: "None" })).toContain("Secure");
  });

  it("keeps Lax cookies on http requests without Secure", () => {
    const header = createRequestCookie("state", "value", httpRequest);

    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Secure");
  });
});

describe("integration Set-Cookie attributes browsers require", () => {
  const http = new Request("http://app.example.com/auth/callback");
  const https = new Request("https://app.example.com/auth/callback");

  it("applies the __Host- and __Secure- prefix rules", () => {
    const host = createRequestCookie("__Host-sid", "v", http, {
      path: "/auth",
      domain: "example.com",
    });
    expect(host).toContain("Path=/;");
    expect(host).not.toContain("Domain=");
    expect(host).toContain("; Secure");
    expect(clearRequestCookie("__Host-sid", http, { path: "/auth" })).toContain("; Secure");

    expect(createRequestCookie("__Secure-sid", "v", http, { secure: false })).toContain(
      "; Secure",
    );
  });

  it("marks cookies Secure behind a TLS-terminating proxy", () => {
    const proxied = new Request("http://10.0.0.5:3000/auth/callback", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(createRequestCookie("sid", "v", proxied)).toContain("; Secure");
    expect(createRequestCookie("sid", "v", http)).not.toContain("Secure");
    expect(createRequestCookie("sid", "v", https)).toContain("; Secure");
  });

  it("encodes the name and rejects a non-finite maxAge", () => {
    expect(createRequestCookie("a;b", "v", https)).toMatch(/^a%3Bb=v;/);
    expect(() => createRequestCookie("sid", "v", https, { maxAge: Number.NaN })).toThrow(
      TypeError,
    );
  });
});
