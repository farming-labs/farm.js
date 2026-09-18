import { describe, expect, it } from "vitest";
import { buildFarmRoutePath, createFarmRouter, isFarmRouteActive, matchFarmRoute } from "../router";

describe("optional star catch-all *name?", () => {
  it("registers *name? as optional and matches the parent URL", () => {
    const router = createFarmRouter(["/docs/*slug?"]);
    expect(router.routes[0].path).toBe("/docs/*slug?");
    expect(router.match("/docs")).toMatchObject({ params: { slug: "" } });
    expect(router.match("/docs/guide")).toMatchObject({ params: { slug: "guide" } });
    expect(router.match("/docs/core/routing")).toMatchObject({
      params: { slug: "core/routing" },
    });
    expect(router.match("/other")).toBeNull();
  });

  it("matchFarmRoute matches the parent and descendants from a raw pattern", () => {
    expect(matchFarmRoute("/docs/*slug?", "/docs")).toEqual({ slug: "" });
    expect(matchFarmRoute("/docs/*slug?", "/docs/core/routing")).toEqual({
      slug: "core/routing",
    });
    expect(matchFarmRoute("/docs/*slug?", "/other")).toBeNull();
  });

  it("buildFarmRoutePath treats *name? as omittable but still rejects empty segments", () => {
    expect(buildFarmRoutePath("/docs/*slug?", {})).toBe("/docs");
    expect(buildFarmRoutePath("/docs/*slug?", { slug: ["core", "routing"] })).toBe(
      "/docs/core/routing",
    );
    expect(() => buildFarmRoutePath("/docs/*slug?", { slug: ["core", ""] })).toThrow(
      'Route param "slug" for /docs/*slug? cannot contain an empty path segment.',
    );
  });

  it("isFarmRouteActive treats *name? as an active prefix", () => {
    expect(isFarmRouteActive("/docs/*slug?", "/docs", { exact: false })).toBe(true);
    expect(isFarmRouteActive("/docs/*slug?", "/docs/core/routing", { exact: false })).toBe(true);
    expect(isFarmRouteActive("/docs/*slug?", "/other", { exact: false })).toBe(false);
  });

  it("keeps *name (no trailing ?) required", () => {
    const router = createFarmRouter(["/docs/*slug"]);
    expect(router.routes[0].path).toBe("/docs/*slug");
    expect(router.match("/docs")).toBeNull();
    expect(router.match("/docs/guide")).toMatchObject({ params: { slug: "guide" } });
    expect(() => buildFarmRoutePath("/docs/*slug", {})).toThrow(
      'Missing route param "slug" for /docs/*slug.',
    );
  });

  it("registers *name? and *name as distinct routes without a misleading ambiguity error", () => {
    expect(() => createFarmRouter(["/docs/*slug?", "/docs/*slug"])).not.toThrow();
    const router = createFarmRouter(["/docs/*slug?", "/docs/*slug"]);
    expect(router.routes.map((route) => route.path).sort()).toEqual(
      ["/docs/*slug?", "/docs/*slug"].sort(),
    );
    expect(router.match("/docs")).toMatchObject({ params: { slug: "" } });
    expect(router.match("/docs/guide")).toMatchObject({ params: { slug: "guide" } });
  });
});
