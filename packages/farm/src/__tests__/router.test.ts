import { describe, expect, it } from "vitest";
import { buildFarmRoutePath, createFarmRouter, isFarmRouteActive, matchFarmRoute } from "../router";

describe("createFarmRouter", () => {
  it("matches static, dynamic, and catch-all routes", () => {
    const router = createFarmRouter(["/", "/about", "/users/[id]", "/docs/[...slug]"]);

    expect(router.match("/")?.params).toEqual({});
    expect(router.match("/about?from=nav")?.route.path).toBe("/about");
    expect(router.match("/users/ada")?.params).toEqual({ id: "ada" });
    expect(router.match("/docs/core/routing")?.params).toEqual({
      slug: "core/routing",
    });
  });

  it("prefers more specific routes before dynamic routes", () => {
    const router = createFarmRouter(["/users/[id]", "/users/settings"]);

    expect(router.match("/users/settings")?.route.path).toBe("/users/settings");
    expect(router.match("/users/123")?.route.path).toBe("/users/[id]");
  });

  it("supports optional catch-all and route group patterns", () => {
    const router = createFarmRouter(["/(marketing)/docs/[[...slug]]"]);

    expect(router.match("/docs")?.params).toEqual({ slug: "" });
    expect(router.match("/docs/getting-started")?.params).toEqual({
      slug: "getting-started",
    });
  });
});

describe("route helpers", () => {
  it("matches one route pattern", () => {
    expect(matchFarmRoute("/blog/[slug]", "/blog/hello%20farm")).toEqual({
      slug: "hello farm",
    });
    expect(matchFarmRoute("/blog/[slug]", "/blog")).toBeNull();
  });

  it("builds paths with params, query, hash, and optional catch-all params", () => {
    expect(
      buildFarmRoutePath(
        "/blog/[slug]",
        { slug: "hello farm" },
        {
          query: {
            from: "docs",
            tag: ["farm", "router"],
          },
          hash: "intro",
        },
      ),
    ).toBe("/blog/hello%20farm?from=docs&tag=farm&tag=router#intro");

    expect(buildFarmRoutePath("/docs/[[...slug]]")).toBe("/docs");
    expect(buildFarmRoutePath("/docs/[[...slug]]", { slug: ["core", "routing"] })).toBe(
      "/docs/core/routing",
    );
  });

  it("rejects empty supplied path segments", () => {
    expect(() => buildFarmRoutePath("/users/[id]", { id: "" })).toThrow(
      'Route param "id" for /users/[id] cannot contain an empty path segment.',
    );
    expect(() => buildFarmRoutePath("/docs/[...slug]", { slug: ["core", ""] })).toThrow(
      'Route param "slug" for /docs/[...slug] cannot contain an empty path segment.',
    );
    expect(buildFarmRoutePath("/docs/[[...slug]]")).toBe("/docs");
  });

  it("checks active routes exactly or by static prefix", () => {
    expect(isFarmRouteActive("/docs", "/docs")).toBe(true);
    expect(isFarmRouteActive("/docs", "/docs/routing")).toBe(false);
    expect(isFarmRouteActive("/docs", "/docs/routing", { exact: false })).toBe(true);
  });

  it("checks dynamic route descendants by their matched prefix", () => {
    expect(isFarmRouteActive("/users/[id]", "/users/42/settings", { exact: false })).toBe(true);
    expect(isFarmRouteActive("/(app)/users/[id]", "/users/42/settings", { exact: false })).toBe(
      true,
    );
    expect(isFarmRouteActive("/users/[id]", "/users", { exact: false })).toBe(false);
    expect(isFarmRouteActive("/users/[id]", "/projects/42/settings", { exact: false })).toBe(false);
  });
});
