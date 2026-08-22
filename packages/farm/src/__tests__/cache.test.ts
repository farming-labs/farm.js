import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureFarmCache,
  createFarmCacheKey,
  createRouteDataCacheTag,
  defineCacheKey,
  FarmDataCache,
  getFarmDataCache,
  invalidate,
  invalidateRouteData,
  normalizeRevalidatePath,
  revalidatePath,
  revalidateTag,
  type FarmCacheAdapter,
  type FarmCacheEntry,
  unstable_cache,
  updateTag,
} from "../cache";
import {
  configureFarmObservability,
  resetFarmObservability,
  type FarmEvent,
} from "../observability";
import {
  getServerActionInvalidations,
  runWithServerActionRequest,
} from "../server-action-security";

describe("server cache primitives", () => {
  afterEach(() => {
    resetFarmObservability();
    configureFarmCache(undefined);
    getFarmDataCache().clear();
    vi.useRealTimers();
  });

  it("shares the cache across server module instances", () => {
    expect((globalThis as any)[Symbol.for("farm.dataCache")]).toBe(getFarmDataCache());
  });

  it("keeps defined cache keys runtime-compatible with structured arrays", () => {
    const productKey = defineCacheKey<{ id: string; name: string }>()(
      (id: string) => ["product", "detail", id] as const,
    );

    expect(productKey("123")).toEqual(["product", "detail", "123"]);
    expect(createFarmCacheKey(productKey("123"))).toBe(
      createFarmCacheKey(["product", "detail", "123"]),
    );
  });

  it("serializes object keys in locale-independent codepoint order", () => {
    // localeCompare would order these a, ä, b, B under an English locale and
    // a, b, B, z, ä under Swedish — the key must not depend on the host
    // locale.
    const key = createFarmCacheKey([{ b: 1, a: 2, B: 3, ä: 4 }]);
    expect(key).toBe('[{"B":number:3,"a":number:2,"b":number:1,"ä":number:4}]');
  });

  it("rejects invalid values returned by defined cache key factories", () => {
    const invalidKey = defineCacheKey<unknown>()((() => ({ scope: "product" })) as any);

    expect(() => invalidKey()).toThrow(
      "A defined cache key factory must return a string or structured array.",
    );
  });

  it("caches unstable_cache results by key parts and arguments", async () => {
    let calls = 0;
    const getProduct = unstable_cache(
      async (id: string) => {
        calls++;
        return { id, calls };
      },
      ["product"],
      { tags: ["products"], revalidate: 60 },
    );

    await expect(getProduct("a")).resolves.toEqual({ id: "a", calls: 1 });
    await expect(getProduct("a")).resolves.toEqual({ id: "a", calls: 1 });
    await expect(getProduct("b")).resolves.toEqual({ id: "b", calls: 2 });
    expect(calls).toBe(2);
  });

  it("revalidates cached entries by tag", async () => {
    let calls = 0;
    const getProducts = unstable_cache(
      async () => {
        calls++;
        return [`call-${calls}`];
      },
      ["products"],
      { tags: ["products"] },
    );

    await expect(getProducts()).resolves.toEqual(["call-1"]);
    await expect(getProducts()).resolves.toEqual(["call-1"]);

    revalidateTag("products", "max");

    await expect(getProducts()).resolves.toEqual(["call-2"]);
    expect(calls).toBe(2);
  });

  it("revalidates cached entries by path", async () => {
    let calls = 0;
    const getDashboard = unstable_cache(
      async () => {
        calls++;
        return { calls };
      },
      ["dashboard"],
      { paths: ["/dashboard/"] },
    );

    await expect(getDashboard()).resolves.toEqual({ calls: 1 });
    revalidatePath("dashboard");
    await expect(getDashboard()).resolves.toEqual({ calls: 2 });
  });

  it("revalidates PPR shell entries through the shared path cache", () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({ onEvent: (event) => events.push(event) });
    const cache = getFarmDataCache();
    const key = createFarmCacheKey(["ppr", normalizeRevalidatePath("/dashboard"), ""]);

    cache.set(key, { html: "<html>dashboard</html>" }, { paths: ["/dashboard"], tags: ["ppr"] });

    expect(cache.getEntry<{ html: string }>(key)?.value.html).toContain("dashboard");

    revalidatePath("/dashboard");

    expect(cache.getEntry(key)).toBeUndefined();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "cache.revalidatePath",
          path: "/dashboard",
          count: 1,
        }),
        expect.objectContaining({
          type: "ppr.shell.invalidated",
          route: "/dashboard",
          reason: "revalidatePath",
          count: 1,
        }),
      ]),
    );
  });

  it("supports updateTag as immediate tag invalidation", async () => {
    let calls = 0;
    const getUser = unstable_cache(
      async () => {
        calls++;
        return { calls };
      },
      ["user"],
      { tags: ["user:1"] },
    );

    await expect(getUser()).resolves.toEqual({ calls: 1 });
    updateTag("user:1");
    await expect(getUser()).resolves.toEqual({ calls: 2 });
  });

  it("invalidates route data cache entries by structured key", async () => {
    let calls = 0;
    const key = ["product", "123"] as const;
    const cacheKey = createFarmCacheKey(["route-data", key]);

    await expect(
      getFarmDataCache().getOrSet(
        cacheKey,
        async () => {
          calls++;
          return { id: "123", calls };
        },
        { tags: [createRouteDataCacheTag(key)] },
      ),
    ).resolves.toEqual({ id: "123", calls: 1 });

    await expect(
      getFarmDataCache().getOrSet(cacheKey, async () => {
        calls++;
        return { id: "123", calls };
      }),
    ).resolves.toEqual({ id: "123", calls: 1 });

    invalidate(key);

    await expect(
      getFarmDataCache().getOrSet(
        cacheKey,
        async () => {
          calls++;
          return { id: "123", calls };
        },
        { tags: [createRouteDataCacheTag(key)] },
      ),
    ).resolves.toEqual({ id: "123", calls: 2 });

    invalidateRouteData(key);

    await expect(
      getFarmDataCache().getOrSet(
        cacheKey,
        async () => {
          calls++;
          return { id: "123", calls };
        },
        { tags: [createRouteDataCacheTag(key)] },
      ),
    ).resolves.toEqual({ id: "123", calls: 3 });
  });

  it("records structured invalidations during a server action", async () => {
    const request = new Request("https://farm.test/products", { method: "POST" });

    const invalidations = await runWithServerActionRequest(request, async () => {
      invalidate(["product", "123"]);
      return getServerActionInvalidations();
    });

    expect(invalidations).toEqual([createFarmCacheKey(["product", "123"])]);
  });

  it("waits for distributed invalidation before a server action completes", async () => {
    let releaseInvalidation!: () => void;
    const invalidationGate = new Promise<void>((resolve) => {
      releaseInvalidation = resolve;
    });
    const invalidateTags = vi.fn(async () => invalidationGate);
    configureFarmCache({
      adapter: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
        getTagVersions: async () => ({}),
        invalidateTags,
      },
    });
    const request = new Request("https://farm.test/products", { method: "POST" });
    let completed = false;

    const action = runWithServerActionRequest(request, () => {
      invalidate(["product", "123"]);
      return { ok: true };
    }).then((result) => {
      completed = true;
      return result;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    expect(invalidateTags).toHaveBeenCalledOnce();

    releaseInvalidation();
    await expect(action).resolves.toEqual({ ok: true });
    expect(completed).toBe(true);
  });

  it("expires entries using revalidate seconds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const getStats = unstable_cache(
      async () => {
        calls++;
        return { calls };
      },
      ["stats"],
      { revalidate: 1 },
    );

    await expect(getStats()).resolves.toEqual({ calls: 1 });
    await expect(getStats()).resolves.toEqual({ calls: 1 });

    vi.advanceTimersByTime(1001);

    await expect(getStats()).resolves.toEqual({ calls: 2 });
  });

  it("keeps same-named functions in separate cache entries", async () => {
    // Two different functions that happen to share the name getUser, as two
    // modules would. Before including the source in the identity, the second
    // wrapper served the first wrapper's cached data.
    const fromA = (() => {
      const getUser = async () => ({ from: "A" });
      return unstable_cache(getUser);
    })();
    const fromB = (() => {
      const getUser = async () => ({ from: "B" });
      return unstable_cache(getUser);
    })();

    await expect(fromA()).resolves.toEqual({ from: "A" });
    await expect(fromB()).resolves.toEqual({ from: "B" });
  });

  it("treats revalidate: 0 as always stale", async () => {
    let calls = 0;
    const getPrices = unstable_cache(
      async () => {
        calls++;
        return { calls };
      },
      ["prices"],
      { revalidate: 0 },
    );

    await expect(getPrices()).resolves.toEqual({ calls: 1 });
    await expect(getPrices()).resolves.toEqual({ calls: 2 });
    expect(calls).toBe(2);
  });

  it("dedupes concurrent cache fills", async () => {
    let calls = 0;
    const getProfile = unstable_cache(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { calls };
    }, ["profile"]);

    const [first, second] = await Promise.all([getProfile(), getProfile()]);

    expect(first).toEqual({ calls: 1 });
    expect(second).toEqual({ calls: 1 });
    expect(calls).toBe(1);
  });

  it("shares entries and tag invalidation through a distributed adapter", async () => {
    const adapter = new TestSharedCacheAdapter();
    const first = new FarmDataCache({ adapter, namespace: "catalog" });
    const second = new FarmDataCache({ adapter, namespace: "catalog" });
    let calls = 0;
    const produce = async () => ({ calls: ++calls });

    await expect(
      first.getOrSet("featured", produce, {
        tags: ["products"],
        revalidate: 60,
      }),
    ).resolves.toEqual({ calls: 1 });
    await expect(
      second.getOrSet("featured", produce, {
        tags: ["products"],
        revalidate: 60,
      }),
    ).resolves.toEqual({ calls: 1 });

    await first.revalidateTagAsync("products");

    await expect(
      second.getOrSet("featured", produce, {
        tags: ["products"],
        revalidate: 60,
      }),
    ).resolves.toEqual({ calls: 2 });
    expect(calls).toBe(2);
  });

  it("isolates distributed entries by cache namespace", async () => {
    const adapter = new TestSharedCacheAdapter();
    const storefront = new FarmDataCache({ adapter, namespace: "storefront" });
    const admin = new FarmDataCache({ adapter, namespace: "admin" });

    await storefront.setAsync("settings", { theme: "light" });
    await admin.setAsync("settings", { theme: "dark" });

    await expect(storefront.getEntryAsync("settings")).resolves.toMatchObject({
      value: { theme: "light" },
    });
    await expect(admin.getEntryAsync("settings")).resolves.toMatchObject({
      value: { theme: "dark" },
    });
  });

  it("deduplicates cache fills across instances with adapter leases", async () => {
    const adapter = new TestSharedCacheAdapter();
    const first = new FarmDataCache({ adapter, namespace: "catalog" });
    const second = new FarmDataCache({ adapter, namespace: "catalog" });
    let calls = 0;
    const produce = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { calls };
    };

    const [left, right] = await Promise.all([
      first.getOrSet("popular", produce, { tags: ["products"] }),
      second.getOrSet("popular", produce, { tags: ["products"] }),
    ]);

    expect(left).toEqual({ calls: 1 });
    expect(right).toEqual({ calls: 1 });
    expect(calls).toBe(1);
  });

  it("does not make a value fresh when its tag is invalidated during generation", async () => {
    const adapter = new TestSharedCacheAdapter();
    const first = new FarmDataCache({ adapter, namespace: "catalog" });
    const second = new FarmDataCache({ adapter, namespace: "catalog" });
    let finishGeneration!: () => void;
    const generationGate = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    let calls = 0;

    const firstGeneration = first.getOrSet(
      "featured",
      async () => {
        calls++;
        await generationGate;
        return { calls };
      },
      { tags: ["products"] },
    );

    await vi.waitFor(() => expect(calls).toBe(1));
    await second.revalidateTagAsync("products");
    finishGeneration();
    await expect(firstGeneration).resolves.toEqual({ calls: 1 });

    await expect(
      second.getOrSet("featured", async () => ({ calls: ++calls }), { tags: ["products"] }),
    ).resolves.toEqual({ calls: 2 });
  });

  it("emits hit, miss, set, and tag revalidation observability events", async () => {
    const events: FarmEvent[] = [];
    configureFarmObservability({ onEvent: (event) => events.push(event) });
    let calls = 0;
    const getProduct = unstable_cache(
      async (id: string) => {
        calls++;
        return { id, calls };
      },
      ["observability-product"],
      { tags: ["products"], revalidate: 60 },
    );

    await getProduct("a");
    await getProduct("a");
    revalidateTag("products", "max");

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "cache.miss", level: "debug" }),
        expect.objectContaining({ type: "cache.set", tags: ["products"], revalidate: 60 }),
        expect.objectContaining({ type: "cache.hit", tags: ["products"], stale: false }),
        expect.objectContaining({ type: "cache.revalidateTag", tag: "products", count: 1 }),
      ]),
    );
    expect(events.every((event) => typeof event.timestamp === "number")).toBe(true);
  });

  it("normalizes paths and stable cache keys", () => {
    expect(normalizeRevalidatePath("https://example.com/docs/?q=1")).toBe("/docs");
    expect(normalizeRevalidatePath("docs///intro/")).toBe("/docs/intro");
    expect(createFarmCacheKey([{ b: 1, a: 2 }])).toBe(createFarmCacheKey([{ a: 2, b: 1 }]));
  });
});

class TestSharedCacheAdapter implements FarmCacheAdapter {
  readonly name = "test-shared";
  private entries = new Map<string, FarmCacheEntry>();
  private tagVersions = new Map<string, number>();
  private leases = new Map<string, string>();
  private version = 0;
  private leaseVersion = 0;

  async get<T>(key: string): Promise<FarmCacheEntry<T> | null> {
    return (structuredClone(this.entries.get(key)) as FarmCacheEntry<T> | undefined) ?? null;
  }

  async set<T>(key: string, entry: FarmCacheEntry<T>): Promise<void> {
    this.entries.set(key, structuredClone(entry));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.tagVersions.clear();
    this.leases.clear();
  }

  async getTagVersions(tags: readonly string[]): Promise<Readonly<Record<string, number>>> {
    return Object.fromEntries(tags.map((tag) => [tag, this.tagVersions.get(tag) ?? 0]));
  }

  async invalidateTags(tags: readonly string[]): Promise<void> {
    const version = ++this.version;
    for (const tag of tags) {
      this.tagVersions.set(tag, version);
    }
  }

  async acquireLease(key: string): Promise<string | null> {
    if (this.leases.has(key)) return null;
    const token = `lease-${++this.leaseVersion}`;
    this.leases.set(key, token);
    return token;
  }

  async releaseLease(key: string, token: string): Promise<void> {
    if (this.leases.get(key) === token) {
      this.leases.delete(key);
    }
  }
}
