import { describe, expect, it, vi } from "vitest";
import { FarmDataCache } from "../cache";

describe("cache invalidation pruning", () => {
  it("never scans the whole cache when invalidating per-item tags or writing", () => {
    const cache = new FarmDataCache({ maxEntries: 2_048 });
    for (let index = 0; index < 1_024; index++) {
      cache.set(`item-${index}`, index, { tags: [`item:${index}`] });
    }
    const entries = (cache as any).entries as Map<string, unknown>;
    const versions = (cache as any).invalidatedTagVersions as Map<string, number>;
    let scans = 0;
    const spies = [entries, versions].flatMap((map) =>
      (["values", "keys", "entries", Symbol.iterator, "forEach"] as const).map((method) => {
        const original = (map as any)[method].bind(map);
        return vi.spyOn(map as any, method as any).mockImplementation((...args: unknown[]) => {
          scans++;
          return original(...args);
        });
      }),
    );
    try {
      for (let index = 0; index < 1_024; index++) {
        expect(cache.revalidateTag(`item:${index}`)).toBe(1);
      }
      cache.set("unrelated", "new");
      cache.set("item-0", "fresh", { tags: ["item:0"] });
      cache.delete("item-1");
      expect(scans).toBe(0);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(versions.size).toBe(1_022);
    expect(versions.has("item:0")).toBe(false);
    expect(versions.has("item:1")).toBe(false);
    expect(cache.get("item-0")).toBe("fresh");
    expect(cache.get("item-2")).toBeUndefined();
    expect(cache.get("item-2", { allowStale: true })).toBe(2);
  });

  it("stops reading a tag's entries at the first stale dependency", () => {
    const cache = new FarmDataCache();
    for (let index = 0; index < 1_000; index++) {
      cache.set(`stale-${index}`, index, { tags: ["products"] });
    }
    cache.revalidateTag("products");
    const tagged = (cache as any).entriesByTag.get("products") as Set<unknown>;
    const iterate = tagged[Symbol.iterator].bind(tagged);
    let reads = 0;
    const spy = vi.spyOn(tagged, Symbol.iterator).mockImplementation(function* () {
      for (const entry of iterate()) {
        reads++;
        yield entry;
      }
    } as (typeof tagged)[typeof Symbol.iterator]);
    try {
      cache.delete("stale-0");
      expect(reads).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect((cache as any).invalidatedTagVersions.has("products")).toBe(true);
    expect(cache.get("stale-1")).toBeUndefined();
    expect(cache.get("stale-1", { allowStale: true })).toBe(1);
  });

  it("stops reading active generations once an invalidated fill is found", async () => {
    const cache = new FarmDataCache();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let allStarted!: () => void;
    const ready = new Promise<void>((resolve) => {
      allStarted = resolve;
    });
    const fills = Array.from({ length: 10 }, (_, index) =>
      cache.getOrSet(
        `fill-${index}`,
        async () => {
          if (++started === 10) allStarted();
          await gate;
          return index;
        },
        { tags: ["products"] },
      ),
    );
    const generations = (cache as any).activeGenerations as Set<unknown>;
    await ready;
    expect(generations.size).toBe(10);
    const iterate = generations[Symbol.iterator].bind(generations);
    let reads = 0;
    const spy = vi.spyOn(generations, Symbol.iterator).mockImplementation(function* () {
      for (const generation of iterate()) {
        reads++;
        yield generation;
      }
    } as (typeof generations)[typeof Symbol.iterator]);
    try {
      cache.revalidateTag("products");
      expect(reads).toBe(1);
    } finally {
      spy.mockRestore();
      release();
      await Promise.all(fills);
    }
    for (let index = 0; index < 10; index++) expect(cache.get(`fill-${index}`)).toBeUndefined();
    cache.clear();
    expect((cache as any).invalidatedTagVersions.size).toBe(0);
  });

  it("retains only tags needed by stale entries after replacement, eviction, and deletion", () => {
    const cache = new FarmDataCache({ maxEntries: 3 });
    cache.set("a", 1, { tags: ["a", "shared"] });
    cache.set("b", 2, { tags: ["b", "shared"] });
    cache.revalidateTag("a");
    cache.revalidateTag("b");
    cache.revalidateTag("shared");
    const tags = () => [...(cache as any).invalidatedTagVersions.keys()].sort();
    cache.set("a", 3, { tags: ["a", "shared"] });
    expect(tags()).toEqual(["b", "shared"]);
    expect(cache.get("a")).toBe(3);
    cache.set("c", 4);
    cache.set("d", 5); // evicts the remaining stale entry b
    expect(tags()).toEqual([]);
    cache.revalidateTag("a");
    expect(tags()).toEqual(["a"]);
    cache.delete("a");
    expect(tags()).toEqual([]);
  });
});
