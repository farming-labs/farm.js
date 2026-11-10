import { afterEach, describe, expect, it } from "vitest";
import {
  FarmDataCache,
  getFarmDataCache,
  PPR_SHELL_ADAPTER_TTL_SECONDS,
  storageCacheAdapter,
  type FarmCacheStorage,
} from "../cache";
import { resolveFarmI18nConfig } from "../i18n/config";
import { FarmI18nRuntime } from "../i18n/runtime";
import { ServerRenderer } from "../server/renderer";

// PPR shells are keyed by the query string, so anonymous visitors choose how many exist.
// They must not push app data out of memory, and must not live forever in shared storage.

const shell = { paths: ["/p"], tags: ["ppr"], revalidate: false as const };

function createMapStorage() {
  const ttls = new Map<string, number | undefined>();
  const store = new Map<string, unknown>();
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
  const ttlOf = (name: string) =>
    ttls.get(`farm-cache:entry:${encodeURIComponent(`app:entry:${name}`)}`);
  return { storage, ttls, ttlOf };
}

describe("PPR shell cache bounds", () => {
  afterEach(() => {
    getFarmDataCache().clear();
  });

  it("the renderer's shells never evict the app's process-wide cache entries", async () => {
    const i18n = resolveFarmI18nConfig(undefined, { root: "/test", mode: "production" });
    const config = { root: "/test", srcDir: "src", outDir: "dist", basePath: "/", i18n };
    const renderer = new ServerRenderer(config as any, {} as any, new FarmI18nRuntime(i18n)) as any;
    await getFarmDataCache().setAsync("app:user:alice", "cached");

    // One more variant than the default 1,024-entry memory limit.
    for (let index = 0; index <= 1_024; index++) {
      await renderer.cachePPRShell({ pathname: "/p", search: `?v=${index}` }, "<p>shell</p>");
    }

    expect(getFarmDataCache().get("app:user:alice")).toBe("cached");
    expect(await renderer.getCachedPPRShell("/p", "?v=1024")).toBeDefined();
  });

  it("a flood of shell variants never evicts app cache entries", async () => {
    const cache = new FarmDataCache({ maxEntries: 4 });
    let calls = 0;
    const load = () => cache.getOrSet("app:user", async () => ++calls);
    await load();

    for (let index = 0; index < 50; index++) {
      await cache.pprShellCache.setAsync(`ppr:/p?v=${index}`, { html: `<p>${index}</p>` }, shell);
    }

    expect(await load()).toBe(1);
    expect(calls).toBe(1);
    // The shells keep their own LRU of the same size.
    expect(cache.size).toBe(1);
    expect(cache.pprShellCache.size).toBe(4);
    expect(await cache.pprShellCache.getEntryAsync("ppr:/p?v=0")).toBeUndefined();
    expect((await cache.pprShellCache.getEntryAsync("ppr:/p?v=49"))?.value).toEqual({
      html: "<p>49</p>",
    });
  });

  it("revalidatePath, revalidateTag and clear still reach the shells", async () => {
    const cache = new FarmDataCache();
    const shells = cache.pprShellCache;
    expect(cache.pprShellCache).toBe(shells);

    await shells.setAsync("ppr:/p", { html: "a" }, shell);
    expect(cache.revalidatePath("/p")).toBe(1);
    expect(await shells.getEntryAsync("ppr:/p")).toBeUndefined();

    await shells.setAsync("ppr:/p", { html: "b" }, shell);
    expect(cache.revalidateTag("ppr")).toBe(1);
    expect(await shells.getEntryAsync("ppr:/p")).toBeUndefined();

    await shells.setAsync("ppr:/p", { html: "c" }, shell);
    cache.clear();
    expect(shells.size).toBe(0);
  });

  it("gives shells stored through an adapter a default ttl, and leaves app entries alone", async () => {
    const { storage, ttlOf } = createMapStorage();
    const cache = new FarmDataCache({ adapter: storageCacheAdapter(storage), namespace: "app" });

    await cache.setAsync("app:forever", "value", { revalidate: false });
    await cache.pprShellCache.setAsync("ppr:/p?v=1", { html: "x" }, shell);
    await cache.pprShellCache.setAsync("ppr:/p?v=2", { html: "y" }, { ...shell, revalidate: 30 });

    expect(ttlOf("app:forever")).toBeUndefined();
    expect(ttlOf("ppr:/p?v=1")).toBe(PPR_SHELL_ADAPTER_TTL_SECONDS);
    // A route revalidate keeps its own window.
    expect(ttlOf("ppr:/p?v=2")).toBe(90);
    expect((await cache.pprShellCache.getEntryAsync("ppr:/p?v=1"))?.value).toEqual({ html: "x" });
  });

  it("shares adapter invalidation with the app cache", async () => {
    const { storage } = createMapStorage();
    const versions = new Map<string, number>();
    const adapter = {
      ...storageCacheAdapter(storage),
      getTagVersions: async (tags: readonly string[]) =>
        Object.fromEntries(tags.map((tag) => [tag, versions.get(tag) ?? 0])),
      invalidateTags: async (tags: readonly string[]) => {
        for (const tag of tags) versions.set(tag, (versions.get(tag) ?? 0) + 1);
      },
    };
    const cache = new FarmDataCache({ adapter, namespace: "app" });

    await cache.pprShellCache.setAsync("ppr:/p", { html: "x" }, shell);
    await cache.revalidatePathAsync("/p");
    expect(await cache.pprShellCache.getEntryAsync("ppr:/p")).toBeUndefined();
  });
});
