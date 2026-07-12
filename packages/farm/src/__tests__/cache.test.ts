import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
  invalidate,
  invalidateRouteData,
  normalizeRevalidatePath,
  revalidatePath,
  revalidateTag,
  unstable_cache,
  updateTag,
} from "../cache";
import {
  configureFarmObservability,
  resetFarmObservability,
  type FarmEvent,
} from "../observability";

describe("server cache primitives", () => {
  afterEach(() => {
    resetFarmObservability();
    getFarmDataCache().clear();
    vi.useRealTimers();
  });

  it("shares the cache across server module instances", () => {
    expect((globalThis as any)[Symbol.for("farm.dataCache")]).toBe(getFarmDataCache());
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
