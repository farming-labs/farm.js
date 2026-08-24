import { describe, expect, it } from "vitest";
import { middlewareMatchesPath, parseCookies, serializeCookie } from "./matching.js";

describe("parseCookies", () => {
  it("parses and decodes ordinary cookies", () => {
    expect(parseCookies("session=abc123; theme=dark")).toEqual({
      session: "abc123",
      theme: "dark",
    });
    expect(parseCookies("name=%41%42")).toEqual({ name: "AB" });
  });

  it("falls back to the raw value for malformed percent-encoding without throwing", () => {
    // A latin-1 value, a bare %, and %zz would each make decodeURIComponent
    // throw. The middleware runner swallows throws and calls next(), so a
    // throw here silently skips every middleware — an auth bypass.
    expect(() => parseCookies("session=ok; promo=100%off")).not.toThrow();
    const cookies = parseCookies("good=%41; bad=%zz; latin=caf%E9; session=keep");
    expect(cookies.good).toBe("A");
    expect(cookies.bad).toBe("%zz");
    expect(cookies.latin).toBe("caf%E9");
    // The valid session cookie is still readable despite the sibling bad ones.
    expect(cookies.session).toBe("keep");
  });

  it("returns an empty map for an absent header", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
  });
});

describe("middlewareMatchesPath", () => {
  it("root middleware matches everything", () => {
    expect(middlewareMatchesPath("/anything/here", "/")).toBe(true);
  });

  it("matches the exact path and true sub-segments", () => {
    expect(middlewareMatchesPath("/admin", "/admin")).toBe(true);
    expect(middlewareMatchesPath("/admin/users", "/admin")).toBe(true);
    expect(middlewareMatchesPath("/admin/users/42", "/admin")).toBe(true);
  });

  it("does not match sibling routes that only share a string prefix", () => {
    expect(middlewareMatchesPath("/administrator", "/admin")).toBe(false);
    expect(middlewareMatchesPath("/admin-public", "/admin")).toBe(false);
    expect(middlewareMatchesPath("/adminery/x", "/admin")).toBe(false);
  });
});

describe("serializeCookie", () => {
  it("emits Max-Age=0 for immediate expiry instead of dropping it", () => {
    const cookie = serializeCookie("session", "", { maxAge: 0 });
    expect(cookie).toContain("Max-Age=0");
  });

  it("omits Max-Age when not provided", () => {
    expect(serializeCookie("a", "b")).not.toContain("Max-Age");
  });

  it("serializes standard attributes", () => {
    const cookie = serializeCookie("a", "b", {
      maxAge: 3600,
      path: "/app",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    });
    expect(cookie).toBe("a=b; Max-Age=3600; Path=/app; Secure; HttpOnly; SameSite=Lax");
  });

  it("defaults Path to / when unspecified", () => {
    expect(serializeCookie("a", "b")).toContain("Path=/");
  });
});
