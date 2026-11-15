import { describe, expect, it, vi } from "vitest";
import { FarmClientDataCache } from "../client-cache";

const create = () =>
  new FarmClientDataCache({ subscribeToInvalidation: false, gcSweepIntervalMs: false });
const expired = { data: 1, updatedAt: 0, staleAt: 1, gcAt: 2 };

describe("targeted alias metadata cleanup", () => {
  it("does not scan unrelated aliases during lazy expiry", () => {
    const cache = create();
    for (let i = 0; i < 1_000; i++) {
      cache.set(`key:${i}`, expired);
      cache.alias(`alias:${i}`, `key:${i}`);
    }
    const internal = cache as any;
    const originalSweep = internal.sweepEntryMetadata.bind(cache);
    let visits = 0;
    internal.sweepEntryMetadata = (swept: Set<string>) => {
      const iterator = internal.aliases[Symbol.iterator];
      internal.aliases[Symbol.iterator] = function* () {
        for (const entry of iterator.call(this)) {
          visits++;
          yield entry;
        }
      };
      try {
        return originalSweep(swept);
      } finally {
        internal.aliases[Symbol.iterator] = iterator;
      }
    };
    for (let i = 0; i < 1_000; i++) expect(cache.get(`key:${i}`, 3)).toBeUndefined();
    expect(visits).toBe(0);
    expect(internal.aliases.size).toBe(0);
    expect(internal.aliasesByTarget.size).toBe(0);
    cache.dispose();
  });

  it("removes transitive aliases without depending on insertion order", () => {
    const cache = create();
    cache.alias("first", "middle");
    cache.alias("middle", "target");
    cache.alias("last", "first");
    cache.set("target", expired);
    expect(cache.get("first", 3)).toBeUndefined();
    for (const key of ["first", "middle", "last"]) expect(cache.resolveKey(key)).toBe(key);
    expect((cache as any).aliasesByTarget.size).toBe(0);
  });

  it("preserves watched and in-flight chains through retargeting", () => {
    const cache = create();
    cache.alias("first", "middle");
    cache.alias("middle", "old");
    cache.alias("middle", "new");
    cache.set("old", expired);
    cache.set("new", expired);
    const listener = vi.fn();
    const unsubscribe = cache.subscribe("first", listener);
    cache.setInflight("new", Promise.resolve(1));
    cache.get("old", 3);
    expect(cache.resolveKey("first")).toBe("new");
    cache.get("new", 3);
    unsubscribe();
    expect(cache.resolveKey("first")).toBe("new");
    cache.deleteInflight("new");
    expect(cache.resolveKey("first")).toBe("first");
    expect((cache as any).aliasesByTarget.size).toBe(0);
    cache.alias("reused", "new");
    cache.clear();
    expect((cache as any).aliasesByTarget.size).toBe(0);
  });
});
