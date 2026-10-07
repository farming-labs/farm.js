import { afterEach, describe, expect, it, vi } from "vitest";
import { FarmClientDataCache, trackFarmClientCacheInvalidations } from "../client-cache";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";

const caches: FarmClientDataCache[] = [];
const entry = { data: "old", updatedAt: 1, staleAt: Infinity };
function create() {
  const cache = new FarmClientDataCache({ gcSweepIntervalMs: false });
  caches.push(cache);
  return cache;
}
function metadata(cache: FarmClientDataCache) {
  return cache as unknown as {
    aliases: Map<string, string>;
    aliasesByTarget: Map<string, Set<string>>;
    invalidatedAt: Map<string, number>;
    pendingMetadataSweeps: Set<string>;
  };
}
function expectEmptyMetadata(cache: FarmClientDataCache) {
  for (const map of Object.values({
    aliases: metadata(cache).aliases,
    aliasesByTarget: metadata(cache).aliasesByTarget,
    invalidatedAt: metadata(cache).invalidatedAt,
    pendingMetadataSweeps: metadata(cache).pendingMetadataSweeps,
  }))
    expect(map.size).toBe(0);
}
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
});

describe("explicit client cache deletion metadata", () => {
  it.each([false, true])(
    "releases deleted dynamic keys and aliases (delete through alias: %s)",
    (throughAlias) => {
      const cache = create();
      for (let i = 0; i < 1000; i++) {
        cache.set(`canonical:${i}`, entry);
        cache.alias(`provisional:${i}`, `canonical:${i}`);
        notifyFarmCacheInvalidation(`canonical:${i}`);
        expect(cache.delete(`${throughAlias ? "provisional" : "canonical"}:${i}`)).toBe(true);
      }
      expect(cache.size).toBe(0);
      expectEmptyMetadata(cache);
    },
  );

  it("preserves watched alias chains and invalidation until their last owner leaves", () => {
    const cache = create();
    cache.set("target", entry);
    cache.alias("first", "middle");
    cache.alias("middle", "target");
    const listener = vi.fn();
    const releaseFirst = cache.subscribe("first", listener);
    const releaseTarget = cache.subscribe("target", () => {});
    cache.invalidate("target", 10);
    listener.mockClear();

    expect(cache.delete("target")).toBe(true);
    expect(cache.get("first")).toBeUndefined();
    expect(cache.resolveKey("first")).toBe("target");
    expect(metadata(cache).invalidatedAt.get("target")).toBe(10);
    expect(listener).toHaveBeenCalledTimes(1);
    releaseTarget();
    expect(cache.resolveKey("first")).toBe("target");
    releaseFirst();
    expectEmptyMetadata(cache);
  });

  it("keeps a replacement written by a deletion listener and rejects older data", () => {
    const cache = create();
    cache.set("target", entry);
    cache.alias("alias", "target");
    cache.invalidate("target", 10);
    const release = cache.subscribe("alias", () => {
      if (cache.get("target") === undefined) cache.set("target", entry);
    });
    cache.delete("target");
    expect(cache.get("alias")?.data).toBe("old");
    expect(cache.isStale("alias")).toBe(true);
    release();
    expect(cache.resolveKey("alias")).toBe("target");
    cache.delete("target");
    expectEmptyMetadata(cache);
  });

  it("leaves unrelated aliases and explicit invalidation-before-first-set intact", () => {
    const cache = create();
    cache.invalidate("future", 10);
    expect(cache.delete("future")).toBe(false);
    cache.set("live", entry);
    cache.alias("live-alias", "live");
    cache.set("deleted", entry);
    cache.alias("deleted-alias", "deleted");
    cache.delete("deleted");
    expect(cache.resolveKey("live-alias")).toBe("live");
    expect(cache.get("live-alias")?.data).toBe("old");
    cache.set("future", entry);
    expect(cache.get("future")?.invalidatedAt).toBe(10);
  });

  it("notifies persistence once and retains request-local invalidation tracking", () => {
    const cache = create();
    const tracker = trackFarmClientCacheInvalidations(cache);
    const onDelete = vi.fn();
    cache.attachPersistence({ onSet: vi.fn(), onDelete, onClear: vi.fn() });
    try {
      cache.set("target", entry);
      cache.alias("alias", "target");
      notifyFarmCacheInvalidation("target");
      expect(cache.delete("alias")).toBe(true);
      expect(cache.delete("target")).toBe(false);
      expect(onDelete).toHaveBeenCalledExactlyOnceWith("target");
      expect(tracker.has("target")).toBe(true);
      expectEmptyMetadata(cache);
    } finally {
      tracker.dispose();
    }
  });

  it("keeps entries replaced by the persistence callback during deletion", () => {
    const cache = create();
    cache.set("target", entry);
    cache.alias("alias", "target");
    cache.attachPersistence({
      onSet() {},
      onClear() {},
      onDelete() {
        cache.set("target", { ...entry, data: "replacement" });
      },
    });
    cache.delete("target");
    expect(cache.get("alias")?.data).toBe("replacement");
    expect(cache.resolveKey("alias")).toBe("target");
  });
});
