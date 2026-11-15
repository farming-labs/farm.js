import { describe, expect, it } from "vitest";
import { FarmDataCache, type FarmCacheAdapter, type FarmCacheEntry } from "../cache";

/**
 * `getTagVersions` and `invalidateTags` are optional on a cache adapter. An adapter with only
 * get/set/delete keeps tag versions as entries of its own, so revalidateTag and revalidatePath
 * reach every server sharing it. They used to be ignored silently.
 */
function minimalAdapter(store = new Map<string, FarmCacheEntry>()): FarmCacheAdapter {
  return {
    name: "minimal",
    async get<T>(key: string) {
      return (store.get(key) as FarmCacheEntry<T> | undefined) ?? null;
    },
    async set<T>(key: string, entry: FarmCacheEntry<T>) {
      store.set(key, structuredClone(entry) as FarmCacheEntry);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

describe("a cache adapter with only get, set and delete", () => {
  it("lets revalidateTagAsync and revalidatePathAsync reach another server", async () => {
    const store = new Map<string, FarmCacheEntry>();
    const writer = new FarmDataCache({ adapter: minimalAdapter(store), namespace: "app" });
    const reader = new FarmDataCache({ adapter: minimalAdapter(store), namespace: "app" });
    let calls = 0;
    const produce = () => ++calls;

    expect(await writer.getOrSet("product", produce, { tags: ["products"] })).toBe(1);
    expect(await reader.getOrSet("product", produce, { tags: ["products"] })).toBe(1);

    await writer.revalidateTagAsync("products");
    expect(await reader.getOrSet("product", produce, { tags: ["products"] })).toBe(2);

    expect(await reader.getOrSet("pricing", produce, { paths: ["/pricing"] })).toBe(3);
    await writer.revalidatePathAsync("/pricing");
    expect(await reader.getOrSet("pricing", produce, { paths: ["/pricing"] })).toBe(4);
    expect(await reader.getOrSet("pricing", produce, { paths: ["/pricing"] })).toBe(4);
  });

  it("keeps entries without a revalidated tag", async () => {
    const store = new Map<string, FarmCacheEntry>();
    const cache = new FarmDataCache({ adapter: minimalAdapter(store), namespace: "app" });
    let calls = 0;
    expect(await cache.getOrSet("a", () => ++calls, { tags: ["a"] })).toBe(1);
    expect(await cache.getOrSet("b", () => ++calls, { tags: ["b"] })).toBe(2);
    await cache.revalidateTagAsync("a");
    expect(await cache.getOrSet("b", () => ++calls, { tags: ["b"] })).toBe(2);
    expect(await cache.getOrSet("a", () => ++calls, { tags: ["a"] })).toBe(3);
  });
});
