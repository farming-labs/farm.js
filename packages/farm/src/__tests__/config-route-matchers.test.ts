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

describe("config route has/missing conditions", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("redirects only when every has condition holds", () => {
    const match = createConfigRedirectMatcher([
      {
        source: "/beta",
        destination: "/beta-on",
        has: [
          { type: "cookie", key: "beta", value: "^on$" },
          { type: "header", key: "x-beta", value: "^yes$" },
        ],
      },
      { source: "/beta", destination: "/beta-off" },
    ]);
    const url = new URL("https://farm.test/beta");
    // No cookie and no header: the conditional rule is skipped for the fallback.
    expect(match(url)).toEqual({ destination: "/beta-off", statusCode: 307 });
    expect(match(url, headers({ cookie: "beta=on" }))).toEqual({
      destination: "/beta-off",
      statusCode: 307,
    });
    expect(match(url, headers({ cookie: "beta=on; other=1", "x-beta": "yes" }))).toEqual({
      destination: "/beta-on",
      statusCode: 307,
    });
    // The value is a regex, not an exact match: "on-2" does not satisfy ^on$.
    expect(match(url, headers({ cookie: "beta=on-2", "x-beta": "yes" }))).toEqual({
      destination: "/beta-off",
      statusCode: 307,
    });
    // Header names match case-insensitively.
    expect(match(url, headers({ cookie: "beta=on", "X-BETA": "yes" }))).toEqual({
      destination: "/beta-on",
      statusCode: 307,
    });
  });

  it("treats a missing value as a presence check", () => {
    const match = createConfigRedirectMatcher([
      {
        source: "/member",
        destination: "/member-area",
        has: [{ type: "cookie", key: "session" }],
        missing: [{ type: "query", key: "preview" }],
      },
    ]);
    const url = new URL("https://farm.test/member");
    expect(match(url)).toBeNull();
    expect(match(url, headers({ cookie: "session=abc" }))).toEqual({
      destination: "/member-area",
      statusCode: 307,
    });
    // The missing condition blocks the rule while ?preview is present.
    expect(
      match(new URL("https://farm.test/member?preview=1"), headers({ cookie: "session=abc" })),
    ).toBeNull();
  });

  it("matches query values, including repeated parameters, and hosts", () => {
    const match = createConfigRewriteMatcher([
      { source: "/docs", destination: "/api/v2", has: [{ type: "query", key: "v", value: "^2$" }] },
      { source: "/docs", destination: "/api/v1", missing: [{ type: "query", key: "v" }] },
      {
        source: "/home",
        destination: "/home-eu",
        has: [{ type: "host", value: "^eu\\.farm\\.test$" }],
      },
    ]);
    expect(match(new URL("https://farm.test/docs?v=1"))).toBeNull();
    expect(match(new URL("https://farm.test/docs?v=2"))?.pathname).toBe("/api/v2");
    // A repeated parameter satisfies the condition when any value matches.
    expect(match(new URL("https://farm.test/docs?v=1&v=2"))?.pathname).toBe("/api/v2");
    // Without ?v the missing rule applies instead.
    expect(match(new URL("https://farm.test/docs"))?.pathname).toBe("/api/v1");
    expect(match(new URL("https://eu.farm.test/home"))?.pathname).toBe("/home-eu");
    expect(match(new URL("https://us.farm.test/home"))).toBeNull();
    // Without headers a cookie/header condition can never hold, so the rule is skipped.
    const cookieMatch = createConfigRedirectMatcher([
      { source: "/a", destination: "/b", has: [{ type: "cookie", key: "x" }] },
    ]);
    expect(cookieMatch(new URL("https://farm.test/a"))).toBeNull();
  });

  it("rejects malformed conditions when the matcher is created", () => {
    expect(() =>
      createConfigRedirectMatcher([
        { source: "/a", destination: "/b", has: [{ type: "bogus" as never, key: "x" }] },
      ]),
    ).toThrow('type must be one of "cookie", "header", "query", or "host"');
    expect(() =>
      createConfigRedirectMatcher([
        { source: "/a", destination: "/b", has: [{ type: "header", key: "" }] },
      ]),
    ).toThrow("key must be a non-empty string");
    expect(() =>
      createConfigRedirectMatcher([{ source: "/a", destination: "/b", has: [{ type: "host" }] }]),
    ).toThrow('value is required for a "host" condition');
    expect(() =>
      createConfigRewriteMatcher([
        { source: "/a", destination: "/b", has: [{ type: "query", key: "v", value: "([" }] },
      ]),
    ).toThrow("is not a valid regular expression");
  });
});
