// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildFarmVercelRoutes,
  createFarmVercelImmutableAssetRoute,
  FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
  type FarmVercelImmutableAssetRoute,
  type FarmVercelRoute,
  isFarmVercelImmutableAssetPath,
} from "../nitro/vercel-assets";

// The shape Nitro's Vercel builder writes to config.json (generateBuildConfig):
// redirect + header routes from routeRules, then a blanket immutable
// public-asset route, then the filesystem handler, then ISR routes, then the
// preset's own catch-all to /__fallback.
function nitroPresetRoutes(): FarmVercelRoute[] {
  return [
    { src: "/legacy/(.*)", status: 301, headers: { Location: "/new/$1" } },
    { src: "/secure/(.*)", headers: { "X-Frame-Options": "DENY" } },
    {
      src: "/(.*)",
      headers: { "cache-control": "public,max-age=31536000,immutable" },
      continue: true,
    },
    { handle: "filesystem" },
    { src: "(?<url>/blog/.*)", dest: "/blog-isr?url=$url" },
    { src: "/(.*)", dest: "/__fallback" },
  ];
}

describe("Vercel immutable Farm assets", () => {
  it("matches content-hashed JavaScript, CSS, font, and image assets", () => {
    expect(isFarmVercelImmutableAssetPath("/chunks/router-hab12cd90.js")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/theme-ha1b2c3d4.css")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/fonts/Geist-h5f687a5dd4c8.woff2")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/github-h0123456789abcdef.svg")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/chunks/vendor-hab12cd90.wasm")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/app-ha1b2c3d4.js.map")).toBe(true);
  });

  it("does not give immutable caching to stable or unhashed URLs", () => {
    expect(isFarmVercelImmutableAssetPath("/farm-client.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/farm-client.css")).toBe(false);
    // The content-hashed stylesheet copy lives under assets/ precisely so the
    // existing -h fingerprint rule grants it immutable caching.
    expect(isFarmVercelImmutableAssetPath("/assets/farm-client-h1a2b3c4d.css")).toBe(true);
    // The fingerprinted entry sits at the root — its relative chunk imports
    // pin it there — and only the farm-client name qualifies at that level.
    expect(isFarmVercelImmutableAssetPath("/farm-client-h1a2b3c4d.js")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/other-h1a2b3c4d.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/logo.svg")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/icon-v2.svg")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/readme-how-to-build.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/archive-202608010001.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/component-abcdefgh.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/shell-a1b2c3d4.html")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/shell-a1b2c3d4.HTM")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/index.html")).toBe(false);
  });

  it("matches root asset paths even when a base path is configured", () => {
    // Hashed client assets are emitted and served at the root regardless of
    // basePath (the client build sets no Vite `base` and Nitro mounts the
    // client output at "/"), so a basePath-scoped route would never match the
    // URLs browsers actually request. The cast emulates the old call site
    // that passed config.basePath.
    const createRoute = createFarmVercelImmutableAssetRoute as (
      basePath?: string,
    ) => FarmVercelImmutableAssetRoute;
    const matcher = new RegExp(createRoute("/farm").src);

    expect(matcher.test("/assets/logo-ha1b2c3d4.webp")).toBe(true);
    expect(matcher.test("/farm-client-h1a2b3c4d.js")).toBe(true);
    expect(matcher.test("/chunks/router-hab12cd90.js")).toBe(true);
    expect(matcher.test("/farm/assets/logo-ha1b2c3d4.webp")).toBe(false);
  });

  it("emits a continuing header route for the Build Output API", () => {
    const route = createFarmVercelImmutableAssetRoute();
    const matcher = new RegExp(route.src);

    expect(route.headers).toEqual({
      "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
    });
    expect(route.continue).toBe(true);
    expect(route.caseSensitive).toBe(true);
    expect(matcher.test("/assets/module-hab12cd90.wasm")).toBe(true);
    expect(matcher.test("/assets/shell-a1b2c3d4.html")).toBe(false);
  });
});

describe("buildFarmVercelRoutes", () => {
  it("preserves the preset redirect and header routes", () => {
    const routes = buildFarmVercelRoutes({
      presetRoutes: nitroPresetRoutes(),
      runtimeRoutes: [],
    });

    expect(routes).toContainEqual({
      src: "/legacy/(.*)",
      status: 301,
      headers: { Location: "/new/$1" },
    });
    expect(routes).toContainEqual({
      src: "/secure/(.*)",
      headers: { "X-Frame-Options": "DENY" },
    });
    // The redirect/header routes must precede the filesystem handler, matching
    // Vercel's source-route phase ordering.
    const filesystemIndex = routes.findIndex((route) => route.handle === "filesystem");
    const headerIndex = routes.findIndex((route) => route.src === "/secure/(.*)");
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    expect(headerIndex).toBeLessThan(filesystemIndex);
  });

  it("replaces the preset blanket immutable asset route with Farm's precise one", () => {
    const routes = buildFarmVercelRoutes({
      presetRoutes: nitroPresetRoutes(),
      runtimeRoutes: [],
    });

    // The preset's over-broad `continue` public-asset route is dropped...
    expect(
      routes.some(
        (route) => route.continue === true && route.headers?.["cache-control"] !== undefined,
      ),
    ).toBe(false);
    // ...in favor of Farm's fingerprint-scoped immutable route.
    expect(routes).toContainEqual(createFarmVercelImmutableAssetRoute());
  });

  it("routes runtime and catch-all traffic to the __nitro function", () => {
    const runtimeRoutes: FarmVercelRoute[] = [
      { src: "/reports/(.*)", dest: "/__nitro", headers: { "x-farm-route": "reports" } },
    ];
    const routes = buildFarmVercelRoutes({
      presetRoutes: nitroPresetRoutes(),
      runtimeRoutes,
    });

    // Runtime routes come after the filesystem handler and before the catch-all.
    const filesystemIndex = routes.findIndex((route) => route.handle === "filesystem");
    const runtimeIndex = routes.findIndex((route) => route.src === "/reports/(.*)");
    expect(runtimeIndex).toBeGreaterThan(filesystemIndex);

    // Same-origin APIs are handled by the catch-all without implicit CORS.
    expect(routes.some((route) => route.headers?.["Access-Control-Allow-Origin"] === "*")).toBe(
      false,
    );

    // The last route is Farm's catch-all to its own function, never the preset's
    // /__fallback target.
    expect(routes[routes.length - 1]).toEqual({ src: "/(.*)", dest: "/__nitro" });
    expect(routes.some((route) => route.dest === "/__fallback")).toBe(false);
  });

  it("still produces a valid route set when the preset has no filesystem handler", () => {
    const routes = buildFarmVercelRoutes({
      presetRoutes: [{ src: "/only/(.*)", status: 302, headers: { Location: "/elsewhere" } }],
      runtimeRoutes: [],
    });

    // With no filesystem marker, no source routes are preserved (they cannot be
    // safely placed), but Farm's own routes are still emitted.
    expect(routes).toContainEqual(createFarmVercelImmutableAssetRoute());
    expect(routes).toContainEqual({ handle: "filesystem" });
    expect(routes[routes.length - 1]).toEqual({ src: "/(.*)", dest: "/__nitro" });
  });
});
