// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  applyCookieNamePrefixRequirements,
  parseMiddlewareCookieHeader,
  serializeMiddlewareCookie,
  serializeMiddlewareCookieDeletion,
} from "../middleware/cookie-header";

describe("middleware cookie serialization", () => {
  it("round-trips an ordinary cookie through parse and serialize", () => {
    const header = serializeMiddlewareCookie("session", "a b", { httpOnly: true, sameSite: "lax" });

    expect(header).toContain("session=a%20b");
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(parseMiddlewareCookieHeader("session=a%20b").session).toBe("a b");
  });

  it("forces the attributes a __Host- prefix requires", () => {
    // A browser rejects a __Host- cookie without Secure, or with a Domain, or
    // with a Path other than "/" - a rejected header is silently discarded.
    const header = serializeMiddlewareCookie("__Host-session", "value", {
      domain: "example.com",
      path: "/admin",
    });

    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Domain=");
    expect(header).not.toContain("Path=/admin");
  });

  it("forces Secure for a __Secure- prefix while keeping its scope", () => {
    const header = serializeMiddlewareCookie("__Secure-session", "value", {
      domain: "example.com",
      path: "/admin",
    });

    expect(header).toContain("Secure");
    expect(header).toContain("Domain=example.com");
    expect(header).toContain("Path=/admin");
  });

  it("emits a deletion a browser will accept for a prefixed cookie", () => {
    const header = serializeMiddlewareCookieDeletion("__Host-session");

    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Expires=Thu, 01 Jan 1970");
    // Without Secure the browser drops this header and the session survives
    // logout entirely.
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
  });

  it("scopes a deletion to the path and domain the cookie was set with", () => {
    const header = serializeMiddlewareCookieDeletion("session", {
      path: "/admin",
      domain: ".example.com",
    });

    // A tombstone at Path=/ does not match a cookie stored at Path=/admin.
    expect(header).toContain("Path=/admin");
    expect(header).toContain("Domain=.example.com");
    expect(header).toContain("Max-Age=0");
  });

  it("leaves unprefixed cookies untouched", () => {
    expect(applyCookieNamePrefixRequirements("session", { path: "/x" })).toEqual({ path: "/x" });
  });
});
