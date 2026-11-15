// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseMiddlewareCookieHeader } from "../middleware/cookie-header";
import { decodeCookieName, parseRequestCookieHeader } from "../request-cookies";

describe("request cookie names", () => {
  it("does not let an encoded name stand in for a __Host- or __Secure- cookie", () => {
    // A sibling subdomain can set `__Host%2Dsid` (the browser sees no prefix) with a longer Path,
    // which browsers send first. Decoded, it would shadow the real `__Host-sid`.
    const header =
      "__Host%2Dsid=attacker; __Secure%2dtok=attacker; %5F%5Fhost-x=attacker; __Host-sid=victim; __Secure-tok=victim";
    expect(parseRequestCookieHeader(header).map((cookie) => cookie.name)).toEqual([
      "__Host%2Dsid",
      "__Secure%2dtok",
      "%5F%5Fhost-x",
      "__Host-sid",
      "__Secure-tok",
    ]);
    expect(parseMiddlewareCookieHeader(header)).toMatchObject({
      "__Host-sid": "victim",
      "__Secure-tok": "victim",
    });
  });

  it("still decodes the names Farm encodes when it sets them, and every value", () => {
    expect(decodeCookieName("my%20cookie")).toBe("my cookie");
    expect(decodeCookieName("__Host-sid")).toBe("__Host-sid");
    expect(decodeCookieName("%E0%A4%A")).toBe("%E0%A4%A");
    expect(parseRequestCookieHeader("my%20cookie=a%20b; __Host-sid=v%3D1")).toEqual([
      { name: "my cookie", value: "a b" },
      { name: "__Host-sid", value: "v=1" },
    ]);
  });
});
