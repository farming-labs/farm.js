// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createFarmVercelImmutableAssetRoute,
  FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
  isFarmVercelImmutableAssetPath,
} from "../nitro/vercel-assets";

describe("Vercel immutable Farm assets", () => {
  it("matches content-hashed JavaScript, CSS, font, and image assets", () => {
    expect(isFarmVercelImmutableAssetPath("/chunks/router-Ab12_cd9.js")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/theme-a1b2c3d4.css")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/fonts/Geist-5f687a5dd4c8.woff2")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/github-QpYQ9fJQ.svg")).toBe(true);
  });

  it("does not give immutable caching to stable or unhashed URLs", () => {
    expect(isFarmVercelImmutableAssetPath("/farm-client.js")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/farm-client.css")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/logo.svg")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/assets/icon-v2.svg")).toBe(false);
    expect(isFarmVercelImmutableAssetPath("/index.html")).toBe(false);
  });

  it("scopes the route to the configured base path", () => {
    expect(isFarmVercelImmutableAssetPath("/farm/assets/logo-a1b2c3d4.webp", "/farm")).toBe(true);
    expect(isFarmVercelImmutableAssetPath("/assets/logo-a1b2c3d4.webp", "/farm")).toBe(false);
  });

  it("emits a continuing header route for the Build Output API", () => {
    expect(createFarmVercelImmutableAssetRoute()).toEqual({
      src: "^/(?:assets|chunks)/(?:.+/)*[^/]+-[A-Za-z0-9_-]{8,}\\.[^/]+$",
      headers: {
        "Cache-Control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
      },
      continue: true,
    });
  });
});
