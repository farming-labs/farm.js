import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmCacheKey,
  getFarmDataCache,
  normalizeRevalidatePath,
  revalidatePath,
  revalidateTag,
  unstable_cache,
  updateTag,
} from "../cache";

describe("server cache primitives", () => {
  afterEach(() => {
    getFarmDataCache().clear();
    vi.useRealTimers();
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

  it("normalizes paths and stable cache keys", () => {
    expect(normalizeRevalidatePath("https://example.com/docs/?q=1")).toBe("/docs");
    expect(normalizeRevalidatePath("docs///intro/")).toBe("/docs/intro");
    expect(createFarmCacheKey([{ b: 1, a: 2 }])).toBe(createFarmCacheKey([{ a: 2, b: 1 }]));
  });
});
