/// <reference lib="es2021.weakref" />
import { createRouteDataCacheKey, type RouteDataCacheKey } from "./cache";
import { subscribeFarmCacheInvalidation } from "./cache-invalidation";

export type FarmClientCacheKey = RouteDataCacheKey;

export type FarmClientCacheStatus = "idle" | "pending" | "success" | "error";

export type FarmClientCacheEntry<TData = unknown> = {
  data: TData;
  updatedAt: number;
  staleAt: number;
  gcAt?: number;
  invalidatedAt?: number;
  status?: FarmClientCacheStatus;
  error?: Error | null;
  fetching?: boolean;
};

type FarmClientCacheListener = (event?: "invalidate") => void;

const invalidationTrackers = new WeakMap<FarmClientDataCache, Set<Set<string>>>();

/** Internal request-lifetime tracking, including keys learned only from a response. */
export function trackFarmClientCacheInvalidations(cache: FarmClientDataCache) {
  let trackers = invalidationTrackers.get(cache);
  if (!trackers) {
    trackers = new Set();
    invalidationTrackers.set(cache, trackers);
  }
  const keys = new Set<string>();
  trackers.add(keys);
  return {
    has(key: string) {
      const resolved = cache.resolveKey(key);
      for (const invalidated of keys) {
        if (cache.resolveKey(invalidated) === resolved) return true;
      }
      return false;
    },
    dispose() {
      if (!trackers.delete(keys)) return;
      keys.clear();
      if (trackers.size === 0) invalidationTrackers.delete(cache);
    },
  };
}

const cacheFinalizer =
  typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry<() => void>((unsubscribe) => unsubscribe())
    : undefined;

// This closure must only capture a weak reference, never the cache itself.
function subscribeWeakCache(reference: WeakRef<FarmClientDataCache>): () => void {
  const unsubscribe = subscribeFarmCacheInvalidation((key) => {
    const cache = reference.deref();
    if (cache) cache.invalidate(key);
    else dispose();
  });
  function dispose() {
    unsubscribe();
    cacheFinalizer?.unregister(reference);
  }
  return dispose;
}

export class FarmClientDataCache {
  private entries = new Map<string, FarmClientCacheEntry>();
  private aliases = new Map<string, string>();
  private invalidatedAt = new Map<string, number>();
  private listeners = new Map<string, Set<FarmClientCacheListener>>();
  private inflight = new Map<string, Promise<unknown>>();
  private unsubscribeInvalidation: (() => void) | undefined;

  constructor(options: { subscribeToInvalidation?: boolean } = {}) {
    if (options.subscribeToInvalidation !== false) {
      if (typeof WeakRef === "function") {
        const reference = new WeakRef(this);
        const unsubscribe = subscribeWeakCache(reference);
        cacheFinalizer?.register(this, unsubscribe, reference);
        this.unsubscribeInvalidation = unsubscribe;
      } else {
        // Keep invalidation working on older runtimes without weak references.
        this.unsubscribeInvalidation = subscribeFarmCacheInvalidation((key) =>
          this.invalidate(key),
        );
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  resolveKey(key: string): string {
    let resolved = key;
    const seen = new Set<string>();

    while (this.aliases.has(resolved) && !seen.has(resolved)) {
      seen.add(resolved);
      resolved = this.aliases.get(resolved)!;
    }

    return resolved;
  }

  get<TData = unknown>(key: string, now = Date.now()): FarmClientCacheEntry<TData> | undefined {
    const resolved = this.resolveKey(key);
    const entry = this.entries.get(resolved) as FarmClientCacheEntry<TData> | undefined;
    if (!entry) return undefined;

    if (entry.gcAt !== undefined && now >= entry.gcAt) {
      this.entries.delete(resolved);
      this.emit(resolved);
      return undefined;
    }

    return entry;
  }

  set<TData>(key: string, entry: FarmClientCacheEntry<TData>): this {
    const resolved = this.resolveKey(key);
    const invalidatedAt = this.invalidatedAt.get(resolved);
    const nextEntry =
      invalidatedAt !== undefined && invalidatedAt > entry.updatedAt
        ? { ...entry, staleAt: 0, invalidatedAt }
        : { ...entry, invalidatedAt: undefined };

    if (invalidatedAt === undefined || entry.updatedAt >= invalidatedAt) {
      this.invalidatedAt.delete(resolved);
    }

    this.entries.set(resolved, nextEntry);
    this.emit(resolved);
    return this;
  }

  delete(key: string): boolean {
    const resolved = this.resolveKey(key);
    const deleted = this.entries.delete(resolved);
    this.inflight.delete(resolved);
    this.emit(resolved);
    return deleted;
  }

  clear(): void {
    const keys = new Set([...this.entries.keys(), ...this.listeners.keys()]);
    this.entries.clear();
    this.aliases.clear();
    this.invalidatedAt.clear();
    this.inflight.clear();
    for (const key of keys) this.emit(key);
  }

  dispose(): void {
    this.unsubscribeInvalidation?.();
    this.unsubscribeInvalidation = undefined;
    this.clear();
  }

  isStale(key: string, now = Date.now()): boolean {
    const entry = this.get(key, now);
    return !entry || entry.invalidatedAt !== undefined || now >= entry.staleAt;
  }

  invalidate(key: string, now = Date.now()): void {
    const resolved = this.resolveKey(key);
    for (const keys of invalidationTrackers.get(this) ?? []) keys.add(resolved);
    this.invalidatedAt.set(resolved, now);

    const entry = this.entries.get(resolved);
    if (entry) {
      this.entries.set(resolved, {
        ...entry,
        staleAt: 0,
        invalidatedAt: now,
      });
    }

    this.emit(resolved, "invalidate");
  }

  alias(alias: string, key: string): void {
    const resolved = this.resolveKey(key);
    if (alias === resolved) return;

    const aliasEntry = this.entries.get(alias);
    const aliasInvalidatedAt = this.invalidatedAt.get(alias) ?? aliasEntry?.invalidatedAt;
    const resolvedInvalidatedAt = this.invalidatedAt.get(resolved);
    if (aliasEntry && !this.entries.has(resolved)) {
      this.entries.set(resolved, aliasEntry);
    }

    this.entries.delete(alias);
    this.invalidatedAt.delete(alias);
    const invalidatedAt = [aliasInvalidatedAt, resolvedInvalidatedAt].reduce<number | undefined>(
      (latest, value) =>
        value === undefined ? latest : latest === undefined ? value : Math.max(latest, value),
      undefined,
    );
    const resolvedEntry = this.entries.get(resolved);
    if (
      invalidatedAt !== undefined &&
      (!resolvedEntry || invalidatedAt > resolvedEntry.updatedAt)
    ) {
      this.invalidatedAt.set(resolved, invalidatedAt);
      if (resolvedEntry) {
        this.entries.set(resolved, {
          ...resolvedEntry,
          staleAt: 0,
          invalidatedAt,
        });
      }
    } else if (invalidatedAt !== undefined) {
      this.invalidatedAt.delete(resolved);
      if (resolvedEntry?.invalidatedAt !== undefined) {
        this.entries.set(resolved, { ...resolvedEntry, invalidatedAt: undefined });
      }
    }

    const aliasInflight = this.inflight.get(alias);
    if (aliasInflight && !this.inflight.has(resolved)) {
      this.inflight.set(resolved, aliasInflight);
    }
    this.inflight.delete(alias);
    this.aliases.set(alias, resolved);
    this.emit(alias);
    this.emit(resolved, this.invalidatedAt.has(resolved) ? "invalidate" : undefined);
  }

  subscribe(key: string, listener: FarmClientCacheListener): () => void {
    let listeners = this.listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }

    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      // Only drop the map entry if it still holds this exact set. A repeated or
      // stale unsubscribe (called after the key was drained and resubscribed)
      // must not evict a newer subscriber's live listener set.
      if (listeners!.size === 0 && this.listeners.get(key) === listeners) {
        this.listeners.delete(key);
      }
    };
  }

  getInflight<TData>(key: string): Promise<TData> | undefined {
    return this.inflight.get(this.resolveKey(key)) as Promise<TData> | undefined;
  }

  setInflight<TData>(key: string, promise: Promise<TData>): void {
    this.inflight.set(this.resolveKey(key), promise);
  }

  deleteInflight(key: string): void {
    this.inflight.delete(this.resolveKey(key));
  }

  private emit(key: string, event?: "invalidate"): void {
    this.notifyListeners(key, event);
    for (const [alias, target] of this.aliases) {
      if (this.resolveKey(target) === key) {
        this.notifyListeners(alias, event);
      }
    }
  }

  private notifyListeners(key: string, event?: "invalidate"): void {
    for (const listener of this.listeners.get(key) ?? []) {
      listener(event);
    }
  }
}

const FARM_CLIENT_DATA_CACHE = Symbol.for("farm.clientDataCache");
const clientCacheGlobal = globalThis as typeof globalThis & {
  [FARM_CLIENT_DATA_CACHE]?: FarmClientDataCache;
};
const sharedFarmClientDataCache = (clientCacheGlobal[FARM_CLIENT_DATA_CACHE] ??=
  new FarmClientDataCache());

export function getFarmClientDataCache(): FarmClientDataCache {
  return sharedFarmClientDataCache;
}

export function normalizeFarmClientCacheKey(key: FarmClientCacheKey): string {
  return typeof key === "string" ? key : createRouteDataCacheKey(key);
}
