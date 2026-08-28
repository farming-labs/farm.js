import { describe, expect, it } from "vitest";
import { parsePwaDuration, resolvePwaOptions } from "./config";

describe("resolvePwaOptions", () => {
  it("uses the short recommended configuration by default", () => {
    expect(resolvePwaOptions({ offline: "/offline" })).toEqual({
      enabled: true,
      offline: "/offline",
      update: "prompt",
      cache: {
        staticRoutes: true,
        images: {
          strategy: "swr",
          limit: 100,
          ttlMs: 30 * 24 * 60 * 60 * 1_000,
        },
      },
    });
  });

  it("accepts images: swr and a compact advanced form", () => {
    expect(
      resolvePwaOptions({
        cache: {
          staticRoutes: ["/", "/pricing/", "/pricing"],
          images: "swr",
        },
      }),
    ).toMatchObject({
      cache: {
        staticRoutes: ["/", "/pricing"],
        images: { strategy: "swr", limit: 100 },
      },
    });

    expect(
      resolvePwaOptions({
        cache: {
          images: { strategy: "swr", limit: 25, ttl: "6h" },
        },
      }).cache.images,
    ).toEqual({ strategy: "swr", limit: 25, ttlMs: 21_600_000 });
  });

  it("can keep only the immutable build asset cache", () => {
    expect(resolvePwaOptions({ cache: false }).cache).toEqual({
      staticRoutes: false,
      images: false,
    });
  });

  it("rejects ambiguous routes and invalid cache limits", () => {
    expect(() => resolvePwaOptions({ offline: "offline" })).toThrow('must start with "/"');
    expect(() => resolvePwaOptions({ offline: "/offline?source=pwa" })).toThrow("query string");
    expect(() => resolvePwaOptions({ cache: { images: { strategy: "swr", limit: 0 } } })).toThrow(
      "positive integer",
    );
  });
});

describe("parsePwaDuration", () => {
  it("supports concise cache durations", () => {
    expect(parsePwaDuration("30s")).toBe(30_000);
    expect(parsePwaDuration("5m")).toBe(300_000);
    expect(parsePwaDuration("2h")).toBe(7_200_000);
    expect(parsePwaDuration("7d")).toBe(604_800_000);
    expect(parsePwaDuration("2w")).toBe(1_209_600_000);
  });

  it("rejects zero, negative, and unitless string durations", () => {
    expect(() => parsePwaDuration(0)).toThrow("positive");
    expect(() => parsePwaDuration(-1)).toThrow("positive");
    expect(() => parsePwaDuration("0d")).toThrow("positive");
    expect(() => parsePwaDuration("30" as never)).toThrow("duration");
  });
});
