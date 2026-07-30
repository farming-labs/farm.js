import { emitFarmEvent } from "./observability";
import { notifyFarmCacheInvalidation } from "./cache-invalidation";
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
  createdAt: number;
  createdVersion?: number;
  revalidate?: number | false;
}

interface InternalFarmCacheEntry<T = unknown> {
  key: string;
  value: T;
  tags: Set<string>;
  createdAt: number;
  createdVersion: number;
  revalidate?: number | false;
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

  delete(key: string): boolean {
    const deleted = this.entries.delete(key);
    emitFarmEvent({ type: "cache.delete", key, deleted });
    return deleted;
  }

  clear(): void {
    const count = this.entries.size;
    this.entries.clear();
    this.inflight.clear();
    this.invalidatedTagVersions.clear();
    this.version = 0;
    emitFarmEvent({ type: "cache.clear", count });
  }

  isStale(entry: FarmCacheStaleEntry, now = Date.now()): boolean {
    if (
      typeof entry.revalidate === "number" &&
      entry.revalidate > 0 &&
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

  async getOrSet<T>(
    key: string,
    producer: () => Promise<T> | T,
    options: FarmCacheOptions = {},
  ): Promise<T> {
    const cached = this.getEntry<T>(key);
    if (cached) {
      return cached.value;
    }

    const inflight = this.inflight.get(key) as Promise<T> | undefined;
    if (inflight) {
      emitFarmEvent({ type: "cache.dedupe", key });
      return inflight;
    }

    const promise = Promise.resolve()
      .then(producer)
      .then((value) => {
        this.set(key, value, options);
        return value;
      })
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
      createdAt: entry.createdAt,
      createdVersion: entry.createdVersion,
      revalidate: entry.revalidate,
    };
  }
}

const FARM_DATA_CACHE_SYMBOL = Symbol.for("farm.dataCache");
const farmDataCacheGlobal = globalThis as typeof globalThis & {
  [FARM_DATA_CACHE_SYMBOL]?: FarmDataCache;
};
const sharedFarmDataCache = (farmDataCacheGlobal[FARM_DATA_CACHE_SYMBOL] ??= new FarmDataCache());
const functionIds = new WeakMap<Function, number>();
let nextFunctionId = 0;

export function getFarmDataCache(): FarmDataCache {
  return sharedFarmDataCache;
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

export function revalidateTag(_tag: string, _profile?: RevalidateTagProfile): void {
  getFarmDataCache().revalidateTag(_tag, {
    source: "revalidateTag",
    profile: _profile,
  });
}

export function updateTag(tag: string): void {
  getFarmDataCache().revalidateTag(tag, { source: "updateTag" });
}

export function revalidatePath(routePath: string): void {
  getFarmDataCache().revalidatePath(routePath);
}

export function invalidate(key: RouteDataCacheKey): void {
  const clientKey = createRouteDataCacheKey(key);
  getFarmDataCache().revalidateTag(createRouteDataCacheTag(key), { source: "updateTag" });
  notifyFarmCacheInvalidation(clientKey);
}

export function invalidateRouteData(key: RouteDataCacheKey): void {
  invalidate(key);
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
  if (!Number.isFinite(revalidate) || revalidate <= 0) {
    return undefined;
  }
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

function getFunctionCacheIdentity(fn: Function): string {
  if (fn.name) {
    return `name:${fn.name}`;
  }

  let id = functionIds.get(fn);
  if (!id) {
    id = ++nextFunctionId;
    functionIds.set(fn, id);
  }
  return `anonymous:${id}`;
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

    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const serialized = entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item, seen)}`)
      .join(",");

    seen.delete(value);
    return `{${serialized}}`;
  }

  return String(value);
}
