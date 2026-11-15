import { describe, expect, it, vi } from "vitest";
import { createStaticAPIRouteMatcher, matchAPIRoute } from "../api/route-pattern";
import { createStaticAPIRouteMatcherAtBasePath, matchAPIRouteAtBasePath } from "../api/runtime";

describe("static production API route index", () => {
  it("matches the control across overlapping static, dynamic and catch-all prefixes", () => {
    const first = ["shop", "other", "café", "a%2Fb", "[category]"];
    const last = ["settings", "item", "[id]", "[...rest]", "[[...rest]]"];
    const routes = first.flatMap((prefix) =>
      last.map((suffix) => ({ path: `/api/${prefix}/${suffix}` })),
    );
    const table = new Map(routes.map((route) => [route.path, route]));
    const match = createStaticAPIRouteMatcher(routes);
    for (const prefix of ["shop", "other", "unknown", "caf%C3%A9", "a%2Fb", "%ZZ"]) {
      for (const suffix of ["", "/", "/settings", "/item", "/value", "/a/b", "/a%2Fb", "/%252F/"]) {
        const pathname = `/api/${prefix}${suffix}`;
        expect(match(pathname), pathname).toEqual(matchAPIRoute(table, pathname));
      }
    }
  });

  it("keeps direct routes authoritative across custom API base paths", () => {
    const routes = [
      "/api/projects/[id]",
      "/api/docs/[[...path]]",
      "/backend/v2/projects/[direct]",
    ].map((path) => ({ path }));
    const table = new Map(routes.map((route) => [route.path, route]));
    for (const basePath of ["/api", "/backend/v2", "/"]) {
      const match = createStaticAPIRouteMatcherAtBasePath(routes, basePath);
      for (const pathname of [
        "/api/projects/one",
        "/backend/v2/projects/two",
        "/projects/three",
        "/backend/v2/docs",
        "/docs/a%2Fb",
        "/backend/v2/docs/%ZZ",
        "/missing",
      ]) {
        expect(match(pathname)).toEqual(matchAPIRouteAtBasePath(table, pathname, basePath));
      }
    }
  });

  it("does not scan unrelated routes on a warmed dynamic lookup", () => {
    const routes = Array.from({ length: 500 }, (_, index) => ({
      path: `/api/resources-${index}/[id]`,
    }));
    const match = createStaticAPIRouteMatcher(routes);
    expect(match("/api/resources-0/first")?.params).toEqual({ id: "first" });
    const values = Map.prototype.values;
    let visits = 0;
    const spy = vi.spyOn(Map.prototype, "values").mockImplementation(function* () {
      for (const value of values.call(this)) {
        visits++;
        yield value;
      }
    });
    try {
      const result = match("/api/resources-0/next");
      expect(visits).toBe(0);
      expect(result?.params).toEqual({ id: "next" });
    } finally {
      spy.mockRestore();
    }
  });

  it("agrees with the live matcher on specificity, decoding, and unusual patterns", () => {
    const patterns = [
      "/api/[category]/settings",
      "/api/shop/[item]",
      "/api/shop/sale",
      "/api/files/[...path]",
      "/api/docs/[[...slug]]",
      "/api/café",
      "/api/literal/:id",
      "/api/a%2Fb/[id]",
      "/api/other/[...all]/tail",
      "/[...root]",
    ];
    const requests = [
      "/",
      "/missing",
      "/api/shop/settings",
      "/api/shop/sale",
      "/api/shop/sale/",
      "/api/shop/a%252Fb",
      "/api/files",
      "/api/files/a/b",
      "/api/files/a%2Fb/c",
      "/api/docs",
      "/api/docs/",
      "/api/docs/a",
      "/api/caf%C3%A9",
      "/api/literal/:id",
      "/api/literal/x",
      "/api/shop/%ZZ",
      "/api/a%2Fb/one",
      "/api/a/b/one",
      "/api/other/a/tail",
      "//api//shop//sale//",
      "/api/shop/[item]",
    ];
    for (const order of [patterns, [...patterns].reverse()]) {
      const routes = order.map((path) => ({ path }));
      const table = new Map(routes.map((route) => [route.path, route]));
      const match = createStaticAPIRouteMatcher(routes);
      for (const pathname of requests)
        expect(match(pathname), pathname).toEqual(matchAPIRoute(table, pathname));
    }
  });

  it("preserves insertion-order ties and duplicate-key replacement", () => {
    const routes = [
      { path: "/api/café/[first]", marker: 1 },
      { path: "/api/caf%C3%A9/[second]", marker: 2 },
      { path: "/api/other/[id]", marker: 3 },
      { path: "/api/café/[first]", marker: 4 },
    ];
    const table = new Map(routes.map((route) => [route.path, route]));
    const match = createStaticAPIRouteMatcher(routes);
    expect(match("/api/café/one")).toEqual(matchAPIRoute(table, "/api/café/one"));
    expect(match("/api/café/one")?.route.marker).toBe(4);
    expect(match("/api/caf%C3%A9/[second]")?.params).toEqual({});
  });

  it("owns a fixed snapshot without changing the public mutable matcher", () => {
    const route = { path: "/api/first/[id]" };
    const routes = new Map([[route.path, route]]);
    const match = createStaticAPIRouteMatcher([...routes.values()]);
    route.path = "/api/second/[name]";
    expect(match("/api/first/one")?.route.path).toBe("/api/first/[id]");
    expect(match("/api/second/two")).toBeNull();
    expect(matchAPIRoute(routes, "/api/first/one")).toBeNull();
    expect(matchAPIRoute(routes, "/api/second/two")?.params).toEqual({ name: "two" });
    routes.clear();
    expect(matchAPIRoute(routes, "/api/second/two")).toBeNull();
    expect(match("/api/first/three")?.params).toEqual({ id: "three" });
    expect(Object.isFrozen(route)).toBe(false);
    expect(Object.isFrozen(match("/api/first/four")?.route)).toBe(true);
  });
});
