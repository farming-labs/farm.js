import { describe, expect, it, vi } from "vitest";
import { matchAPIRoute } from "../api/route-pattern";

describe("compiled API route matcher", () => {
  it("splits only the request pathname after route metadata is warm", () => {
    const routes = new Map(
      ["/api/users/[id]", "/api/teams/[id]", "/api/docs/[[...slug]]"].map((path) => [
        path,
        { path },
      ]),
    );
    matchAPIRoute(routes, "/api/users/one");
    const split = vi.spyOn(String.prototype, "split");
    let calls: number;
    try {
      matchAPIRoute(routes, "/api/users/two");
      calls = split.mock.calls.length;
    } finally {
      split.mockRestore();
    }
    expect(calls).toBe(1);
  });

  it("preserves specificity, decoded params, and trailing slash behavior", () => {
    const routes = new Map(
      ["/api/[category]/settings", "/api/shop/[item]", "/api/files/[...path]", "/api/café"].map(
        (path) => [path, { path }],
      ),
    );
    const matcher = { match: (pathname: string) => matchAPIRoute(routes, pathname) };

    expect(matcher.match("/api/shop/settings")?.route.path).toBe("/api/shop/[item]");
    expect(matcher.match("/api/shop/hello%20farm/")?.params).toEqual({ item: "hello farm" });
    expect(matcher.match("/api/files/a%20b/c")?.params).toEqual({ path: ["a b", "c"] });
    expect(matcher.match("/api/caf%C3%A9")?.route.path).toBe("/api/café");
  });

  it("keeps malformed URL segments literal", () => {
    const route = { path: "/api/users/[id]" };
    const routes = new Map([[route.path, route]]);

    expect(matchAPIRoute(routes, "/api/users/%E0%A4%A")?.params).toEqual({ id: "%E0%A4%A" });
  });

  it("observes replacements, deletions, and in-place path edits after warming", () => {
    const route = { path: "/api/users/[id]" };
    const routes = new Map([[route.path, route]]);
    expect(matchAPIRoute(routes, "/api/users/one")?.params).toEqual({ id: "one" });
    route.path = "/api/teams/[team]";
    expect(matchAPIRoute(routes, "/api/users/one")).toBeNull();
    expect(matchAPIRoute(routes, "/api/teams/one")?.params).toEqual({ team: "one" });
    routes.set("/api/users/[id]", { path: "/api/users/[name]" });
    expect(matchAPIRoute(routes, "/api/users/two")?.params).toEqual({ name: "two" });
    routes.clear();
    expect(matchAPIRoute(routes, "/api/users/two")).toBeNull();
  });

  it("does not retain params between requests and preserves optional catch-all emptiness", () => {
    const route = { path: "/api/docs/[[...slug]]" };
    const routes = new Map([[route.path, route]]);
    expect(matchAPIRoute(routes, "/api/docs/a%2Fb/c")?.params).toEqual({ slug: ["a/b", "c"] });
    expect(matchAPIRoute(routes, "/api/docs")?.params).toEqual({});
    expect(matchAPIRoute(routes, "/api/docs/a%252Fb")?.params).toEqual({ slug: ["a%2Fb"] });
  });
});
