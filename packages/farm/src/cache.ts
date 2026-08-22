import { emitFarmEvent } from "./observability";
import { notifyFarmCacheInvalidation, notifyFarmCacheTask } from "./cache-invalidation";
import { getActiveFarmI18nSnapshot } from "./i18n/bridge";

export { applyFarmCacheInvalidations } from "./cache-invalidation";

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

export type RouteDataCacheKey = string | readonly unknown[];

export type FarmCacheInvalidationTarget =
  | { key: RouteDataCacheKey }
  | { path: string }
  | { tag: string };

declare const FARM_DEFINED_CACHE_KEY_DATA: unique symbol;

/**
 * A regular Farm cache key carrying the data shape stored under that key.
 *
 * The brand exists only in TypeScript. At runtime the value remains the
 * original string or structured array, so all existing cache APIs continue to
 * accept untyped keys.
 */
export type DefinedCacheKey<TData, TKey extends RouteDataCacheKey = RouteDataCacheKey> = TKey & {
  readonly [FARM_DEFINED_CACHE_KEY_DATA]: TData;
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

export interface FarmCacheUserConfig {
  /** Shared cache implementation, for example a Redis-backed adapter. */
  adapter?: FarmCacheAdapter;
  /** Prefix isolating applications and deployments sharing one adapter. */
  namespace?: string;
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
  setItem<T = unknown>(key: string, value: T): Promise<unknown>;
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
  const entryKey = (key: string) => `${base}:entry:${key}`;
  const tagKey = (tag: string) => `${base}:tag:${tag}`;

  return {
    name: "storage",
    get: <T>(key: string) => storage.getItem<FarmCacheEntry<T>>(entryKey(key)),
    set: async <T>(key: string, entry: FarmCacheEntry<T>) => {
      await storage.setItem(entryKey(key), entry);
    },
    delete: async (key: string) => {
      await storage.removeItem(entryKey(key));
    },
    clear: storage.clear
      ? async () => {
          await storage.clear!(base);
        }
      : undefined,
    getTagVersions: async (tags) => {
      const versions = await Promise.all(
        tags.map(async (tag) => {
          const value = await storage.getItem<number>(tagKey(tag));
          return [tag, normalizeAdapterVersion(value)] as const;
        }),
      );
      return Object.fromEntries(versions);
    },
    invalidateTags: async (tags) => {
      await Promise.all(
        tags.map(async (tag) => {
          const key = tagKey(tag);
          const current = normalizeAdapterVersion(await storage.getItem<number>(key));
          await storage.setItem(key, Math.max(Date.now(), current + 1));
        }),
      );
    },
  };
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
  private inflight = new Map<string, Promise<unknown>>();
  private invalidatedTagVersions = new Map<string, number>();
  private version = 0;
  private adapter?: FarmCacheAdapter;
  private namespace = "farm";
  private local = true;
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
    this.adapter = config.adapter;
    this.namespace = normalizeCacheNamespace(config.namespace || "farm");
    this.local = !config.adapter;
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
    if (!this.local) {
      this.entries.clear();
      this.inflight.clear();
      this.invalidatedTagVersions.clear();
      this.version = 0;
    }
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

    const entry = await this.adapter.get<T>(this.createAdapterKey(key));
    if (!entry) {
      emitFarmEvent({ type: "cache.miss", key });
      return undefined;
    }

    assertFarmCacheEntry(entry, key);
    const stale = await this.isAdapterEntryStale(entry, options.now);
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
      revalidate: normalizeRevalidate(options.revalidate),
    };

    this.entries.set(key, entry);
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
    const tags = normalizeCacheOptionsTags(options);
    const capturedVersions =
      tagVersions ?? (await this.getAdapterTagVersions(Array.from(tags.values())));
    const entry: FarmCacheEntry<T> = {
      key,
      value,
      tags: Array.from(tags),
      tagVersions: capturedVersions,
      createdAt: options.createdAt ?? Date.now(),
      createdVersion: ++this.version,
      revalidate: normalizeRevalidate(options.revalidate),
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
    const deleted = this.entries.delete(key);
    emitFarmEvent({ type: "cache.delete", key, deleted });
    return deleted;
  }

  async deleteAsync(key: string): Promise<boolean> {
    const deleted = this.entries.delete(key);
    if (this.adapter) {
      await this.adapter.delete(this.createAdapterKey(key));
    }
    emitFarmEvent({ type: "cache.delete", key, deleted: this.adapter ? true : deleted });
    return this.adapter ? true : deleted;
  }

  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.inflight.clear();
    this.invalidatedTagVersions.clear();
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
    const cached = await this.getEntryAsync<T>(key);
    if (cached) {
      return cached.value;
    }

    const inflight = this.inflight.get(key) as Promise<T> | undefined;
    if (inflight) {
      emitFarmEvent({ type: "cache.dedupe", key });
      return inflight;
    }

    const tags = Array.from(normalizeCacheOptionsTags(options));
    const promise = this.fillCacheEntry(key, producer, options, tags)
      .catch((error) => {
        emitFarmEvent({ type: "cache.error", key, operation: "set", error });
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private async fillCacheEntry<T>(
    key: string,
    producer: () => Promise<T> | T,
    options: FarmCacheOptions,
    tags: readonly string[],
  ): Promise<T> {
    const leaseKey = `${this.namespace}:lease:${key}`;
    let leaseToken: string | null | undefined;

    if (this.adapter?.acquireLease && this.adapter.releaseLease && this.lease.enabled) {
      leaseToken = await this.adapter.acquireLease(leaseKey, this.lease.ttlMs);
      if (!leaseToken) {
        const shared = await this.waitForAdapterEntry<T>(key);
        if (shared) {
          emitFarmEvent({ type: "cache.dedupe", key });
          return shared.value;
        }
        leaseToken = await this.adapter.acquireLease(leaseKey, this.lease.ttlMs);
      }
    }

    try {
      const initialTagVersions = await this.getAdapterTagVersions(tags);
      const value = await producer();
      await this.setAsync(key, value, options, initialTagVersions);
      return value;
    } finally {
      if (leaseToken && this.adapter?.releaseLease) {
        await this.adapter.releaseLease(leaseKey, leaseToken);
      }
    }
  }

  private async waitForAdapterEntry<T>(key: string): Promise<FarmCacheEntry<T> | undefined> {
    const deadline = Date.now() + this.lease.waitTimeoutMs;
    while (Date.now() < deadline) {
      await delay(this.lease.pollIntervalMs);
      const entry = await this.getEntryAsync<T>(key);
      if (entry) return entry;
    }
    return undefined;
  }

  private countEntriesForTag(tag: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.tags.has(tag)) {
        count++;
      }
    }
    return count;
  }

  private countEntriesForTags(tags: readonly string[]): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (tags.every((tag) => entry.tags.has(tag))) {
        count++;
      }
    }
    return count;
  }

  private invalidateTag(normalizedTag: string): number {
    this.invalidatedTagVersions.set(normalizedTag, ++this.version);
    return this.countEntriesForTag(normalizedTag);
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
    this.entries.set(entry.key, {
      key: entry.key,
      value: entry.value,
      tags: new Set(entry.tags.map(normalizeCacheTag)),
      tagVersions: entry.tagVersions,
      createdAt: entry.createdAt,
      createdVersion: entry.createdVersion ?? ++this.version,
      revalidate: normalizeRevalidate(entry.revalidate),
    });
  }

  private createAdapterKey(key: string): string {
    return `${this.namespace}:entry:${key}`;
  }

  private createAdapterTag(tag: string): string {
    return `${this.namespace}:tag:${tag}`;
  }

  private async getAdapterTagVersions(
    tags: readonly string[],
  ): Promise<Readonly<Record<string, number>>> {
    if (!this.adapter?.getTagVersions || tags.length === 0) return {};

    const normalized = tags.map(normalizeCacheTag);
    const physicalTags = normalized.map((tag) => this.createAdapterTag(tag));
    const versions = await this.adapter.getTagVersions(physicalTags);
    return Object.fromEntries(
      normalized.map((tag, index) => [
        tag,
        normalizeAdapterVersion(versions[physicalTags[index]!]),
      ]),
    );
  }

  private async isAdapterEntryStale(entry: FarmCacheEntry, now = Date.now()): Promise<boolean> {
    if (
      typeof entry.revalidate === "number" &&
      entry.revalidate > 0 &&
      now - entry.createdAt >= entry.revalidate * 1000
    ) {
      return true;
    }

    const currentVersions = await this.getAdapterTagVersions(entry.tags);
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

export function createRouteDataCacheKey(key: RouteDataCacheKey): string {
  return createFarmCacheKey(Array.isArray(key) ? key : [key]);
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
    if (/^https?:\/\//.test(normalized)) {
      normalized = new URL(normalized).pathname;
    }
  } catch {
    // Keep the original path if URL parsing fails.
  }

  normalized = normalized.split("?")[0] ?? normalized;
  normalized = normalized.startsWith("/") ? normalized : `/${normalized}`;
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized || "/";
}

export function createFarmCacheKey(parts: readonly unknown[]): string {
  return stableSerialize(parts);
}

function normalizeRevalidate(revalidate: number | false | undefined): number | false | undefined {
  if (revalidate === false || revalidate === undefined) {
    return revalidate;
  }
  if (!Number.isFinite(revalidate) || revalidate < 0) {
    return undefined;
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

function getFunctionCacheIdentity(fn: Function): string {
  // The name alone collides across modules — two different functions both
  // named getUser would share cache entries. Include a hash of the source so
  // only genuinely identical functions share, and the identity stays stable
  // across processes and restarts.
  const name = fn.name || "anonymous";
  return `${name}:${hashFunctionSource(String(fn))}`;
}

function hashFunctionSource(source: string): string {
  // FNV-1a, 32-bit.
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const valueType = typeof value;
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "number" || valueType === "boolean" || valueType === "bigint") {
    return `${valueType}:${String(value)}`;
  }
  if (valueType === "symbol") {
    return `symbol:${String(value)}`;
  }
  if (valueType === "function") {
    return `function:${getFunctionCacheIdentity(value as Function)}`;
  }

  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }
  if (value instanceof URL) {
    return `url:${value.toString()}`;
  }
  if (value instanceof RegExp) {
    return `regexp:${value.toString()}`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    // Codepoint comparison, not localeCompare: the host locale must not
    // change how a "stable" key serializes, or invalidations computed on one
    // server can miss entries written by another.
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const serialized = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item, seen)}`)
      .join(",");

    seen.delete(value);
    return `{${serialized}}`;
  }

  return String(value);
}
