import {
  getFarmClientDataCache,
  type FarmClientCacheEntry,
  type FarmClientCachePersistenceSink,
  type FarmClientDataCache,
} from "./client-cache";

/**
 * Protocol version stamped into every persisted entry. Bump when the
 * persisted shape changes; mismatched entries are dropped on load.
 */
export const FARM_CLIENT_CACHE_PERSIST_VERSION = "1";

/** Snapshot of a confirmed cache entry as stored by an adapter. */
export type PersistedEntry = {
  data: unknown;
  updatedAt: number;
  staleAt: number;
  gcAt?: number;
  version: string;
};

/**
 * Storage contract for client cache persistence. Implement these callbacks
 * over any storage: IndexedDB, localStorage, OPFS, a native bridge. Farm owns
 * every policy decision (what, when, and whether to persist); the adapter is
 * plain keyed storage. `set` is an upsert.
 */
export type FarmClientCacheAdapter = {
  keys(): Promise<string[]>;
  get(key: string): Promise<PersistedEntry | null>;
  set(key: string, entry: PersistedEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Optional batch fast paths; the engine prefers them when present. */
  getMany?(keys: string[]): Promise<Array<PersistedEntry | null>>;
  setMany?(entries: Array<[string, PersistedEntry]>): Promise<void>;
};

/** Key-value client shape accepted by {@link storageClientCacheAdapter}. */
export type FarmClientCacheStorage = {
  getItem<T = unknown>(key: string): Promise<T | null>;
  setItem<T = unknown>(key: string, value: T): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
  getKeys?(base?: string): Promise<string[]>;
  keys?(base?: string): Promise<string[]>;
  clear?(base?: string): Promise<unknown>;
};

export type ClientCachePersistenceOptions = {
  /**
   * Extra version salt, typically an app build or deploy id. Entries written
   * under a different value are dropped on load.
   */
  version?: string;
  /** Coarse additional filter on top of per-declaration `persist: true`. */
  persistKey?: (key: string) => boolean;
  /** Debounce for write-behind flushes. */
  flushDelayMs?: number;
};

/**
 * Validate and type an adapter definition. Identity at runtime beyond shape
 * checking, mirroring `defineConfig`-style helpers.
 */
export function defineClientCacheAdapter(adapter: FarmClientCacheAdapter): FarmClientCacheAdapter {
  for (const method of ["keys", "get", "set", "delete", "clear"] as const) {
    if (typeof adapter?.[method] !== "function") {
      throw new TypeError(
        `defineClientCacheAdapter expects a "${method}" method. ` +
          "Implement keys/get/set/delete/clear over your storage.",
      );
    }
  }
  return adapter;
}

/**
 * Adapt any Farm/unstorage-compatible key-value client to the client cache
 * adapter contract, mirroring the server's `storageCacheAdapter`. Without a
 * key enumeration method the adapter still persists but cannot warm-start.
 */
export function storageClientCacheAdapter(
  storage: FarmClientCacheStorage,
  options: { base?: string } = {},
): FarmClientCacheAdapter {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function" ||
    typeof storage.removeItem !== "function"
  ) {
    throw new TypeError("storageClientCacheAdapter expects a compatible key-value client.");
  }

  const base = options.base ?? "farm-client-cache";
  const entryKey = (key: string) => `${base}:${key}`;
  const enumerate = storage.getKeys?.bind(storage) ?? storage.keys?.bind(storage);

  return {
    async keys() {
      if (!enumerate) return [];
      const keys = await enumerate(base);
      const prefix = `${base}:`;
      return keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    },
    async get(key) {
      return (await storage.getItem<PersistedEntry>(entryKey(key))) ?? null;
    },
    async set(key, entry) {
      await storage.setItem(entryKey(key), entry);
    },
    async delete(key) {
      await storage.removeItem(entryKey(key));
    },
    async clear() {
      if (storage.clear) {
        await storage.clear(base);
        return;
      }
      if (!enumerate) return;
      const prefix = `${base}:`;
      for (const key of await enumerate(base)) {
        if (key.startsWith(prefix)) await storage.removeItem(key);
      }
    },
  };
}

type PersistenceEngine = {
  adapter: FarmClientCacheAdapter;
  cache: FarmClientDataCache;
  version: string;
  persistKey?: (key: string) => boolean;
  flushDelayMs: number;
  pendingSets: Map<string, PersistedEntry>;
  pendingDeletes: Set<string>;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  hydrating: boolean;
  disabled: boolean;
  clearing: boolean;
};

let activeEngine: PersistenceEngine | undefined;

function reportPersistenceFailure(error: unknown): void {
  const report =
    typeof reportError === "function" ? reportError : (console.error as (value: unknown) => void);
  if (error instanceof Error) {
    report(error);
    return;
  }
  const normalized = new Error("Client cache persistence failed");
  (normalized as Error & { cause?: unknown }).cause = error;
  report(normalized);
}

function disableEngine(engine: PersistenceEngine, error: unknown): void {
  if (engine.disabled) return;
  // The cache is disposable: on any adapter failure fall back to memory-only
  // for the rest of the session instead of failing reads or writes.
  engine.disabled = true;
  engine.pendingSets.clear();
  engine.pendingDeletes.clear();
  if (engine.flushTimer !== undefined) {
    clearTimeout(engine.flushTimer);
    engine.flushTimer = undefined;
  }
  reportPersistenceFailure(error);
}

function scheduleFlush(engine: PersistenceEngine): void {
  if (engine.disabled || engine.flushTimer !== undefined) return;
  const timer = setTimeout(() => {
    engine.flushTimer = undefined;
    void flushEngine(engine);
  }, engine.flushDelayMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  engine.flushTimer = timer;
}

async function flushEngine(engine: PersistenceEngine): Promise<void> {
  if (engine.disabled) return;
  const sets = Array.from(engine.pendingSets.entries());
  const deletes = Array.from(engine.pendingDeletes);
  engine.pendingSets.clear();
  engine.pendingDeletes.clear();

  try {
    if (sets.length > 0) {
      if (engine.adapter.setMany) await engine.adapter.setMany(sets);
      else for (const [key, entry] of sets) await engine.adapter.set(key, entry);
    }
    for (const key of deletes) await engine.adapter.delete(key);
  } catch (error) {
    disableEngine(engine, error);
  }
}

async function hydrateEngine(engine: PersistenceEngine): Promise<void> {
  const now = Date.now();
  const keys = await engine.adapter.keys();
  if (keys.length === 0) return;

  const persisted = engine.adapter.getMany
    ? await engine.adapter.getMany(keys)
    : await Promise.all(keys.map((key) => engine.adapter.get(key)));

  engine.hydrating = true;
  try {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const entry = persisted[index];
      if (engine.disabled) return;

      if (
        !entry ||
        entry.version !== engine.version ||
        (entry.gcAt !== undefined && now >= entry.gcAt)
      ) {
        engine.pendingDeletes.add(key);
        continue;
      }

      // A live entry came from this session's server work and always wins.
      if (engine.cache.get(key, now)) continue;

      // Stale-but-visible: render the persisted data immediately and let the
      // normal SWR path revalidate it on first read.
      engine.cache.set(key, {
        data: entry.data,
        updatedAt: entry.updatedAt,
        staleAt: 0,
        gcAt: entry.gcAt,
        status: "success",
        error: null,
        persist: true,
      });
    }
  } finally {
    engine.hydrating = false;
  }
  if (engine.pendingDeletes.size > 0) scheduleFlush(engine);
}

function createSink(engine: PersistenceEngine): FarmClientCachePersistenceSink {
  return {
    onSet(key, entry: FarmClientCacheEntry) {
      if (engine.disabled || engine.hydrating) return;
      if (!entry.persist || entry.fetching || entry.error || entry.status === "pending") return;
      if (engine.persistKey && !engine.persistKey(key)) return;
      engine.pendingDeletes.delete(key);
      engine.pendingSets.set(key, {
        data: entry.data,
        updatedAt: entry.updatedAt,
        staleAt: entry.staleAt,
        gcAt: entry.gcAt,
        version: engine.version,
      });
      scheduleFlush(engine);
    },
    onDelete(key) {
      if (engine.disabled) return;
      engine.pendingSets.delete(key);
      engine.pendingDeletes.add(key);
      scheduleFlush(engine);
    },
    onClear() {
      // clearPersistedCache awaits the adapter itself; skip the fire-and-forget
      // clear so one logout does not race two clears (and two error reports).
      if (engine.disabled || engine.clearing) return;
      engine.pendingSets.clear();
      engine.pendingDeletes.clear();
      void engine.adapter.clear().catch((error) => disableEngine(engine, error));
    },
  };
}

/**
 * @internal Wire an adapter to the shared client cache. Called by the
 * generated client entry from the `cache.client.adapter` configuration; not
 * part of the public API. Returns a disposer.
 */
export function initPersistedClientCache(
  adapter: FarmClientCacheAdapter,
  options: ClientCachePersistenceOptions = {},
): () => void {
  defineClientCacheAdapter(adapter);
  disposePersistedClientCache();

  const engine: PersistenceEngine = {
    adapter,
    cache: getFarmClientDataCache(),
    version: options.version
      ? `${FARM_CLIENT_CACHE_PERSIST_VERSION}:${options.version}`
      : FARM_CLIENT_CACHE_PERSIST_VERSION,
    persistKey: options.persistKey,
    flushDelayMs: options.flushDelayMs ?? 300,
    pendingSets: new Map(),
    pendingDeletes: new Set(),
    flushTimer: undefined,
    hydrating: false,
    disabled: false,
    clearing: false,
  };

  activeEngine = engine;
  engine.cache.attachPersistence(createSink(engine));
  void hydrateEngine(engine).catch((error) => disableEngine(engine, error));

  return () => {
    if (activeEngine !== engine) return;
    disposePersistedClientCache();
  };
}

/**
 * @internal Entry point used by the generated client entries for the
 * `cache.client.adapter` configuration. Accepts the imported module namespace
 * and reports a misconfigured adapter without breaking application startup:
 * persistence is optional capability and must never block hydration.
 */
export function initConfiguredClientCachePersistence(
  adapterModule: unknown,
  options: ClientCachePersistenceOptions = {},
): void {
  try {
    const adapter = (adapterModule as { default?: unknown } | null | undefined)?.default;
    if (!adapter) {
      throw new Error(
        "cache.client.adapter must default-export an adapter. " +
          "Export defineClientCacheAdapter({ keys, get, set, delete, clear }) as the module default.",
      );
    }
    initPersistedClientCache(adapter as FarmClientCacheAdapter, options);
  } catch (error) {
    reportPersistenceFailure(error);
  }
}

/** @internal Detach the active engine, flushing nothing further. */
export function disposePersistedClientCache(): void {
  const engine = activeEngine;
  if (!engine) return;
  activeEngine = undefined;
  // Hydration is asynchronous and may already be parked on an adapter read.
  // Marking the engine disabled makes that in-flight pass stop before it writes,
  // so a disposed engine cannot repopulate the shared cache after logout — or
  // push the previous user's entries into whichever adapter is attached next.
  engine.disabled = true;
  engine.cache.attachPersistence(undefined);
  if (engine.flushTimer !== undefined) {
    clearTimeout(engine.flushTimer);
    engine.flushTimer = undefined;
  }
  engine.pendingSets.clear();
  engine.pendingDeletes.clear();
}

/**
 * Remove every persisted cache entry. Call on logout or any session change so
 * the next visitor on this device cannot warm-start into another user's data.
 * Safe to call when persistence is not configured.
 */
export async function clearPersistedCache(): Promise<void> {
  const engine = activeEngine;
  if (!engine) {
    // Persistence is optional, but logout must mean the same thing with or
    // without an adapter: the previous session's data stops being readable.
    getFarmClientDataCache().clear();
    return;
  }
  engine.pendingSets.clear();
  engine.pendingDeletes.clear();
  // Clearing the persisted copy alone leaves the in-memory cache holding the
  // signed-out user's data, which a single-page app keeps serving to whoever
  // uses the tab next. Drop both.
  engine.clearing = true;
  try {
    engine.cache.clear();
  } finally {
    engine.clearing = false;
  }
  engine.pendingSets.clear();
  engine.pendingDeletes.clear();
  try {
    await engine.adapter.clear();
  } catch (error) {
    disableEngine(engine, error);
  }
}

/** @internal Test hook: flush pending writes immediately. */
export async function flushPersistedClientCache(): Promise<void> {
  const engine = activeEngine;
  if (!engine) return;
  if (engine.flushTimer !== undefined) {
    clearTimeout(engine.flushTimer);
    engine.flushTimer = undefined;
  }
  await flushEngine(engine);
}
