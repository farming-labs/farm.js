import type { FarmCacheAdapter, FarmCacheEntry } from "@farm.js/core/cache";
import type { RateLimitStorage } from "@farm.js/core/middleware";

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

export interface FarmRedisRateLimitClient extends FarmRedisClient {
  pttl(key: string): Promise<number>;
}

export interface RedisCacheOptions {
  /** Existing Redis-compatible client or a lazy client factory. */
  client: FarmRedisClient | (() => FarmRedisClient | Promise<FarmRedisClient>);
  /** Prefix isolating Farm cache records from other Redis data. */
  prefix?: string;
}

export interface RedisRateLimitOptions {
  /** Existing Redis-compatible client or a lazy client factory. */
  client:
    | FarmRedisRateLimitClient
    | (() => FarmRedisRateLimitClient | Promise<FarmRedisRateLimitClient>);
  /** Prefix isolating rate-limit counters from other Redis data. */
  prefix?: string;
}

const RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const INCREMENT_RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl <= 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

/**
 * Create a Redis-backed Farm cache with atomic tag versions and regeneration
 * leases.
 */
export function redisCache(options: RedisCacheOptions): FarmCacheAdapter {
  if (!options?.client) {
    throw new TypeError("redisCache requires a Redis-compatible client.");
  }

  const prefix = normalizePrefix(options.prefix || "farm-cache", "redisCache");
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

/** Create a Redis-backed atomic fixed-window rate-limit store. */
export function redisRateLimitStorage(options: RedisRateLimitOptions): RateLimitStorage {
  if (!options?.client) {
    throw new TypeError("redisRateLimitStorage requires a Redis-compatible client.");
  }

  const prefix = normalizePrefix(options.prefix || "farm-ratelimit", "redisRateLimitStorage");
  let clientPromise: Promise<FarmRedisRateLimitClient> | undefined;
  const getClient = () => {
    clientPromise ??= Promise.resolve(
      typeof options.client === "function" ? options.client() : options.client,
    );
    return clientPromise;
  };
  const key = (value: string) => `${prefix}:${value}`;

  return {
    async increment(rateLimitKey, windowMs) {
      if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
        throw new TypeError("Rate-limit windowMs must be a positive safe integer.");
      }

      const result = await (
        await getClient()
      ).eval(INCREMENT_RATE_LIMIT_SCRIPT, 1, key(rateLimitKey), String(windowMs));
      if (!Array.isArray(result) || result.length < 2) {
        throw new Error("Redis returned an invalid atomic rate-limit result.");
      }

      const count = Number(result[0]);
      const ttlMs = Number(result[1]);
      if (!Number.isSafeInteger(count) || count <= 0 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error("Redis returned an invalid atomic rate-limit count or expiry.");
      }

      return { count, resetAt: Date.now() + ttlMs };
    },
    async get(rateLimitKey) {
      const client = await getClient();
      const redisKey = key(rateLimitKey);
      const [serializedCount, ttlMs] = await Promise.all([
        client.get(redisKey),
        client.pttl(redisKey),
      ]);
      if (serializedCount === null || ttlMs <= 0) return null;

      const count = Number(serializedCount);
      if (!Number.isSafeInteger(count) || count <= 0) {
        throw new Error(`Redis rate-limit counter ${JSON.stringify(rateLimitKey)} is invalid.`);
      }
      return { count, resetAt: Date.now() + ttlMs };
    },
  };
}

function normalizePrefix(value: string, owner: string): string {
  const prefix = value.trim().replace(/:+$/g, "");
  if (!prefix) throw new TypeError(`${owner} prefix cannot be empty.`);
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
