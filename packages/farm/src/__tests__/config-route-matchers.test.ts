import { describe, expect, it } from "vitest";
import { resolveFarmI18nConfig } from "../i18n/config";
import {
  applyConfigResponseHeaders,
  createConfigHeadersMatcher,
  createConfigRedirectMatcher,
  createConfigRewriteMatcher,
} from "../plugins/config-routes";

/**
 * The config route matchers servers that answer with Web Responses use (the RSC pipeline): the
 * same rules as the dev plugins, which are built on them.
 */
describe("config route matchers", () => {
  const options = { basePath: "/console" };

  it("redirect below the basePath, keeping the query and encoded slashes", () => {
    const match = createConfigRedirectMatcher(
      [
        { source: "/old", destination: "/new", permanent: true },
        { source: "/cfg/:slug", destination: "/:slug" },
      ],
      options,
    );
    expect(match(new URL("https://farm.test/console/old/?q=1"))).toEqual({
      destination: "/console/new?q=1",
      statusCode: 308,
    });
    expect(match(new URL("https://farm.test/console/cfg/%2F%2Fexample.com"))).toEqual({
      destination: "/console/%2F%2Fexample.com",
      statusCode: 307,
    });
    expect(match(new URL("https://farm.test/console/other"))).toBeNull();
    expect(() =>
      createConfigRedirectMatcher([{ source: "/a", destination: "/b", statusCode: 200 as 307 }]),
    ).toThrow(RangeError);
    expect(() => createConfigRedirectMatcher([{ source: "a", destination: "/b" }])).toThrow(
      'must start with "/"',
    );
  });

  it("rewrite to a destination URL in the request's locale", () => {
    const i18n = resolveFarmI18nConfig(
      { locales: ["en", "fr"], defaultLocale: "en" },
      { basePath: "/console" },
    );
    const match = createConfigRewriteMatcher(
      [
        { source: "/alias/:slug", destination: "/posts/:slug" },
        { source: "/away", destination: "https://example.com/x?from=farm" },
      ],
      { i18n, basePath: "/console" },
    );
    expect(match(new URL("https://farm.test/console/fr/alias/a?q=1"))?.href).toBe(
      "https://farm.test/console/fr/posts/a?q=1",
    );
    expect(match(new URL("https://farm.test/console/away?q=1"))?.href).toBe(
      "https://example.com/x?from=farm",
    );
    expect(match(new URL("https://farm.test/console/fr/other"))).toBeNull();
  });

  it("apply headers as the production entry does", () => {
    const match = createConfigHeadersMatcher(
      [
        { source: "/:path*", headers: [{ key: "Link", value: "</a.css>; rel=preload" }] },
        {
          source: "/about",
          headers: [
            { key: "x-config", value: "on" },
            { key: "Set-Cookie", value: "a=1" },
          ],
        },
      ],
      options,
    );
    const matched = match(new URL("https://farm.test/console/about"));
    expect(matched).toHaveLength(2);

    const response = new Response("ok", {
      status: 201,
      headers: { link: "</b.js>; rel=modulepreload", "set-cookie": "a=1", "x-config": "off" },
    });
    const applied = applyConfigResponseHeaders(response, matched);
    expect(applied.status).toBe(201);
    expect(applied.headers.get("link")).toBe("</b.js>; rel=modulepreload, </a.css>; rel=preload");
    expect(applied.headers.getSetCookie()).toEqual(["a=1"]);
    expect(applied.headers.get("x-config")).toBe("on");

    // Nothing to change: the same response, even when its headers are immutable.
    expect(applyConfigResponseHeaders(applied, matched)).toBe(applied);
    const immutable = Response.redirect("https://farm.test/console/x", 307);
    expect(applyConfigResponseHeaders(immutable, matched).headers.get("x-config")).toBe("on");
  });
});
