import { describe, expect, it, vi } from "vitest";
import { FarmDataCache } from "../cache";

describe("cache invalidation pruning", () => {
  it("stops reading entries at the first stale dependency without materializing the cache", () => {
    const cache = new FarmDataCache();
    cache.set("stale", "old", { tags: ["products"] });
    for (let index = 0; index < 1_000; index++) cache.set(`other-${index}`, index);
    cache.revalidateTag("products");
    const entries = (cache as any).entries as Map<string, unknown>;
    const values = entries.values.bind(entries);
    let reads = 0;
    const spy = vi.spyOn(entries, "values").mockImplementation(function* () {
      for (const entry of values()) {
        reads++;
        yield entry;
      }
    } as typeof entries.values);
    try {
      cache.set("unrelated", "new");
      expect(reads).toBe(1);
    } finally {
      spy.mockRestore();
    }
    expect(cache.get("stale")).toBeUndefined();
    expect(cache.get("stale", { allowStale: true })).toBe("old");
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
    cache.revalidateTag("products");
    const iterate = generations[Symbol.iterator].bind(generations);
    let reads = 0;
    const spy = vi.spyOn(generations, Symbol.iterator).mockImplementation(function* () {
      for (const generation of iterate()) {
        reads++;
        yield generation;
      }
    } as (typeof generations)[typeof Symbol.iterator]);
    try {
      cache.set("unrelated", "new");
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
