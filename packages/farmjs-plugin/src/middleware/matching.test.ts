import { describe, expect, it } from "vitest";
import { matchAPIRouteAtBasePath } from "@farm.js/core/api/runtime";
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

  // Regression: matching the raw pathname let these skip middleware at
  // /api/admin while the API router still served /api/admin/users.
  it.each(["/api/%61dmin/users", "/api//admin/users", "//api/admin/users", "/api/admin//users"])(
    "applies to %s, an alternate spelling of /api/admin/users",
    (pathname) => {
      expect(middlewareMatchesPath(pathname, "/api/admin")).toBe(true);
    },
  );

  it("keeps an encoded slash inside its segment instead of splitting on it", () => {
    // `%2F` decodes to `/` within one segment, so `api%2Fadmin` is a single
    // segment that is neither `api` nor `admin`, exactly as the router reads it.
    expect(middlewareMatchesPath("/api%2Fadmin/users", "/api/admin")).toBe(false);
  });

  it("does not throw on a malformed escape, which would skip every middleware", () => {
    // The runner catches a throw and calls next(), so a throw here would be a bypass.
    expect(() => middlewareMatchesPath("/api/%E0%A4%A/users", "/api/admin")).not.toThrow();
    expect(middlewareMatchesPath("/api/%ZZ", "/api/admin")).toBe(false);
  });
});

describe("middleware and API routing agree on which requests are guarded", () => {
  // The invariant that matters: middleware at a directory applies to exactly the
  // requests the API router sends into that directory. Comparing against the real
  // router catches any spelling where the two disagree, not only the ones above.
  const routes = new Map([
    ["/api/admin/users", { path: "/api/admin/users" }],
    ["/api/public/health", { path: "/api/public/health" }],
  ]);

  it.each([
    "/api/admin/users",
    "/api/%61dmin/users",
    "/api/%61%64%6d%69%6e/users",
    "/api//admin/users",
    "//api/admin/users",
    "/api/admin//users",
    "/api/admin/users/",
    "/api/public/health",
    "/api%2Fadmin/users",
    "/api/ADMIN/users",
  ])("%s", (pathname) => {
    const routedIntoAdmin = matchAPIRouteAtBasePath(routes, pathname)?.route.path.startsWith(
      "/api/admin/",
    );
    expect(middlewareMatchesPath(pathname, "/api/admin")).toBe(Boolean(routedIntoAdmin));
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
