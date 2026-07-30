import { describe, expect, it } from "vitest";
import type { FarmCacheEntry } from "@farm.js/core/cache";
import { redisCache, type FarmRedisClient } from "./index";

describe("redisCache", () => {
  it("stores entries, increments tag versions, and owns leases", async () => {
    const client = new FakeRedis();
    const adapter = redisCache({ client, prefix: "test" });
    const entry: FarmCacheEntry<{ id: string }> = {
      key: "product:1",
      value: { id: "1" },
      tags: ["products"],
      tagVersions: { products: 0 },
      createdAt: Date.now(),
    };

    await adapter.set("product:1", entry);
    await expect(adapter.get("product:1")).resolves.toEqual(entry);
    await expect(adapter.getTagVersions?.(["products"])).resolves.toEqual({
      products: 0,
    });

    await adapter.invalidateTags?.(["products"]);
    await expect(adapter.getTagVersions?.(["products"])).resolves.toEqual({
      products: 1,
    });

    const lease = await adapter.acquireLease?.("product:1", 1_000);
    expect(lease).toEqual(expect.any(String));
    await expect(adapter.acquireLease?.("product:1", 1_000)).resolves.toBeNull();

    await adapter.releaseLease?.("product:1", "not-the-owner");
    await expect(adapter.acquireLease?.("product:1", 1_000)).resolves.toBeNull();

    await adapter.releaseLease?.("product:1", lease!);
    await expect(adapter.acquireLease?.("product:1", 1_000)).resolves.toEqual(expect.any(String));
  });
});

class FakeRedis implements FarmRedisClient {
  private values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    if (args.includes("NX") && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, String(next));
    return next;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  async eval(_script: string, _numberOfKeys: number, key: string, token: string): Promise<unknown> {
    if ((await this.get(key)) !== token) return 0;
    return this.del(key);
  }
}
