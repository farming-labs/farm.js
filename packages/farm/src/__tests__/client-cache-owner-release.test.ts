import { afterEach, describe, expect, it } from "vitest";
import { FarmClientDataCache } from "../client-cache";

const caches: FarmClientDataCache[] = [];
const expired = { data: 1, updatedAt: 0, staleAt: 1, gcAt: 2 };
function create() {
  const cache = new FarmClientDataCache({
    subscribeToInvalidation: false,
    gcSweepIntervalMs: false,
  });
  caches.push(cache);
  return cache;
}
function retainExpired(cache: FarmClientDataCache, key: string) {
  cache.set(key, expired);
  cache.invalidate(key, 1);
  cache.get(key, 3);
}
function countSweptKeys(cache: FarmClientDataCache) {
  const internal = cache as any;
  const original = internal.sweepEntryMetadata;
  let visits = 0;
  internal.sweepEntryMetadata = function (keys: Set<string>) {
    visits += keys.size;
    return original.call(this, keys);
  };
  return () => visits;
}
afterEach(() => {
  for (const cache of caches.splice(0)) cache.dispose();
});

describe("targeted cache owner release", () => {
  it.each(["subscription", "request"])(
    "does linear cleanup when 1,000 independent %s owners leave",
    (kind) => {
      const cache = create();
      const releases: Array<() => void> = [];
      for (let i = 0; i < 1000; i++) {
        const key = `key:${i}`;
        if (kind === "subscription") releases.push(cache.subscribe(key, () => {}));
        else {
          cache.setInflight(key, Promise.resolve(i));
          releases.push(() => cache.deleteInflight(key));
        }
        retainExpired(cache, key);
      }
      const visits = countSweptKeys(cache);
      for (const release of releases) release();
      expect(visits()).toBe(1000);
      expect((cache as any).pendingMetadataSweeps.size).toBe(0);
      expect((cache as any).invalidatedAt.size).toBe(0);
    },
  );

  it("does not rescan pending keys when unrelated owners leave", () => {
    const cache = create();
    cache.subscribe("watched", () => {});
    retainExpired(cache, "watched");
    const unrelated = cache.subscribe("unrelated", () => {});
    cache.setInflight("request", Promise.resolve());
    const visits = countSweptKeys(cache);
    unrelated();
    cache.deleteInflight("request");
    expect(visits()).toBe(0);
    expect((cache as any).pendingMetadataSweeps.has("watched")).toBe(true);
  });

  it("releases an old target when a watched alias chain is retargeted", () => {
    const cache = create();
    cache.alias("first", "middle");
    cache.alias("middle", "old");
    const release = cache.subscribe("first", () => {});
    retainExpired(cache, "old");
    cache.alias("middle", "new");
    expect((cache as any).pendingMetadataSweeps.has("old")).toBe(false);
    expect((cache as any).invalidatedAt.has("old")).toBe(false);
    expect(cache.resolveKey("first")).toBe("new");
    retainExpired(cache, "new");
    release();
    expect((cache as any).pendingMetadataSweeps.size).toBe(0);
    expect((cache as any).aliases.size).toBe(0);
  });

  it("retains an old target until a separate owner releases it", () => {
    const cache = create();
    cache.alias("alias", "old");
    const releaseAlias = cache.subscribe("alias", () => {});
    const releaseOld = cache.subscribe("old", () => {});
    retainExpired(cache, "old");
    cache.alias("alias", "new");
    expect((cache as any).invalidatedAt.get("old")).toBe(1);
    releaseOld();
    expect((cache as any).pendingMetadataSweeps.has("old")).toBe(false);
    expect(cache.resolveKey("alias")).toBe("new");
    releaseAlias();
  });

  it("does not clear alias chains until both subscription and request owners leave", () => {
    const cache = create();
    cache.alias("first", "middle");
    cache.alias("middle", "target");
    const release = cache.subscribe("first", () => {});
    cache.setInflight("first", Promise.resolve());
    retainExpired(cache, "target");
    release();
    expect(cache.resolveKey("first")).toBe("target");
    cache.deleteInflight("first");
    expect((cache as any).pendingMetadataSweeps.size).toBe(0);
    expect((cache as any).aliasesByTarget.size).toBe(0);
  });

  it("preserves a fresh replacement and tolerates repeated releases", () => {
    const cache = create();
    cache.alias("alias", "target");
    const release = cache.subscribe("alias", () => {});
    retainExpired(cache, "target");
    cache.set("target", { data: 2, updatedAt: 3, staleAt: Infinity });
    release();
    release();
    cache.deleteInflight("alias");
    expect(cache.get("alias")?.data).toBe(2);
    expect(cache.resolveKey("alias")).toBe("target");
    expect((cache as any).pendingMetadataSweeps.size).toBe(0);
  });
});
