import { describe, expect, it } from "vitest";
import {
  createDevRequestHeaders,
  resolveDevRequestURL,
  resolveViteHtmlFallbackUrl,
} from "./dev-request.js";

describe("dev request helpers", () => {
  it("drops HTTP/2 pseudo-headers and uses :authority as the host", () => {
    const headers = createDevRequestHeaders({
      ":method": "GET",
      ":path": "/api/users",
      ":authority": "farm.test:5173",
      cookie: "a=1",
      "x-forwarded-for": ["1.1.1.1", "2.2.2.2"] as never,
    });
    expect([...headers.keys()].some((name) => name.startsWith(":"))).toBe(false);
    expect(headers.get("host")).toBe("farm.test:5173");
    expect(headers.get("cookie")).toBe("a=1");
    expect(headers.get("x-forwarded-for")).toBe("1.1.1.1, 2.2.2.2");
  });

  it("keeps an explicit host over :authority", () => {
    const headers = createDevRequestHeaders({ host: "a.test", ":authority": "b.test" });
    expect(headers.get("host")).toBe("a.test");
  });

  it("takes the path only from the request URL", () => {
    for (const host of ["evil.test/api/admin#", "evil.test?x", "user@evil.test", "a b", ""]) {
      const url = resolveDevRequestURL({ url: "/api/public?x=1", headers: { host } });
      expect(url.pathname).toBe("/api/public");
      expect(url.search).toBe("?x=1");
    }
    expect(resolveDevRequestURL({ url: "/x", headers: { host: "farm.test:5173" } }).host).toBe(
      "farm.test:5173",
    );
    expect(
      resolveDevRequestURL({ url: "/x", headers: { ":authority": "farm.test" } as never }).host,
    ).toBe("farm.test");
  });

  it("recovers the URL Vite's SPA fallback replaced", () => {
    expect(
      resolveViteHtmlFallbackUrl(
        { url: "/index.html", originalUrl: "/api/x?y=1", headers: {} },
        "/",
      ),
    ).toBe("/api/x?y=1");
    expect(
      resolveViteHtmlFallbackUrl(
        { url: "/index.html", originalUrl: "/app/api/x", headers: {} },
        "/app/",
      ),
    ).toBe("/api/x");
    expect(
      resolveViteHtmlFallbackUrl({ url: "/about.html", originalUrl: "/about", headers: {} }, "/"),
    ).toBe("/about");
    // Not rewritten, or rewritten to the .html file that was asked for.
    expect(
      resolveViteHtmlFallbackUrl({ url: "/api/x", originalUrl: "/api/x", headers: {} }, "/"),
    ).toBeUndefined();
    expect(
      resolveViteHtmlFallbackUrl(
        { url: "/page.html", originalUrl: "/page.html?v=1", headers: {} },
        "/",
      ),
    ).toBeUndefined();
    expect(
      resolveViteHtmlFallbackUrl({ url: "/api/y", originalUrl: "/api/x", headers: {} }, "/"),
    ).toBeUndefined();
  });
});
