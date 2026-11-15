import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vitest";
import { FarmDataCache, storageCacheAdapter } from "../cache";
import { memoryStorage } from "../storage";

/**
 * clearAsync() removes the entries a storageCacheAdapter keeps. unstorage's clear(base) only
 * empties drivers mounted below `base`, so on a store whose driver is mounted at the root the
 * entries used to survive and the cleared value came back.
 */
describe("clearAsync with storageCacheAdapter", () => {
  it.each([
    ["an unstorage instance", () => createStorage({ driver: memoryDriver() })],
    ["Farm's memoryStorage()", () => memoryStorage()],
  ])("removes the stored entries of %s", async (_label, createStore) => {
    const storage = createStore();
    await storage.setItem("other:key", "kept");
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    let calls = 0;

    expect(await cache.getOrSet("k", () => ++calls, { tags: ["t"] })).toBe(1);
    await cache.revalidateTagAsync("t");
    expect(await cache.getOrSet("k", () => ++calls, { tags: ["t"] })).toBe(2);

    await cache.clearAsync();
    expect((await storage.getKeys()).filter((key) => key.startsWith("farm-cache"))).toEqual([]);
    // Keys outside the adapter's base stay.
    expect(await storage.getItem("other:key")).toBe("kept");
    // The cleared value is produced again.
    expect(await cache.getOrSet("k", () => ++calls, { tags: ["t"] })).toBe(3);
  });
});
