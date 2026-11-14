// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FARM_IMMUTABLE_ASSET_CACHE_CONTROL,
  FARM_IMMUTABLE_ASSET_MAX_AGE,
  isFarmImmutableAssetPath,
  planFarmImmutableAssets,
} from "../nitro/immutable-assets";

const clientOutputDir = path.join("/app", ".farm", "client");
const immutable = { headers: { "cache-control": FARM_IMMUTABLE_ASSET_CACHE_CONTROL } };
const files = [
  "/farm-client-h1a2b3c4d.js",
  "/farm-client-boot-h1a2b3c4d.js",
  "/farm-mobile-client-h1a2b3c4d.js",
  "/farm-client.js",
  "/farm-client.css",
  "/favicon.ico",
  "/robots.txt",
  "/chunks/page-hab12cd90.js",
  "/chunks/router-h0123abcd.js",
  "/assets/pixel-h5f687a5d.png",
  "/assets/fonts/Geist-h5f687a5dd4c8.woff2",
  "/assets/farm-client-h1a2b3c4d.css",
];

describe("immutable caching plan for content-hashed client files", () => {
  it("recognizes the hashed root entries every client build can emit", () => {
    expect(isFarmImmutableAssetPath("/farm-client-h1a2b3c4d.js")).toBe(true);
    expect(isFarmImmutableAssetPath("/farm-client-boot-h1a2b3c4d.js")).toBe(true);
    expect(isFarmImmutableAssetPath("/farm-mobile-client-h1a2b3c4d.js")).toBe(true);
    expect(isFarmImmutableAssetPath("/farm-client.js")).toBe(false);
    expect(isFarmImmutableAssetPath("/farm-client-boot.js")).toBe(false);
    expect(isFarmImmutableAssetPath("/logo-h1a2b3c4d.png")).toBe(false);
  });

  it("serves directories of hashed files through Nitro and rules the root entries", () => {
    expect(planFarmImmutableAssets({ clientOutputDir, files })).toEqual({
      publicAssets: [
        {
          dir: path.join(clientOutputDir, "chunks"),
          baseURL: "/chunks",
          maxAge: FARM_IMMUTABLE_ASSET_MAX_AGE,
        },
        {
          dir: path.join(clientOutputDir, "assets"),
          baseURL: "/assets",
          maxAge: FARM_IMMUTABLE_ASSET_MAX_AGE,
        },
      ],
      routeRules: {
        "/farm-client-h1a2b3c4d.js": immutable,
        "/farm-client-boot-h1a2b3c4d.js": immutable,
        "/farm-mobile-client-h1a2b3c4d.js": immutable,
      },
    });
  });

  it("rules each hashed file of a directory an unhashed public file shares", () => {
    const plan = planFarmImmutableAssets({
      clientOutputDir,
      files: [...files, "/assets/logo.png"],
    });
    expect(plan.publicAssets.map((asset) => asset.baseURL)).toEqual(["/chunks"]);
    expect(plan.routeRules).toMatchObject({
      "/assets/pixel-h5f687a5d.png": immutable,
      "/assets/fonts/Geist-h5f687a5dd4c8.woff2": immutable,
      "/assets/farm-client-h1a2b3c4d.css": immutable,
    });
    expect(plan.routeRules).not.toHaveProperty("/assets/logo.png");
  });

  it("leaves a directory an app route starts with shared with the app", () => {
    const plan = planFarmImmutableAssets({
      clientOutputDir,
      files,
      routePaths: ["/", "/assets/:id", "/api/assets"],
    });
    expect(plan.publicAssets.map((asset) => asset.baseURL)).toEqual(["/chunks"]);
    expect(plan.routeRules).toHaveProperty("/assets/pixel-h5f687a5d.png");
  });

  it("keeps the Cache-Control an app route rule sets", () => {
    const plan = planFarmImmutableAssets({
      clientOutputDir,
      files,
      routeRules: {
        "/assets/**": { headers: { "Cache-Control": "public, max-age=600" } },
        "/chunks/**": { headers: { "x-frame-options": "DENY" } },
        "/farm-client-boot-h1a2b3c4d.js": { headers: { "cache-control": "no-store" } },
      },
    });
    expect(plan.publicAssets.map((asset) => asset.baseURL)).toEqual(["/chunks"]);
    expect(Object.keys(plan.routeRules)).toEqual([
      "/farm-client-h1a2b3c4d.js",
      "/farm-mobile-client-h1a2b3c4d.js",
    ]);
  });

  it("gives nothing when an app rule sets Cache-Control for every path", () => {
    expect(
      planFarmImmutableAssets({
        clientOutputDir,
        files,
        routeRules: { "/**": { headers: { "cache-control": "no-cache" } } },
      }),
    ).toEqual({ publicAssets: [], routeRules: {} });
  });

  it("skips a hashed file whose name a route rule key would read as a pattern", () => {
    const plan = planFarmImmutableAssets({
      clientOutputDir,
      files: ["/assets/a:b-h1a2b3c4d.png", "/assets/logo.png"],
    });
    expect(plan).toEqual({ publicAssets: [], routeRules: {} });
  });
});
