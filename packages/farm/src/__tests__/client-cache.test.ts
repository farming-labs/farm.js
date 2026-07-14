import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRouteDataCacheKey } from "../cache";
import { getFarmClientDataCache, normalizeFarmClientCacheKey } from "../client-cache";
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
});
