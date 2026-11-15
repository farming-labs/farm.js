// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { HeaderConfig } from "../config";
import { appendFarmLinkHeader } from "../nitro/production-runtime";
import {
  generateConfiguredResponseHeadersRuntimeSource,
  generateRuntimePathMatcherSource,
} from "../nitro/universal-build";

function createRuntime(routes: HeaderConfig[]) {
  const split = vi.fn();
  const decode = vi.fn();
  const fallback = vi.fn();
  const matcher = generateRuntimePathMatcherSource()
    .replace(
      "function splitRuntimePath(pathname) {",
      "function splitRuntimePath(pathname) { split(pathname);",
    )
    .replace(
      "function decodeRouteSegment(segment) {",
      "function decodeRouteSegment(segment) { decode(segment);",
    )
    .replace(
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) {",
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) { fallback(patternSegments);",
    );
  const runtime = new Function(
    "configuredHeaderRoutes",
    "appendFarmLinkHeader",
    "split",
    "decode",
    "fallback",
    `${matcher}\n${generateConfiguredResponseHeadersRuntimeSource()}\nreturn { applyConfiguredResponseHeaders, matchRuntimePathPattern };`,
  )(routes, appendFarmLinkHeader, split, decode, fallback) as {
    applyConfiguredResponseHeaders: (response: Response, pathname: string) => Response;
    matchRuntimePathPattern: (pattern: string, pathname: string) => object | null;
  };
  return { ...runtime, split, decode, fallback };
}

describe("prepared configured response header routes", () => {
  it("prepares fixed rules once and decodes each request segment only once", () => {
    const routes = Array.from({ length: 32 }, (_, index) => ({
      source: `/page/${index}/:id`,
      headers: [{ key: "X-Rule", value: String(index) }],
    }));
    const runtime = createRuntime(routes);
    expect(runtime.split.mock.calls.map(([pathname]) => pathname)).toEqual(
      routes.map((route) => route.source),
    );
    runtime.split.mockClear();
    for (const pathname of ["/page/31/%252F", "/page/0/%zz"]) {
      const response = runtime.applyConfiguredResponseHeaders(new Response("ok"), pathname);
      expect(response.headers.get("x-rule")).toBe(pathname.split("/")[2]);
    }
    expect(runtime.split.mock.calls).toEqual([["/page/31/%252F"], ["/page/0/%zz"]]);
    expect(runtime.decode.mock.calls).toEqual([
      ["page"],
      ["31"],
      ["%252F"],
      ["page"],
      ["0"],
      ["%zz"],
    ]);
    expect(runtime.fallback).not.toHaveBeenCalled();
  });

  it("does no path work when headers are disabled and preserves response identity", () => {
    const runtime = createRuntime([]);
    const original = new Response("untouched");
    expect(runtime.applyConfiguredResponseHeaders(original, "/a/%zz")).toBe(original);
    expect(runtime.split).not.toHaveBeenCalled();
    expect(runtime.decode).not.toHaveBeenCalled();
    expect(runtime.fallback).not.toHaveBeenCalled();
  });

  it("keeps wildcard and ambiguous patterns on the complete matcher", () => {
    const patterns = [
      "/a/[...rest]/end",
      "/a/[[...rest]]",
      "/a/:rest*",
      "/a/*tail?",
      "/a/*/end",
      "/a/ab*cd",
    ];
    const runtime = createRuntime(patterns.map((source) => ({ source, headers: [] })));
    runtime.applyConfiguredResponseHeaders(new Response("ok"), "/a/one/end");
    expect(runtime.fallback.mock.calls.map(([segments]) => segments.join("/"))).toEqual(
      patterns.map((pattern) => pattern.slice(1)),
    );
  });

  const patterns = [
    "/",
    "/a",
    "/a/:id",
    "/a/[id]",
    "/a/%2F",
    "/a/:rest*",
    "/a/[...rest]",
    "/a/[[...rest]]",
    "/a/*tail?",
    "/a/*",
    "/a/*/end",
    "/a/[...rest]/end",
    "/a/ab*cd",
    "/a/[__proto__]",
    "/a/:id/:id",
  ];
  it.each([
    "/",
    "///",
    "/a",
    "/a/",
    "/a/one",
    "/a/%2F",
    "/a/%252F",
    "/a/%zz",
    "/a/%C4%B0",
    "/a/one/two/end",
    "/a//one/end/",
    "/a/ab*cd",
    "/other",
  ])("preserves the complete matcher's rule order and cookie fields for %s", async (pathname) => {
    const routes = patterns.map((source, index) => ({
      source,
      headers: [
        { key: "X-Order", value: String(index) },
        { key: `X-Rule-${index}`, value: "matched" },
        { key: "Set-Cookie", value: `rule${index}=1; Path=/` },
      ],
    }));
    const runtime = createRuntime(routes);
    const matched = routes
      .map((route, index) => (runtime.matchRuntimePathPattern(route.source, pathname) ? index : -1))
      .filter((index) => index !== -1);
    const original = new Response("unchanged 🌱", {
      status: 201,
      statusText: "Created",
      headers: { "Set-Cookie": "session=1; Path=/", "X-Order": "handler" },
    });
    const result = runtime.applyConfiguredResponseHeaders(original, pathname);
    expect(result.status).toBe(201);
    expect(result.statusText).toBe("Created");
    expect(result.body).toBe(original.body);
    expect(result.headers.get("x-order")).toBe(matched.length ? String(matched.at(-1)) : "handler");
    for (let index = 0; index < routes.length; index++) {
      expect(result.headers.get(`x-rule-${index}`)).toBe(
        matched.includes(index) ? "matched" : null,
      );
    }
    expect(result.headers.getSetCookie()).toEqual([
      "session=1; Path=/",
      ...matched.map((index) => `rule${index}=1; Path=/`),
    ]);
    expect(original.headers.get("x-order")).toBe("handler");
    expect(original.headers.getSetCookie()).toEqual(["session=1; Path=/"]);
    if (!matched.length) expect(result).toBe(original);
    expect(await result.text()).toBe("unchanged 🌱");
  });

  it("preserves additive Link and cookie behavior, including duplicate no-op identity", () => {
    const runtime = createRuntime([
      {
        source: "/account",
        headers: [
          { key: "LINK", value: '</app.js>; rel="preload"; as="script"' },
          { key: "set-cookie", value: "theme=dark; Path=/" },
          { key: "x-configured", value: "yes" },
        ],
      },
    ]);
    const original = new Response(null, {
      status: 204,
      headers: {
        Link: '</app.css>; rel="preload"; as="style"',
        "Set-Cookie": "session=1; Path=/",
      },
    });
    const result = runtime.applyConfiguredResponseHeaders(original, "/account");
    expect(result.body).toBeNull();
    expect(result.status).toBe(204);
    expect(result.headers.get("link")).toBe(
      '</app.css>; rel="preload"; as="style", </app.js>; rel="preload"; as="script"',
    );
    expect(result.headers.getSetCookie()).toEqual(["session=1; Path=/", "theme=dark; Path=/"]);
    const alreadySet = new Response(null, {
      headers: {
        Link: '</app.js>; rel="preload"; as="script"',
        "Set-Cookie": "theme=dark; Path=/",
        "x-configured": "yes",
      },
    });
    expect(runtime.applyConfiguredResponseHeaders(alreadySet, "/account")).toBe(alreadySet);
  });
});
