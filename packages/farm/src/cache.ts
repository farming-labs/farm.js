import { emitFarmEvent } from "./observability";
import { notifyFarmCacheInvalidation, notifyFarmCacheTask } from "./cache-invalidation";
import { getActiveFarmI18nSnapshot } from "./i18n/bridge";
import {
  createFarmCacheKey,
  createRouteDataCacheKey,
  getFunctionCacheIdentity,
  type RouteDataCacheKey,
} from "./cache-key";

export { applyFarmCacheInvalidations } from "./cache-invalidation";
export { createFarmCacheInvalidationStream } from "./cache-invalidation-stream";
export type { FarmCacheInvalidationStreamOptions } from "./cache-invalidation-stream";
export { createFarmCacheKey, createRouteDataCacheKey, type RouteDataCacheKey } from "./cache-key";

export type RevalidateTagProfile =
  | "max"
  | "default"
  | "seconds"
  | "minutes"
  | "hours"
  | "days"
  | "weeks"
  | "months"
  | { expire?: number };

export interface FarmCacheOptions {
  /**
   * Tag cached data so it can be invalidated with revalidateTag/updateTag.
   */
  tags?: readonly string[];
  /**
   * Path tags let revalidatePath invalidate data tied to a route.
   */
  paths?: readonly string[];
  /**
   * Time in seconds before the entry becomes stale. False means no TTL.
   */
  revalidate?: number | false;
}

export interface FarmCacheSetOptions extends FarmCacheOptions {
  createdAt?: number;
}

export type FarmCacheInvalidationTarget =
  | { key: RouteDataCacheKey }
  | { path: string }
  | { tag: string };

/**
 * A regular Farm cache key carrying the data shape stored under that key.
 *
 * The brand exists only in TypeScript. At runtime the value remains the
 * original string or structured array, so all existing cache APIs continue to
 * accept untyped keys. `__farmDefinedCacheKeyData` is reserved for Farm's type
 * system and must not be declared by application types.
 */
export type DefinedCacheKey<TData, TKey extends RouteDataCacheKey = RouteDataCacheKey> = TKey & {
  /** @internal Reserved type-only brand shared by the ESM and CommonJS declarations. */
  readonly __farmDefinedCacheKeyData: TData;
};

export type CacheKeyFactory<
  TData,
  TArguments extends readonly unknown[],
  TKey extends RouteDataCacheKey = RouteDataCacheKey,
> = (...args: TArguments) => DefinedCacheKey<TData, TKey>;

export type InferCacheKeyData<TKey> =
  TKey extends DefinedCacheKey<infer TData, RouteDataCacheKey> ? TData : unknown;

/**
 * Optionally add a data type to an existing string/array cache-key factory.
 *
 * This helper does not introduce a new runtime key representation. Calling the
 * returned factory produces the exact key returned by `factory`.
 */
export function defineCacheKey<TData>() {
  return <const TArguments extends readonly unknown[], const TKey extends RouteDataCacheKey>(
    factory: (...args: TArguments) => TKey,
  ): CacheKeyFactory<TData, TArguments, TKey> => {
    if (typeof factory !== "function") {
      throw new TypeError("defineCacheKey expects a key factory function.");
    }

    return ((...args: TArguments) => {
      const key = factory(...args);
      if (typeof key !== "string" && !Array.isArray(key)) {
        throw new TypeError(
          "A defined cache key factory must return a string or structured array.",
        );
      }
      return key as DefinedCacheKey<TData, TKey>;
    }) as CacheKeyFactory<TData, TArguments, TKey>;
  };
}

export interface FarmCacheEntry<T = unknown> {
  key: string;
  value: T;
  tags: readonly string[];
  /**
   * Adapter tag versions captured before the cached value was produced.
   * A later version makes the entry stale across every server instance.
   */
  tagVersions?: Readonly<Record<string, number>>;
  createdAt: number;
  createdVersion?: number;
  revalidate?: number | false;
  /**
   * Epoch milliseconds after which no reader can use the entry, so shared
   * storage may drop it. Set only for entries with a finite `revalidate`.
   * Adapters with native expiry (Redis PX, unstorage `ttl`) should honor it.
   */
  expiresAt?: number;
}

interface InternalFarmCacheEntry<T = unknown> {
  key: string;
  value: T;
  tags: Set<string>;
  tagVersions?: Readonly<Record<string, number>>;
  createdAt: number;
  createdVersion: number;
  revalidate?: number | false;
}

/**
 * Asynchronous persistence contract used by distributed Farm caches.
 *
 * Implementations are responsible for serializing cache entries and making
 * tag version updates atomic when the backing service supports it.
 */
export interface FarmCacheAdapter {
  readonly name?: string;
  get<T = unknown>(key: string): Promise<FarmCacheEntry<T> | null | undefined>;
  set<T = unknown>(key: string, entry: FarmCacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(): Promise<void>;
  getTagVersions?(tags: readonly string[]): Promise<Readonly<Record<string, number>>>;
  invalidateTags?(tags: readonly string[]): Promise<void>;
  /** Atomically acquire a short-lived regeneration lease. */
  acquireLease?(key: string, ttlMs: number): Promise<string | null | undefined>;
  /** Release the lease only when the supplied ownership token still matches. */
  releaseLease?(key: string, token: string): Promise<void>;
}

export interface FarmClientCacheUserConfig {
  /**
   * Module path, relative to the project root, whose default export is a
   * client cache adapter (`defineClientCacheAdapter`). The module is bundled
   * into the browser entry; the server never imports it.
   */
  adapter?: string;
  /** Extra version salt, typically a build or deploy id; entries persisted under another salt are dropped. */
  version?: string;
  /** Debounce for persisted write-behind flushes, in milliseconds. */
  flushDelayMs?: number;
}

export interface FarmCacheUserConfig {
  /** Shared cache implementation, for example a Redis-backed adapter. */
  adapter?: FarmCacheAdapter;
  /** Prefix isolating applications and deployments sharing one adapter. */
  namespace?: string;
  /** Maximum process-local entries retained in memory. @default 1024 */
  maxEntries?: number;
  /** Browser cache persistence; see the client cache adapter documentation. */
  client?: FarmClientCacheUserConfig;
  /**
   * Coordinate cache fills across processes when the adapter implements
   * acquireLease/releaseLease. Set false to disable.
   */
  lease?:
    | false
    | {
        ttlMs?: number;
        waitTimeoutMs?: number;
        pollIntervalMs?: number;
      };
}

export interface FarmCacheStorage {
  getItem<T = unknown>(key: string): Promise<T | null>;
  /** `options.ttl` is in seconds, matching unstorage drivers that support expiry. */
  setItem<T = unknown>(key: string, value: T, options?: { ttl?: number }): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
  clear?(base?: string): Promise<unknown>;
}

export interface StorageFarmCacheAdapterOptions {
  /** Prefix used inside the supplied storage client. */
  base?: string;
}

/**
 * Adapt a Farm/unstorage-compatible key-value client to the cache contract.
 *
 * This is a portable baseline adapter. Provider-specific adapters should use
 * their atomic increment/transaction primitives for tag invalidation.
 */
export function storageCacheAdapter(
  storage: FarmCacheStorage,
  options: StorageFarmCacheAdapterOptions = {},
): FarmCacheAdapter {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new TypeError("storageCacheAdapter expects a compatible storage client.");
  }

  const base = normalizeCacheNamespace(options.base || "farm-cache");
  const entryKey = async (key: string) => `${base}:entry:${await encodeStorageKeySegment(key)}`;
  const tagKey = async (tag: string) => `${base}:tag:${await encodeStorageKeySegment(tag)}`;

  return {
    name: "storage",
    get: async <T>(key: string) => storage.getItem<FarmCacheEntry<T>>(await entryKey(key)),
    set: async <T>(key: string, entry: FarmCacheEntry<T>) => {
      const ttlMs = getFarmCacheEntryTtlMs(entry);
      if (ttlMs === undefined) {
        await storage.setItem(await entryKey(key), entry);
      } else {
        await storage.setItem(await entryKey(key), entry, { ttl: Math.ceil(ttlMs / 1000) });
      }
    },
    delete: async (key: string) => {
      await storage.removeItem(await entryKey(key));
    },
    clear: storage.clear
      ? async () => {
          await storage.clear!(base);
        }
      : undefined,
    getTagVersions: async (tags) => {
      const versions = await Promise.all(
        tags.map(async (tag) => {
          const value = await storage.getItem<number>(await tagKey(tag));
          return [tag, normalizeAdapterVersion(value)] as const;
        }),
      );
      return Object.fromEntries(versions);
    },
    invalidateTags: async (tags) => {
      await Promise.all(
        tags.map(async (tag) => {
          const key = await tagKey(tag);
          const current = normalizeAdapterVersion(await storage.getItem<number>(key));
          await storage.setItem(key, Math.max(Date.now(), current + 1));
        }),
      );
    },
  };
}

/**
 * Longest encoded key segment written as-is. Longer keys are hashed so they stay
 * under driver limits such as 255-byte file names and 512-byte Cloudflare KV keys.
 */
const MAX_STORAGE_KEY_SEGMENT_LENGTH = 200;

/**
 * Turn a cache key or tag into one storage-safe key segment.
 *
 * unstorage drops everything after `?` and folds `/`, `\` and repeated `:` into
 * one separator, so raw keys for `/a?x=1` and `/a?x=2` (or `/a/b` and `/a:b`)
 * would share one stored value. Percent-encoding removes every one of those
 * characters, and the hashed form carries a `:` that an encoded key cannot
 * contain, so distinct keys never map to the same storage key.
 */
async function encodeStorageKeySegment(value: string): Promise<string> {
  let encoded: string | undefined;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    // Lone surrogates cannot be percent-encoded; the hash below still keeps them distinct.
  }
  if (encoded !== undefined && encoded.length <= MAX_STORAGE_KEY_SEGMENT_LENGTH) return encoded;
  // JSON.stringify escapes lone surrogates, so TextEncoder never folds two keys together.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return `sha256:${hex}`;
}

/**
 * How long a stale entry stays readable in shared storage: one more revalidate
 * window, and never less than this, so stale-while-revalidate readers and an
 * entry written already stale (an ISR page seeded from an old file) still find it.
 */
const MIN_STALE_RETENTION_MS = 60_000;

function getFarmCacheEntryExpiresAt(
  createdAt: number,
  revalidate: number | false | undefined,
  now = Date.now(),
): number | undefined {
  if (typeof revalidate !== "number") return undefined;
  const revalidateMs = revalidate * 1000;
  return Math.max(createdAt + revalidateMs, now) + Math.max(revalidateMs, MIN_STALE_RETENTION_MS);
}

/**
 * Remaining lifetime of an entry in shared storage, or undefined when it never
 * expires on its own. Always at least 1ms so an expiry is never sent as "no expiry".
 */
function getFarmCacheEntryTtlMs(
  entry: Pick<FarmCacheEntry, "expiresAt">,
  now = Date.now(),
): number | undefined {
  if (typeof entry.expiresAt !== "number" || !Number.isFinite(entry.expiresAt)) return undefined;
  return Math.max(1, Math.ceil(entry.expiresAt - now));
}

export interface GetFarmCacheEntryOptions {
  allowStale?: boolean;
  now?: number;
}

interface FarmCacheStaleEntry {
  tags: Iterable<string>;
  createdAt: number;
  createdVersion?: number;
  revalidate?: number | false;
}

export class FarmDataCache {
  private entries = new Map<string, InternalFarmCacheEntry>();
  private inflight = new Map<
    string,
    { promise: Promise<unknown>; tags: readonly string[]; startVersion: number }
  >();
  /** Local entries by tag, so tag counts and pruning never scan unrelated entries. */
  private entriesByTag = new Map<string, Set<InternalFarmCacheEntry>>();
  private invalidatedTagVersions = new Map<string, number>();
  private activeGenerations = new Set<{ tags: ReadonlySet<string>; createdVersion: number }>();
  private version = 0;
  private generation = 0;
  private adapter?: FarmCacheAdapter;
  private namespace = "farm";
  private local = true;
  private maxEntries = 1_024;
  private lease = {
    enabled: true,
    ttlMs: 10_000,
    waitTimeoutMs: 10_000,
    pollIntervalMs: 25,
  };

  constructor(config: FarmCacheUserConfig = {}) {
    this.configure(config);
  }

  configure(config: FarmCacheUserConfig = {}): void {
    this.generation++;
    this.entries.clear();
    this.entriesByTag.clear();
    this.inflight.clear();
    this.invalidatedTagVersions.clear();
    this.activeGenerations.clear();
    this.version = 0;
    this.adapter = config.adapter;
    this.namespace = normalizeCacheNamespace(config.namespace || "farm");
    this.local = !config.adapter;
    this.maxEntries = normalizePositiveInteger(config.maxEntries, 1_024, "cache.maxEntries");
    this.lease =
      config.lease === false
        ? { ...this.lease, enabled: false }
        : {
            enabled: true,
            ttlMs: normalizePositiveDuration(config.lease?.ttlMs, 10_000, "cache.lease.ttlMs"),
            waitTimeoutMs: normalizePositiveDuration(
              config.lease?.waitTimeoutMs,
              10_000,
              "cache.lease.waitTimeoutMs",
            ),
            pollIntervalMs: normalizePositiveDuration(
              config.lease?.pollIntervalMs,
              25,
              "cache.lease.pollIntervalMs",
            ),
          };
  }

  get adapterName(): string {
    return this.adapter?.name || (this.adapter ? "custom" : "memory");
  }

  get hasAdapter(): boolean {
    return this.adapter !== undefined;
  }

  get size(): number {
    return this.entries.size;
  }

  get<T>(key: string, options: GetFarmCacheEntryOptions = {}): T | undefined {
    return this.getEntry<T>(key, options)?.value;
  }

  getEntry<T = unknown>(
    key: string,
    options: GetFarmCacheEntryOptions = {},
  ): FarmCacheEntry<T> | undefined {
    const entry = this.entries.get(key) as InternalFarmCacheEntry<T> | undefined;
    if (!entry) {
      emitFarmEvent({ type: "cache.miss", key });
      return undefined;
    }

    const stale = this.isStale(entry, options.now);
    if (stale) {
      emitFarmEvent({
        type: "cache.stale",
        key,
        tags: Array.from(entry.tags),
        revalidate: entry.revalidate,
      });
    }

    if (!options.allowStale && stale) {
      emitFarmEvent({ type: "cache.miss", key, reason: "stale" });
      return undefined;
    }

    this.touchEntry(key, entry);

    emitFarmEvent({
      type: "cache.hit",
      key,
      tags: Array.from(entry.tags),
      revalidate: entry.revalidate,
      stale,
    });

    return this.toPublicEntry(entry);
  }

  async getEntryAsync<T = unknown>(
    key: string,
    options: GetFarmCacheEntryOptions = {},
  ): Promise<FarmCacheEntry<T> | undefined> {
    if (this.local) {
      const localEntry = this.getEntry<T>(key, options);
      if (localEntry) return localEntry;
    }

    if (!this.adapter) {
      return this.local ? undefined : this.getEntry<T>(key, options);
    }

    const generation = this.generation;
    const adapter = this.adapter;
    const namespace = this.namespace;
    const entry = await adapter.get<T>(`${namespace}:entry:${key}`);
    if (generation !== this.generation) return undefined;
    if (!entry || isForeignAdapterEntry(entry, key)) {
      emitFarmEvent({ type: "cache.miss", key, ...(entry ? { reason: "key-mismatch" } : {}) });
      return undefined;
    }

    assertFarmCacheEntry(entry, key);
    if (typeof entry.expiresAt === "number" && entry.expiresAt <= (options.now ?? Date.now())) {
      // Adapters without native expiry keep expired entries until something removes them.
      emitFarmEvent({ type: "cache.miss", key, reason: "expired" });
      try {
        await adapter.delete(`${namespace}:entry:${key}`);
      } catch (error) {
        emitFarmEvent({ type: "cache.error", key, operation: "delete", error });
      }
      return undefined;
    }
    const stale = await this.isAdapterEntryStale(entry, options.now, adapter, namespace);
    if (generation !== this.generation) return undefined;
    if (stale) {
      emitFarmEvent({
        type: "cache.stale",
        key,
        tags: [...entry.tags],
        revalidate: entry.revalidate,
      });
      if (!options.allowStale) {
        emitFarmEvent({ type: "cache.miss", key, reason: "stale" });
        return undefined;
      }
    }

    emitFarmEvent({
      type: "cache.hit",
      key,
      tags: [...entry.tags],
      revalidate: entry.revalidate,
      stale,
    });

    if (this.local && !stale) {
      this.hydrateLocalEntry(entry);
    }
    return { ...entry, key };
  }

  set<T>(key: string, value: T, options: FarmCacheSetOptions = {}): FarmCacheEntry<T> {
    const revalidate = normalizeRevalidate(options.revalidate);
    const tags = new Set<string>();
    for (const tag of options.tags ?? []) {
      tags.add(normalizeCacheTag(tag));
    }
    for (const routePath of options.paths ?? []) {
      tags.add(createPathCacheTag(routePath));
    }

    const entry: InternalFarmCacheEntry<T> = {
      key,
      value,
      tags,
      tagVersions: undefined,
      createdAt: options.createdAt ?? Date.now(),
      createdVersion: ++this.version,
      revalidate,
    };

    this.storeLocalEntry(entry);
    emitFarmEvent({
      type: "cache.set",
      key,
      tags: Array.from(tags),
      revalidate: entry.revalidate,
    });
    return this.toPublicEntry(entry);
  }

  async setAsync<T>(
    key: string,
    value: T,
    options: FarmCacheSetOptions = {},
    tagVersions?: Readonly<Record<string, number>>,
  ): Promise<FarmCacheEntry<T>> {
    return this.writeAsync(key, value, options, tagVersions);
  }

  private async writeAsync<T>(
    key: string,
    value: T,
    options: FarmCacheSetOptions,
    tagVersions?: Readonly<Record<string, number>>,
    createdVersion?: number,
  ): Promise<FarmCacheEntry<T>> {
    const revalidate = normalizeRevalidate(options.revalidate);
    const tags = normalizeCacheOptionsTags(options);
    const capturedVersions =
      tagVersions ?? (await this.getAdapterTagVersions(Array.from(tags.values())));
    const createdAt = options.createdAt ?? Date.now();
    const expiresAt = getFarmCacheEntryExpiresAt(createdAt, revalidate);
    const entry: FarmCacheEntry<T> = {
      key,
      value,
      tags: Array.from(tags),
      tagVersions: capturedVersions,
      createdAt,
      createdVersion: createdVersion ?? ++this.version,
      revalidate,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };

    if (this.local) {
      this.hydrateLocalEntry(entry);
    }
    if (this.adapter) {
      await this.adapter.set(this.createAdapterKey(key), entry);
    }

    emitFarmEvent({
      type: "cache.set",
      key,
      tags: [...entry.tags],
      revalidate: entry.revalidate,
    });
    return entry;
  }

  delete(key: string): boolean {
    const deleted = this.deleteLocalEntry(key);
    emitFarmEvent({ type: "cache.delete", key, deleted });
    return deleted;
  }

  async deleteAsync(key: string): Promise<boolean> {
    const deleted = this.deleteLocalEntry(key);
    if (this.adapter) {
      await this.adapter.delete(this.createAdapterKey(key));
    }
    emitFarmEvent({ type: "cache.delete", key, deleted: this.adapter ? true : deleted });
    return this.adapter ? true : deleted;
  }

  clear(): void {
    const count = this.entries.size;
    this.generation++;
    this.entries.clear();
    this.entriesByTag.clear();
    this.inflight.clear();
    this.invalidatedTagVersions.clear();
    this.activeGenerations.clear();
    this.version = 0;
    emitFarmEvent({ type: "cache.clear", count });
  }

  async clearAsync(): Promise<void> {
    this.clear();
    await this.adapter?.clear?.();
  }

  isStale(entry: FarmCacheStaleEntry, now = Date.now()): boolean {
    if (
      typeof entry.revalidate === "number" &&
      entry.revalidate >= 0 &&
      now - entry.createdAt >= entry.revalidate * 1000
    ) {
      return true;
    }

    for (const tag of entry.tags) {
      const invalidatedVersion = this.invalidatedTagVersions.get(normalizeCacheTag(tag));
      if (
        typeof invalidatedVersion === "number" &&
        typeof entry.createdVersion === "number" &&
        invalidatedVersion > entry.createdVersion
      ) {
        return true;
      }
    }

    return false;
  }

  async isStaleAsync(entry: FarmCacheEntry, now = Date.now()): Promise<boolean> {
    if (this.adapter) {
      return this.isAdapterEntryStale(entry, now);
    }
    return this.isStale(entry, now);
  }

  revalidateTag(
    tag: string,
    options: { source?: "revalidateTag" | "updateTag"; profile?: RevalidateTagProfile } = {},
  ): number {
    const normalized = normalizeCacheTag(tag);
    const count = this.invalidateTag(normalized);
    emitFarmEvent(
      options.source === "updateTag"
        ? { type: "cache.updateTag", tag: normalized, count }
        : { type: "cache.revalidateTag", tag: normalized, profile: options.profile, count },
    );
    return count;
  }

  async revalidateTagAsync(
    tag: string,
    options: { source?: "revalidateTag" | "updateTag"; profile?: RevalidateTagProfile } = {},
  ): Promise<number> {
    const normalized = normalizeCacheTag(tag);
    const count = this.invalidateTag(normalized);
    await this.adapter?.invalidateTags?.([this.createAdapterTag(normalized)]);
    emitFarmEvent(
      options.source === "updateTag"
        ? { type: "cache.updateTag", tag: normalized, count }
        : { type: "cache.revalidateTag", tag: normalized, profile: options.profile, count },
    );
    return count;
  }

  revalidatePath(routePath: string): number {
    const normalizedPath = normalizeRevalidatePath(routePath);
    const pathTag = createPathCacheTag(normalizedPath);
    const pprCount = this.countEntriesForTags([pathTag, "ppr"]);
    const count = this.invalidateTag(pathTag);
    emitFarmEvent({ type: "cache.revalidatePath", path: normalizedPath, count });

    if (pprCount > 0) {
      emitFarmEvent({
        type: "ppr.shell.invalidated",
        route: normalizedPath,
        reason: "revalidatePath",
        count: pprCount,
      });
    }

    return count;
  }

  async revalidatePathAsync(routePath: string): Promise<number> {
    const normalizedPath = normalizeRevalidatePath(routePath);
    const pathTag = createPathCacheTag(normalizedPath);
    const pprCount = this.countEntriesForTags([pathTag, "ppr"]);
    const count = this.invalidateTag(pathTag);
    await this.adapter?.invalidateTags?.([this.createAdapterTag(pathTag)]);
    emitFarmEvent({ type: "cache.revalidatePath", path: normalizedPath, count });

    if (pprCount > 0) {
      emitFarmEvent({
        type: "ppr.shell.invalidated",
        route: normalizedPath,
        reason: "revalidatePath",
        count: pprCount,
      });
    }

    return count;
  }

  async getOrSet<T>(
    key: string,
    producer: () => Promise<T> | T,
    options: FarmCacheOptions = {},
  ): Promise<T> {
    normalizeRevalidate(options.revalidate);
    const cached = await this.getEntryAsync<T>(key);
    if (cached) {
      return cached.value;
    }

    const inflight = this.inflight.get(key);
    if (inflight && !this.wasInvalidatedSince(inflight.tags, inflight.startVersion)) {
      emitFarmEvent({ type: "cache.dedupe", key });
      return inflight.promise as Promise<T>;
    }

    const tags = Array.from(normalizeCacheOptionsTags(options));
    const generation = this.generation;
    const startVersion = this.version;
    const promise = this.fillCacheEntry(key, producer, options, tags, generation)
      .catch((error) => {
        emitFarmEvent({ type: "cache.error", key, operation: "set", error });
        throw error;
      })
      .finally(() => {
        if (this.inflight.get(key)?.promise === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, { promise, tags, startVersion });
    return promise;
  }

  /** A fill that started before one of its tags was invalidated cannot satisfy later readers. */
  private wasInvalidatedSince(tags: readonly string[], version: number): boolean {
    for (const tag of tags) {
      const invalidatedVersion = this.invalidatedTagVersions.get(tag);
      if (invalidatedVersion !== undefined && invalidatedVersion > version) return true;
    }
    return false;
  }

  private async fillCacheEntry<T>(
    key: string,
    producer: () => Promise<T> | T,
    options: FarmCacheOptions,
    tags: readonly string[],
    generation: number,
  ): Promise<T> {
    const adapter = this.adapter;
    const namespace = this.namespace;
    const lease = { ...this.lease };
    const leaseKey = `${namespace}:lease:${key}`;
    let leaseToken: string | null | undefined;

    if (adapter?.acquireLease && adapter.releaseLease && lease.enabled) {
      leaseToken = await adapter.acquireLease(leaseKey, lease.ttlMs);
      if (!leaseToken) {
        const shared = await this.waitForAdapterEntry<T>(
          key,
          adapter,
          namespace,
          lease,
          generation,
        );
        if (shared) {
          emitFarmEvent({ type: "cache.dedupe", key });
          return shared.value;
        }
        if (generation === this.generation) {
          leaseToken = await adapter.acquireLease(leaseKey, lease.ttlMs);
        }
      }
    }

    const initialCreatedVersion = this.version;
    const activeGeneration = {
      tags: new Set(tags),
      createdVersion: initialCreatedVersion,
    };
    this.activeGenerations.add(activeGeneration);

    try {
      const initialTagVersions = await this.getAdapterTagVersions(tags, adapter, namespace);
      const value = await producer();
      if (generation === this.generation) {
        await this.writeAsync(key, value, options, initialTagVersions, initialCreatedVersion);
      }
      return value;
    } finally {
      this.activeGenerations.delete(activeGeneration);
      this.pruneInvalidatedTagVersions(activeGeneration.tags);
      if (leaseToken && adapter?.releaseLease) {
        try {
          await adapter.releaseLease(leaseKey, leaseToken);
        } catch (error) {
          emitFarmEvent({ type: "cache.error", key, operation: "set", error });
        }
      }
    }
  }

  private async waitForAdapterEntry<T>(
    key: string,
    adapter: FarmCacheAdapter,
    namespace: string,
    lease: typeof this.lease,
    generation: number,
  ): Promise<FarmCacheEntry<T> | undefined> {
    const deadline = Date.now() + lease.waitTimeoutMs;
    while (Date.now() < deadline) {
      await delay(lease.pollIntervalMs);
      if (generation !== this.generation) return undefined;
      const entry = await adapter.get<T>(`${namespace}:entry:${key}`);
      if (generation !== this.generation) return undefined;
      if (!entry || isForeignAdapterEntry(entry, key)) {
        emitFarmEvent({ type: "cache.miss", key, ...(entry ? { reason: "key-mismatch" } : {}) });
        continue;
      }
      assertFarmCacheEntry(entry, key);
      const stale = await this.isAdapterEntryStale(entry, Date.now(), adapter, namespace);
      if (generation !== this.generation) return undefined;
      if (stale) {
        emitFarmEvent({
          type: "cache.stale",
          key,
          tags: [...entry.tags],
          revalidate: entry.revalidate,
        });
        emitFarmEvent({ type: "cache.miss", key, reason: "stale" });
      } else {
        emitFarmEvent({
          type: "cache.hit",
          key,
          tags: [...entry.tags],
          revalidate: entry.revalidate,
          stale: false,
        });
        return { ...entry, key };
      }
    }
    return undefined;
  }

  private countEntriesForTags(tags: readonly [string, ...string[]]): number {
    let count = 0;
    for (const entry of this.entriesByTag.get(tags[0]) ?? []) {
      if (tags.every((tag) => entry.tags.has(tag))) {
        count++;
      }
    }
    return count;
  }

  private invalidateTag(normalizedTag: string): number {
    const count = this.entriesByTag.get(normalizedTag)?.size ?? 0;
    this.invalidatedTagVersions.delete(normalizedTag);
    this.invalidatedTagVersions.set(normalizedTag, ++this.version);
    this.pruneInvalidatedTagVersions([normalizedTag]);
    return count;
  }

  private toPublicEntry<T>(entry: InternalFarmCacheEntry<T>): FarmCacheEntry<T> {
    return {
      key: entry.key,
      value: entry.value,
      tags: Array.from(entry.tags),
      tagVersions: entry.tagVersions,
      createdAt: entry.createdAt,
      createdVersion: entry.createdVersion,
      revalidate: entry.revalidate,
    };
  }

  private hydrateLocalEntry<T>(entry: FarmCacheEntry<T>): void {
    this.storeLocalEntry({
      key: entry.key,
      value: entry.value,
      tags: new Set(entry.tags.map(normalizeCacheTag)),
      tagVersions: entry.tagVersions,
      createdAt: entry.createdAt,
      createdVersion: entry.createdVersion ?? ++this.version,
      revalidate: normalizeRevalidate(entry.revalidate),
    });
  }

  private touchEntry(key: string, entry: InternalFarmCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private storeLocalEntry(entry: InternalFarmCacheEntry): void {
    const removed: InternalFarmCacheEntry[] = [];
    const replaced = this.detachLocalEntry(entry.key);
    if (replaced) removed.push(replaced);
    this.entries.set(entry.key, entry);
    for (const tag of entry.tags) {
      let tagged = this.entriesByTag.get(tag);
      if (!tagged) this.entriesByTag.set(tag, (tagged = new Set()));
      tagged.add(entry);
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      removed.push(this.detachLocalEntry(oldestKey)!);
    }
    // Only tags of entries that left the cache can lose their last stale dependent.
    for (const removedEntry of removed) this.pruneInvalidatedTagVersions(removedEntry.tags);
  }

  private deleteLocalEntry(key: string): boolean {
    const entry = this.detachLocalEntry(key);
    if (!entry) return false;
    this.pruneInvalidatedTagVersions(entry.tags);
    return true;
  }

  private detachLocalEntry(key: string): InternalFarmCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    for (const tag of entry.tags) {
      const tagged = this.entriesByTag.get(tag);
      if (!tagged) continue;
      tagged.delete(entry);
      if (tagged.size === 0) this.entriesByTag.delete(tag);
    }
    return entry;
  }

  /**
   * Drop invalidation versions that no local entry or active fill can be stale against.
   * Callers pass only the tags whose dependents just changed, so the cost is bounded by
   * the entries sharing those tags rather than by the whole cache.
   */
  private pruneInvalidatedTagVersions(tags: Iterable<string>): void {
    tags: for (const tag of tags) {
      const invalidatedVersion = this.invalidatedTagVersions.get(tag);
      if (invalidatedVersion === undefined) continue;
      for (const entry of this.entriesByTag.get(tag) ?? []) {
        if (entry.createdVersion < invalidatedVersion) continue tags;
      }
      for (const generation of this.activeGenerations) {
        if (generation.tags.has(tag) && generation.createdVersion < invalidatedVersion)
          continue tags;
      }
      this.invalidatedTagVersions.delete(tag);
    }
  }

  private createAdapterKey(key: string): string {
    return `${this.namespace}:entry:${key}`;
  }

  private createAdapterTag(tag: string): string {
    return `${this.namespace}:tag:${tag}`;
  }

  private async getAdapterTagVersions(
    tags: readonly string[],
    adapter = this.adapter,
    namespace = this.namespace,
  ): Promise<Readonly<Record<string, number>>> {
    if (!adapter?.getTagVersions || tags.length === 0) return {};

    const normalized = tags.map(normalizeCacheTag);
    const physicalTags = normalized.map((tag) => `${namespace}:tag:${tag}`);
    const versions = await adapter.getTagVersions(physicalTags);
    return Object.fromEntries(
      normalized.map((tag, index) => [
        tag,
        normalizeAdapterVersion(versions[physicalTags[index]!]),
      ]),
    );
  }

  private async isAdapterEntryStale(
    entry: FarmCacheEntry,
    now = Date.now(),
    adapter = this.adapter,
    namespace = this.namespace,
  ): Promise<boolean> {
    if (
      typeof entry.revalidate === "number" &&
      entry.revalidate >= 0 &&
      now - entry.createdAt >= entry.revalidate * 1000
    ) {
      return true;
    }

    const currentVersions = await this.getAdapterTagVersions(entry.tags, adapter, namespace);
    for (const tag of entry.tags) {
      if (
        normalizeAdapterVersion(currentVersions[tag]) >
        normalizeAdapterVersion(entry.tagVersions?.[tag])
      ) {
        return true;
      }
    }
    return false;
  }
}

const FARM_DATA_CACHE_SYMBOL = Symbol.for("farm.dataCache");
const farmDataCacheGlobal = globalThis as typeof globalThis & {
  [FARM_DATA_CACHE_SYMBOL]?: FarmDataCache;
};
const sharedFarmDataCache = (farmDataCacheGlobal[FARM_DATA_CACHE_SYMBOL] ??= new FarmDataCache());

export function getFarmDataCache(): FarmDataCache {
  return sharedFarmDataCache;
}

export function configureFarmCache(config: FarmCacheUserConfig | undefined): void {
  sharedFarmDataCache.configure(config);
}

/**
 * Wrap an async function so its results are cached and shared across requests,
 * processes, and restarts.
 *
 * The cache key is built from the wrapped function's identity (its name and a
 * hash of its source), the active locale, `keyParts`, and the call arguments.
 * Deriving identity from the source — rather than the closure instance — is
 * deliberate: it keeps the key stable across processes and restarts so a
 * distributed cache adapter can share entries between server instances.
 *
 * The consequence is that two closures with **identical source text but
 * different captured variables** produce the same identity. Pass those captured
 * values in `keyParts` so they take part in the key; otherwise the closures
 * share a cache entry and return each other's data:
 *
 * ```ts
 * // Collides: both closures have identical source, and `table` is captured,
 * // not an argument, so it never reaches the key.
 * const makeLoader = (table: string) =>
 *   unstable_cache(async (id: number) => db.get(table, id));
 *
 * // Correct: the captured value disambiguates the two closures.
 * const makeLoader = (table: string) =>
 *   unstable_cache(async (id: number) => db.get(table, id), [table]);
 * ```
 *
 * Values passed as call arguments already participate in the key and do not
 * need to be repeated in `keyParts`.
 *
 * @param fn The async function to memoize.
 * @param keyParts Extra values that identify this call site. Include every
 *   variable the function closes over that is not one of its arguments.
 * @param options Tags, paths, and revalidation settings for the cached entry.
 */
export function unstable_cache<Args extends unknown[], Result>(
  fn: (...args: Args) => Result | Promise<Result>,
  keyParts: readonly unknown[] = [],
  options: FarmCacheOptions = {},
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    const locale = getActiveFarmI18nSnapshot()?.locale;
    const key = createFarmCacheKey([
      "unstable_cache",
      getFunctionCacheIdentity(fn),
      locale ? ["locale", locale] : null,
      keyParts,
      args,
    ]);
    return getFarmDataCache().getOrSet<Result>(key, () => fn(...args), options);
  };
}

/**
 * Invalidate every cache entry carrying `tag`.
 *
 * Observability note: the `count` on the emitted `cache.revalidateTag` event is
 * derived from Farm's process-local entry tracking. With a shared `cache.adapter`
 * configured, entries live in the adapter rather than in local memory, so the
 * count can read as `0` even though the invalidation is still propagated to the
 * adapter and applied. Treat it as a best-effort signal, not a distributed count.
 */
export function revalidateTag(_tag: string, _profile?: RevalidateTagProfile): void | Promise<void> {
  const cache = getFarmDataCache();
  if (cache.hasAdapter) {
    const task = cache
      .revalidateTagAsync(_tag, {
        source: "revalidateTag",
        profile: _profile,
      })
      .then(() => undefined);
    notifyFarmCacheTask(task);
    return task;
  }
  cache.revalidateTag(_tag, {
    source: "revalidateTag",
    profile: _profile,
  });
}

export function updateTag(tag: string): void | Promise<void> {
  const cache = getFarmDataCache();
  if (cache.hasAdapter) {
    const task = cache.revalidateTagAsync(tag, { source: "updateTag" }).then(() => undefined);
    notifyFarmCacheTask(task);
    return task;
  }
  cache.revalidateTag(tag, { source: "updateTag" });
}

/**
 * Invalidate cached data for a route path (and its PPR shell, if any).
 *
 * Observability note: the `count` on the emitted `cache.revalidatePath` event and
 * the `ppr.shell.invalidated` event are derived from process-local entry tracking.
 * With a shared `cache.adapter`, PPR shells live in the adapter rather than in
 * local memory, so the count can read as `0` and `ppr.shell.invalidated` may not
 * be emitted even though the invalidation is still propagated to the adapter and
 * applied.
 */
export function revalidatePath(routePath: string): void | Promise<void> {
  const cache = getFarmDataCache();
  if (cache.hasAdapter) {
    const task = cache.revalidatePathAsync(routePath).then(() => undefined);
    notifyFarmCacheTask(task);
    return task;
  }
  cache.revalidatePath(routePath);
}

export function invalidate(key: RouteDataCacheKey): void | Promise<void> {
  const clientKey = createRouteDataCacheKey(key);
  const task = updateTag(createRouteDataCacheTag(key));
  notifyFarmCacheInvalidation(clientKey);
  return task;
}

export function invalidateRouteData(key: RouteDataCacheKey): void | Promise<void> {
  return invalidate(key);
}

/**
 * Apply a normalized set of invalidation targets and return browser cache keys
 * that should be carried with an action/endpoint response.
 */
export async function applyFarmCacheInvalidationTargets(
  targets: readonly FarmCacheInvalidationTarget[],
): Promise<readonly string[]> {
  if (!Array.isArray(targets)) {
    throw new TypeError("Cache invalidations must resolve to an array of targets.");
  }

  const clientKeys: string[] = [];
  for (const target of targets) {
    assertFarmCacheInvalidationTarget(target);
    if ("key" in target) {
      await invalidate(target.key);
      clientKeys.push(createRouteDataCacheKey(target.key));
    } else if ("path" in target) {
      await revalidatePath(target.path);
    } else {
      await updateTag(target.tag);
    }
  }
  return Array.from(new Set(clientKeys));
}

export function createPathCacheTag(routePath: string): string {
  return `path:${normalizeRevalidatePath(routePath)}`;
}

export function createRouteDataCacheTag(key: RouteDataCacheKey): string {
  return `route-data:${createRouteDataCacheKey(key)}`;
}

export function normalizeRevalidatePath(routePath: string): string {
  if (typeof routePath !== "string") {
    throw new TypeError("revalidatePath expects a path string.");
  }

  let normalized = routePath.trim();
  if (!normalized) {
    throw new Error("revalidatePath expects a non-empty path.");
  }

  try {
    if (/^https?:\/\//i.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    // Keep the original path if URL parsing fails.
  }

  normalized = normalized.split(/[?#]/, 1)[0] ?? normalized;
  normalized = normalized.startsWith("/") ? normalized : `/${normalized}`;
  normalized = normalized.replace(/\/{2,}/g, "/");
  normalized = new URL(normalized, "http://farm.invalid").pathname;
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized || "/";
}

function normalizeRevalidate(revalidate: number | false | undefined): number | false | undefined {
  if (revalidate === false || revalidate === undefined) {
    return revalidate;
  }
  if (!Number.isFinite(revalidate) || revalidate < 0) {
    throw new TypeError("Cache revalidate must be false or a finite, non-negative number.");
  }
  // 0 is meaningful: the entry is stale immediately, i.e. always re-produced.
  return revalidate;
}

function normalizeCacheTag(tag: string): string {
  if (typeof tag !== "string") {
    throw new TypeError("Cache tags must be strings.");
  }
  const normalized = tag.trim();
  if (!normalized) {
    throw new Error("Cache tags cannot be empty.");
  }
  return normalized;
}

function normalizeCacheNamespace(namespace: string): string {
  if (typeof namespace !== "string") {
    throw new TypeError("Cache namespace must be a string.");
  }
  const normalized = namespace.trim().replace(/:+$/g, "");
  if (!normalized) {
    throw new Error("Cache namespace cannot be empty.");
  }
  return normalized;
}

function normalizeAdapterVersion(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizePositiveDuration(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number of milliseconds.`);
  }
  return Math.floor(value);
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCacheOptionsTags(options: FarmCacheOptions): Set<string> {
  const tags = new Set<string>();
  for (const tag of options.tags ?? []) {
    tags.add(normalizeCacheTag(tag));
  }
  for (const routePath of options.paths ?? []) {
    tags.add(createPathCacheTag(routePath));
  }
  return tags;
}

/**
 * A well-formed entry stored under another logical key, for example one written
 * through a storage client that folded two keys together. It answers a
 * different request, so the read is a miss rather than an error that would
 * fail every request mapping to that storage key until the entry is replaced.
 */
function isForeignAdapterEntry(entry: FarmCacheEntry, expectedKey: string): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.key === "string" &&
    entry.key !== expectedKey
  );
}

function assertFarmCacheEntry(
  entry: FarmCacheEntry,
  expectedKey: string,
): asserts entry is FarmCacheEntry {
  if (
    !entry ||
    typeof entry !== "object" ||
    entry.key !== expectedKey ||
    !Array.isArray(entry.tags) ||
    typeof entry.createdAt !== "number"
  ) {
    throw new TypeError(
      `Cache adapter returned an invalid entry for ${JSON.stringify(expectedKey)}.`,
    );
  }
}

function assertFarmCacheInvalidationTarget(
  target: unknown,
): asserts target is FarmCacheInvalidationTarget {
  if (!target || typeof target !== "object") {
    throw new TypeError("Cache invalidation targets must be { key }, { path }, or { tag }.");
  }

  if ("key" in target) {
    const key = (target as { key?: unknown }).key;
    if (typeof key === "string" || Array.isArray(key)) return;
  } else if ("path" in target && typeof (target as { path?: unknown }).path === "string") {
    return;
  } else if ("tag" in target && typeof (target as { tag?: unknown }).tag === "string") {
    return;
  }

  throw new TypeError("Cache invalidation targets must contain a string/array key, path, or tag.");
}
