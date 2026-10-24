import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it } from "vitest";
import { createFarmCacheKey, FarmDataCache, storageCacheAdapter } from "../cache";

// Same shape as getPPRShellCacheKey(url, locale, origin) in nitro/universal-build.ts.
const pprKey = (pathname: string, search: string) =>
  createFarmCacheKey(["ppr", "", pathname, search]);

function createSharedCache() {
  const storage = createStorage({ driver: memoryDriver() });
  const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });
  return { storage, cache };
}

describe("storageCacheAdapter keys over unstorage", () => {
  it("keeps every query variant of a PPR shell in its own entry", async () => {
    const { storage, cache } = createSharedCache();

    await cache.setAsync(pprKey("/search", "?q=attacker"), "attacker", { tags: ["ppr"] });
    await cache.setAsync(pprKey("/search", "?q=shoes"), "shoes", { tags: ["ppr"] });

    expect((await cache.getEntryAsync(pprKey("/search", "?q=attacker")))?.value).toBe("attacker");
    expect((await cache.getEntryAsync(pprKey("/search", "?q=shoes")))?.value).toBe("shoes");
    expect(await cache.getEntryAsync(pprKey("/search", "?q=other"))).toBeUndefined();
    expect((await storage.getKeys()).filter((key) => key.includes(":entry:"))).toHaveLength(2);
  });

  it("does not fold path separators, colons or repeated colons together", async () => {
    const { cache } = createSharedCache();
    const paths = ["/a/b", "/a:b", "/a\\b", "/a::b", "a:b:"];

    for (const path of paths) {
      await cache.setAsync(pprKey(path, ""), path);
    }
    for (const path of paths) {
      expect((await cache.getEntryAsync(pprKey(path, "")))?.value).toBe(path);
    }
  });

  it("keeps tag invalidation scoped to the tag that changed", async () => {
    const { cache } = createSharedCache();
    await cache.setAsync("slash", "slash", { paths: ["/a/b"] });
    await cache.setAsync("colon", "colon", { paths: ["/a:b"] });

    await cache.revalidatePathAsync("/a:b");

    expect((await cache.getEntryAsync("slash"))?.value).toBe("slash");
    expect(await cache.getEntryAsync("colon")).toBeUndefined();
  });

  it("hashes long keys so they stay within driver key limits", async () => {
    const { storage, cache } = createSharedCache();
    const long = pprKey("/search", `?q=${"x".repeat(4_000)}`);
    const longer = pprKey("/search", `?q=${"x".repeat(4_001)}`);

    await cache.setAsync(long, "long");
    await cache.setAsync(longer, "longer");

    expect((await cache.getEntryAsync(long))?.value).toBe("long");
    expect((await cache.getEntryAsync(longer))?.value).toBe("longer");
    for (const key of await storage.getKeys()) {
      expect(key.length).toBeLessThan(256);
    }
  });

  it("keeps keys with lone surrogates distinct", async () => {
    const { cache } = createSharedCache();
    await cache.setAsync("a\uD800", "high");
    await cache.setAsync("a\uDC00", "low");

    expect((await cache.getEntryAsync("a\uD800"))?.value).toBe("high");
    expect((await cache.getEntryAsync("a\uDC00"))?.value).toBe("low");
  });

  it("treats an entry stored under another key as a miss, not an error", async () => {
    const adapter = {
      name: "folding",
      // A storage client that folds every key into one slot, like unstorage did with `?`.
      entry: null as unknown,
      async get() {
        return this.entry as never;
      },
      async set(_key: string, entry: unknown) {
        this.entry = entry;
      },
      async delete() {
        this.entry = null;
      },
    };
    const folded = new FarmDataCache({ adapter, namespace: "app" });
    await folded.setAsync(pprKey("/search", "?q=attacker"), "attacker");

    await expect(folded.getEntryAsync(pprKey("/search", "?q=shoes"))).resolves.toBeUndefined();
    await expect(folded.getOrSet(pprKey("/search", "?q=shoes"), () => "shoes")).resolves.toBe(
      "shoes",
    );
  });
});
