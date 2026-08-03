import { describe, expect, it } from "vitest";
import type { FarmCacheEntry } from "@farm.js/core/cache";
import { redisCache, redisRateLimitStorage, type FarmRedisClient } from "./index";

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

describe("redisRateLimitStorage", () => {
  it("increments a fixed-window counter atomically and exposes its status", async () => {
    const client = new FakeRedis();
    const storage = redisRateLimitStorage({ client, prefix: "limits" });

    const increments = await Promise.all(
      Array.from({ length: 50 }, () => storage.increment("account:42", 60_000)),
    );

    expect(increments.map((entry) => entry.count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
    await expect(storage.get?.("account:42")).resolves.toMatchObject({ count: 50 });
  });
});

class FakeRedis implements FarmRedisClient {
  private values = new Map<string, string>();
  private expiresAt = new Map<string, number>();

  private read(key: string): string | null {
    const expiry = this.expiresAt.get(key);
    if (expiry !== undefined && expiry <= Date.now()) {
      this.values.delete(key);
      this.expiresAt.delete(key);
    }
    return this.values.get(key) ?? null;
  }

  async get(key: string): Promise<string | null> {
    return this.read(key);
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    if (args.includes("NX") && this.values.has(key)) return null;
    this.values.set(key, value);
    const pxIndex = args.indexOf("PX");
    if (pxIndex >= 0 && typeof args[pxIndex + 1] === "number") {
      this.expiresAt.set(key, Date.now() + Number(args[pxIndex + 1]));
    }
    return "OK";
  }

  async del(key: string): Promise<number> {
    this.expiresAt.delete(key);
    return this.values.delete(key) ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.read(key) ?? 0) + 1;
    this.values.set(key, String(next));
    return next;
  }

  async pttl(key: string): Promise<number> {
    if (this.read(key) === null) return -2;
    const expiry = this.expiresAt.get(key);
    return expiry === undefined ? -1 : Math.max(0, expiry - Date.now());
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return Promise.all(keys.map((key) => this.get(key)));
  }

  async eval(script: string, _numberOfKeys: number, key: string, arg: string): Promise<unknown> {
    if (script.includes('redis.call("INCR"')) {
      const count = Number(this.read(key) ?? 0) + 1;
      this.values.set(key, String(count));
      const expiry = this.expiresAt.get(key);
      let ttl = expiry === undefined ? -1 : Math.max(0, expiry - Date.now());
      if (count === 1 || ttl < 0) {
        ttl = Number(arg);
        this.expiresAt.set(key, Date.now() + ttl);
      }
      return [count, ttl];
    }

    if (this.read(key) !== arg) return 0;
    return this.del(key);
  }
}
