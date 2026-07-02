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
    if (!entry) return undefined;
    if (!options.allowStale && this.isStale(entry, options.now)) {
      return undefined;
    }
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
    return this.toPublicEntry(entry);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
    this.invalidatedTagVersions.clear();
    this.version = 0;
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

  revalidateTag(tag: string): number {
    const normalized = normalizeCacheTag(tag);
    this.invalidatedTagVersions.set(normalized, ++this.version);
    return this.countEntriesForTag(normalized);
  }

  revalidatePath(routePath: string): number {
    return this.revalidateTag(createPathCacheTag(routePath));
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
      return inflight;
    }

    const promise = Promise.resolve()
      .then(producer)
      .then((value) => {
        this.set(key, value, options);
        return value;
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

const sharedFarmDataCache = new FarmDataCache();
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
    const key = createFarmCacheKey([
      "unstable_cache",
      getFunctionCacheIdentity(fn),
      keyParts,
      args,
    ]);
    return getFarmDataCache().getOrSet<Result>(key, () => fn(...args), options);
  };
}

export function revalidateTag(_tag: string, _profile?: RevalidateTagProfile): void {
  getFarmDataCache().revalidateTag(_tag);
}

export function updateTag(tag: string): void {
  getFarmDataCache().revalidateTag(tag);
}

export function revalidatePath(routePath: string): void {
  getFarmDataCache().revalidatePath(routePath);
}

export function createPathCacheTag(routePath: string): string {
  return `path:${normalizeRevalidatePath(routePath)}`;
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
