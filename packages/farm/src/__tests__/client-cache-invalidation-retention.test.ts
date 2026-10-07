import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";
import { FarmClientDataCache, trackFarmClientCacheInvalidations } from "../client-cache";

const caches: FarmClientDataCache[] = [];
function create() {
  const cache = new FarmClientDataCache({ gcSweepIntervalMs: false });
  caches.push(cache);
  return cache;
}
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
  vi.unstubAllGlobals();
});

describe("broadcast invalidation retention", () => {
  it.each([false, true])(
    "does not retain unknown broadcast keys (without WeakRef: %s)",
    (fallback) => {
      if (fallback) vi.stubGlobal("WeakRef", undefined);
      const cache = create();
      for (let i = 0; i < 10_000; i++) notifyFarmCacheInvalidation(`unowned:${i}`);
      expect(cache.size).toBe(0);
      expect((cache as any).invalidatedAt.size).toBe(0);
      expect((cache as any).pendingMetadataSweeps.size).toBe(0);
      expect((cache as any).gcTimer).toBeUndefined();
    },
  );

  it("tracks late-discovered response keys for only the active request lifetime", () => {
    const cache = create();
    const active = trackFarmClientCacheInvalidations(cache);
    try {
      notifyFarmCacheInvalidation("late-canonical");
      expect(active.has("late-canonical")).toBe(true);
      expect((cache as any).invalidatedAt.size).toBe(0);
      active.dispose();
      expect(active.has("late-canonical")).toBe(false);
    } finally {
      active.dispose();
    }
  });

  it("invalidates cached data while ignoring unrelated keys", () => {
    const cache = create();
    cache.set("cached", { data: 1, updatedAt: 0, staleAt: Infinity });
    notifyFarmCacheInvalidation("cached");
    expect(cache.isStale("cached")).toBe(true);
    expect((cache as any).invalidatedAt.size).toBe(1);
    notifyFarmCacheInvalidation("unrelated");
    expect((cache as any).invalidatedAt.size).toBe(1);
  });

  it("keeps observed alias-chain invalidations until the last owner releases them", () => {
    const cache = create();
    cache.alias("first", "middle");
    cache.alias("middle", "canonical");
    const listener = vi.fn();
    const unsubscribe = cache.subscribe("first", listener);
    cache.setInflight("canonical", Promise.resolve(1));
    notifyFarmCacheInvalidation("canonical");
    expect(listener).toHaveBeenCalledWith("invalidate");
    expect((cache as any).invalidatedAt.has("canonical")).toBe(true);
    unsubscribe();
    expect((cache as any).invalidatedAt.has("canonical")).toBe(true);
    cache.deleteInflight("canonical");
    expect((cache as any).invalidatedAt.size).toBe(0);
    expect((cache as any).pendingMetadataSweeps.size).toBe(0);
  });

  it("applies observed invalidation to an older first response", () => {
    const cache = create();
    cache.setInflight("pending", Promise.resolve(1));
    notifyFarmCacheInvalidation("pending");
    cache.set("pending", { data: "old", updatedAt: 0, staleAt: Infinity });
    cache.deleteInflight("pending");
    expect(cache.isStale("pending")).toBe(true);
  });

  it("preserves explicit invalidation before a key is cached or aliased", () => {
    const cache = create();
    cache.invalidate("provisional", 10);
    cache.alias("provisional", "canonical");
    cache.set("canonical", { data: 1, updatedAt: 1, staleAt: Infinity });
    expect(cache.get("canonical")?.invalidatedAt).toBe(10);
    expect(cache.isStale("provisional")).toBe(true);
  });

  it("a later broadcast does not make explicit unowned invalidation disposable", () => {
    const cache = create();
    cache.invalidate("explicit", 1);
    notifyFarmCacheInvalidation("explicit");
    const unsubscribe = cache.subscribe("unrelated", () => {});
    unsubscribe();
    cache.set("explicit", { data: 1, updatedAt: 0, staleAt: Infinity });
    expect(cache.isStale("explicit")).toBe(true);
  });
});
