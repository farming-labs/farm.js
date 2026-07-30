import type { FarmCacheAdapter, FarmCacheEntry } from "@farm.js/core/cache";

export interface FarmRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  set(
    key: string,
    value: string,
    expiryMode: "PX",
    ttlMs: number,
    condition: "NX",
  ): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  mget?(...keys: string[]): Promise<Array<string | null>>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export interface RedisCacheOptions {
  /** Existing Redis-compatible client or a lazy client factory. */
  client: FarmRedisClient | (() => FarmRedisClient | Promise<FarmRedisClient>);
  /** Prefix isolating Farm cache records from other Redis data. */
  prefix?: string;
}

const RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

/**
 * Create a Redis-backed Farm cache with atomic tag versions and regeneration
 * leases.
 */
export function redisCache(options: RedisCacheOptions): FarmCacheAdapter {
  if (!options?.client) {
    throw new TypeError("redisCache requires a Redis-compatible client.");
  }

  const prefix = normalizePrefix(options.prefix || "farm-cache");
  let clientPromise: Promise<FarmRedisClient> | undefined;

  const getClient = () => {
    clientPromise ??= Promise.resolve(
      typeof options.client === "function" ? options.client() : options.client,
    );
    return clientPromise;
  };
  const key = (value: string) => `${prefix}:${value}`;

  return {
    name: "redis",
    async get<T>(cacheKey: string): Promise<FarmCacheEntry<T> | null> {
      const serialized = await (await getClient()).get(key(cacheKey));
      if (serialized === null) return null;

      try {
        return JSON.parse(serialized) as FarmCacheEntry<T>;
      } catch (error) {
        throw new Error(`Redis cache entry ${JSON.stringify(cacheKey)} is not valid JSON.`, {
          cause: error,
        });
      }
    },
    async set<T>(cacheKey: string, entry: FarmCacheEntry<T>): Promise<void> {
      let serialized: string;
      try {
        serialized = JSON.stringify(entry);
      } catch (error) {
        throw new TypeError(
          `Redis cache entry ${JSON.stringify(cacheKey)} is not JSON serializable.`,
          { cause: error },
        );
      }
      await (await getClient()).set(key(cacheKey), serialized);
    },
    async delete(cacheKey: string): Promise<void> {
      await (await getClient()).del(key(cacheKey));
    },
    async getTagVersions(tags: readonly string[]) {
      if (tags.length === 0) return {};
      const client = await getClient();
      const keys = tags.map((tag) => key(`tag-version:${tag}`));
      const values = client.mget
        ? await client.mget(...keys)
        : await Promise.all(keys.map((tagKey) => client.get(tagKey)));
      return Object.fromEntries(tags.map((tag, index) => [tag, normalizeVersion(values[index])]));
    },
    async invalidateTags(tags: readonly string[]): Promise<void> {
      const client = await getClient();
      await Promise.all(tags.map((tag) => client.incr(key(`tag-version:${tag}`))));
    },
    async acquireLease(leaseKey: string, ttlMs: number): Promise<string | null> {
      const token = createLeaseToken();
      const result = await (
        await getClient()
      ).set(key(`lease:${leaseKey}`), token, "PX", ttlMs, "NX");
      return result === "OK" ? token : null;
    },
    async releaseLease(leaseKey: string, token: string): Promise<void> {
      await (await getClient()).eval(RELEASE_LEASE_SCRIPT, 1, key(`lease:${leaseKey}`), token);
    },
  };
}

function normalizePrefix(value: string): string {
  const prefix = value.trim().replace(/:+$/g, "");
  if (!prefix) throw new TypeError("redisCache prefix cannot be empty.");
  return prefix;
}

function normalizeVersion(value: string | null | undefined): number {
  if (!value) return 0;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : 0;
}

function createLeaseToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
