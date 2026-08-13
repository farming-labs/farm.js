// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createFarmVercelImmutableAssetRoute,
  FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
  isFarmVercelImmutableAssetPath,
} from "../nitro/vercel-assets";

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

  it("scopes the route to the configured base path", () => {
    expect(isFarmVercelImmutableAssetPath("/farm/assets/logo-ha1b2c3d4.webp", "/farm")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/logo-ha1b2c3d4.webp", "/farm")).toBe(false);
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
