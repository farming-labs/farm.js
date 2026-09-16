import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("isolates a throwing cache listener from the other subscribers", () => {
    const cache = getFarmClientDataCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: Array<string | undefined> = [];

    cache.subscribe("product:1", () => {
      throw new Error("listener exploded");
    });
    cache.subscribe("product:1", (event) => seen.push(event));

    expect(() =>
      cache.set("product:1", {
        data: { id: 1 },
        updatedAt: Date.now(),
        staleAt: Date.now() + 60_000,
        status: "success",
        error: null,
      }),
    ).not.toThrow();
    expect(seen).toHaveLength(1);

    expect(() => cache.invalidate("product:1")).not.toThrow();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe("invalidate");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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

  it("keeps a resubscribed listener notified after a stale unsubscribe fires again", () => {
    const cache = new FarmClientDataCache();
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = cache.subscribe("k", first);
    unsubscribeFirst(); // drains {first} and removes the "k" entry
    cache.subscribe("k", second); // creates a fresh listener set for "k"
    unsubscribeFirst(); // stale/duplicate: must not evict second's live set

    cache.set("k", {
      data: { id: "k" },
      updatedAt: 1,
      staleAt: Number.POSITIVE_INFINITY,
    });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
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

describe("Farm client data cache gc sweep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function entryWithGc(now: number, gcTime: number) {
    return {
      data: { id: "gc" },
      updatedAt: now,
      staleAt: Number.POSITIVE_INFINITY,
      gcAt: now + gcTime,
    };
  }

  it("evicts unread expired entries without a read", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({ subscribeToInvalidation: false });

    cache.set("expired", entryWithGc(Date.now(), 1_000));
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(30_000);

    expect(cache.size).toBe(0);
    cache.dispose();
  });

  it("keeps watched, fetching, and inflight entries", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({ subscribeToInvalidation: false });
    const now = Date.now();

    cache.set("watched", entryWithGc(now, 1_000));
    const unsubscribe = cache.subscribe("watched", () => {});

    cache.set("fetching", { ...entryWithGc(now, 1_000), fetching: true });

    cache.set("inflight", entryWithGc(now, 1_000));
    cache.setInflight("inflight", Promise.resolve());

    cache.set("expired", entryWithGc(now, 1_000));

    vi.advanceTimersByTime(30_000);

    expect(cache.get("watched", now)).toBeDefined();
    expect(cache.get("fetching", now)).toBeDefined();
    expect(cache.get("inflight", now)).toBeDefined();
    expect(cache.size).toBe(3);

    unsubscribe();
    cache.dispose();
  });

  it("keeps sweeping while surviving entries still carry gcAt, then disarms", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({ subscribeToInvalidation: false });
    const now = Date.now();

    cache.set("later", entryWithGc(now, 45_000));
    vi.advanceTimersByTime(30_000);
    expect(cache.size).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(cache.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    cache.dispose();
  });

  it("does not schedule a sweep for entries without gcAt", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({ subscribeToInvalidation: false });

    cache.set("forever", {
      data: { id: "forever" },
      updatedAt: Date.now(),
      staleAt: Number.POSITIVE_INFINITY,
    });

    expect(vi.getTimerCount()).toBe(0);
    cache.dispose();
  });

  it("supports disabling the sweep", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({
      subscribeToInvalidation: false,
      gcSweepIntervalMs: false,
    });

    cache.set("expired", entryWithGc(Date.now(), 1_000));
    vi.advanceTimersByTime(60_000);

    expect(cache.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    cache.dispose();
  });

  it("clears the pending sweep timer on dispose", () => {
    vi.useFakeTimers();
    const cache = new FarmClientDataCache({ subscribeToInvalidation: false });

    cache.set("expired", entryWithGc(Date.now(), 1_000));
    expect(vi.getTimerCount()).toBe(1);

    cache.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
