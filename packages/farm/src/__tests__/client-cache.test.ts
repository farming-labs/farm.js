import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteDataCacheKey } from "../cache";
import {
  FarmClientDataCache,
  getFarmClientDataCache,
  normalizeFarmClientCacheKey,
} from "../client-cache";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";

describe("Farm client data cache", () => {
  beforeEach(() => {
    getFarmClientDataCache().clear();
  });

  it("normalizes structured keys with the route data key contract", () => {
    const key = ["product", "123"] as const;
    expect(normalizeFarmClientCacheKey(key)).toBe(createRouteDataCacheKey(key));
    expect(normalizeFarmClientCacheKey("custom-key")).toBe("custom-key");
  });

  it("invalidates entries through the shared invalidation channel", () => {
    const cache = getFarmClientDataCache();
    const key = createRouteDataCacheKey(["product", "123"]);
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(key, listener);

    cache.set(key, {
      data: { id: "123" },
      updatedAt: 1,
      staleAt: Number.POSITIVE_INFINITY,
    });
    notifyFarmCacheInvalidation(key);

    expect(cache.isStale(key)).toBe(true);
    expect(cache.get(key)?.invalidatedAt).toEqual(expect.any(Number));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("unsubscribes disposed cache instances from shared invalidations", () => {
    const cache = new FarmClientDataCache();
    cache.dispose();
    cache.set("private", {
      data: { id: "private" },
      updatedAt: 1,
      staleAt: Number.POSITIVE_INFINITY,
    });

    notifyFarmCacheInvalidation("private");

    expect(cache.isStale("private")).toBe(false);
  });

  it("resolves aliases to one cache entry", () => {
    const cache = getFarmClientDataCache();
    const key = createRouteDataCacheKey(["product", "123"]);

    cache.set("query-call", {
      data: { id: "123" },
      updatedAt: Date.now(),
      staleAt: Number.POSITIVE_INFINITY,
    });
    cache.alias("query-call", key);

    expect(cache.get("query-call")).toBe(cache.get(key));
  });

  it("preserves an invalidation when a provisional key becomes canonical", () => {
    const cache = new FarmClientDataCache();

    cache.invalidate("query-call", 10);
    cache.alias("query-call", "product:123");
    cache.set("product:123", {
      data: { id: "stale" },
      updatedAt: 1,
      staleAt: Number.POSITIVE_INFINITY,
    });

    expect(cache.isStale("product:123", 11)).toBe(true);
    expect(cache.get("query-call")?.invalidatedAt).toBe(10);

    cache.set("product:123", {
      data: { id: "fresh" },
      updatedAt: 11,
      staleAt: Number.POSITIVE_INFINITY,
    });
    expect(cache.isStale("query-call", 12)).toBe(false);
    cache.dispose();
  });

  it("applies a provisional invalidation to an existing canonical entry", () => {
    const cache = new FarmClientDataCache();
    cache.set("product:123", {
      data: { id: "existing" },
      updatedAt: 1,
      staleAt: Number.POSITIVE_INFINITY,
    });

    cache.invalidate("query-call", 10);
    cache.alias("query-call", "product:123");

    expect(cache.isStale("product:123", 11)).toBe(true);
    expect(cache.get("product:123")?.invalidatedAt).toBe(10);
    cache.dispose();
  });
});
