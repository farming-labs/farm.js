import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FarmDataCache, storageCacheAdapter, type FarmCacheStorage } from "../cache";

// storageCacheAdapter percent-encodes each logical key under its base.
const storedKey = (name: string) => `farm-cache:entry:${encodeURIComponent(`app:entry:${name}`)}`;

afterEach(() => {
  vi.useRealTimers();
});

function createMapStorage() {
  const store = new Map<string, unknown>();
  const ttls = new Map<string, number | undefined>();
  const storage: FarmCacheStorage = {
    getItem: async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    setItem: async (key: string, value: unknown, options?: { ttl?: number }) => {
      store.set(key, value);
      ttls.set(key, options?.ttl);
    },
    removeItem: async (key: string) => {
      store.delete(key);
      ttls.delete(key);
    },
  };
  const entryKeys = () => [...store.keys()].filter((key) => key.includes(":entry:"));
  return { storage, store, ttls, entryKeys };
}

describe("shared cache adapter expiry", () => {
  it("sends a ttl covering revalidate plus the stale window for finite entries", async () => {
    const { storage, ttls } = createMapStorage();
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    await cache.setAsync("short", "short", { revalidate: 1 });
    await cache.setAsync("long", "long", { revalidate: 300 });
    await cache.setAsync("forever", "forever", { revalidate: false });
    await cache.setAsync("default", "default");

    // 1s fresh + 60s minimum stale window; 300s fresh + 300s stale window.
    expect(ttls.get(storedKey("short"))).toBe(61);
    expect(ttls.get(storedKey("long"))).toBe(600);
    expect(ttls.get(storedKey("forever"))).toBeUndefined();
    expect(ttls.get(storedKey("default"))).toBeUndefined();
  });

  it("keeps an entry written already stale readable for the stale window", async () => {
    const { storage, ttls } = createMapStorage();
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    // ISR seeds pages from build output with the file's mtime as createdAt.
    await cache.setAsync("seeded", "html", { revalidate: 10, createdAt: Date.now() - 86_400_000 });

    expect(ttls.get(storedKey("seeded"))).toBe(60);
    const entry = await cache.getEntryAsync("seeded", { allowStale: true });
    expect(entry?.value).toBe("html");
  });

  it("lets a ttl-capable unstorage driver drop entries for one-off keys", async () => {
    vi.useFakeTimers();
    const storage = createStorage({ driver: memoryDriver() });
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    // One entry per attacker-chosen query string, like /ppr-page?r=<random>.
    for (let index = 0; index < 50; index++) {
      await cache.getOrSet(`ppr-page-r=${index}`, () => "x", { revalidate: 1, tags: ["ppr"] });
    }
    expect(await storage.getKeys()).toHaveLength(50);

    await vi.advanceTimersByTimeAsync(61_000);

    expect(await storage.getKeys()).toEqual([]);
  });

  it("deletes an expired entry on read when the storage has no native expiry", async () => {
    const { storage, entryKeys } = createMapStorage();
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    await cache.setAsync("product:1", "one", { revalidate: 30 });
    await cache.setAsync("product:2", "two", { revalidate: false });

    const later = Date.now() + 120_000;
    await expect(cache.getEntryAsync("product:1", { now: later })).resolves.toBeUndefined();
    await expect(cache.getEntryAsync("product:2", { now: later })).resolves.toMatchObject({
      value: "two",
    });

    expect(entryKeys()).toEqual([storedKey("product:2")]);
  });

  it("still serves a stale entry inside its stale window", async () => {
    const { storage } = createMapStorage();
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
    await cache.setAsync("page", "html", { revalidate: 30 });

    const stale = Date.now() + 45_000;
    await expect(cache.getEntryAsync("page", { now: stale })).resolves.toBeUndefined();
    await expect(
      cache.getEntryAsync("page", { now: stale, allowStale: true }),
    ).resolves.toMatchObject({ value: "html" });
  });
});
