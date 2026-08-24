// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getCookieValue, parseCookieHeaderMap } from "../../../farm-integration-utils/src/cookies";
import { getReturnTo } from "../../../farm-integration-utils/src/url";

describe("getReturnTo open-redirect hardening", () => {
  it("keeps ordinary root-relative paths", () => {
    expect(getReturnTo("/dashboard", "/")).toBe("/dashboard");
    expect(getReturnTo("/a/b?c=1#d", "/")).toBe("/a/b?c=1#d");
    expect(getReturnTo("/", "/fallback")).toBe("/");
  });

  it("rejects protocol-relative and backslash targets that resolve off-origin", () => {
    for (const evil of ["//evil.com", "/\\evil.com", "/\\/evil.com", "//evil.com/path"]) {
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
