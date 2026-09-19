import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFarmClientDataCache } from "../client-cache";
import {
  clearPersistedCache,
  defineClientCacheAdapter,
  disposePersistedClientCache,
  flushPersistedClientCache,
  initPersistedClientCache,
  storageClientCacheAdapter,
  type FarmClientCacheAdapter,
  type PersistedEntry,
  FARM_CLIENT_CACHE_PERSIST_VERSION,
} from "../client-cache-persistence";

function memoryAdapter(seed: Record<string, PersistedEntry> = {}) {
  const store = new Map<string, PersistedEntry>(Object.entries(seed));
  const adapter: FarmClientCacheAdapter = {
    keys: async () => Array.from(store.keys()),
    get: async (key) => store.get(key) ?? null,
    set: async (key, entry) => {
      store.set(key, entry);
    },
    delete: async (key) => {
      store.delete(key);
    },
    clear: async () => {
      store.clear();
    },
  };
  return { adapter, store };
}

function persisted(data: unknown, overrides: Partial<PersistedEntry> = {}): PersistedEntry {
  return {
    data,
    updatedAt: Date.now() - 1_000,
    staleAt: Date.now() + 60_000,
    version: FARM_CLIENT_CACHE_PERSIST_VERSION,
    ...overrides,
  };
}

async function microtasks() {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

describe("client cache persistence engine", () => {
  beforeEach(() => {
    getFarmClientDataCache().clear();
    disposePersistedClientCache();
  });
  afterEach(() => {
    disposePersistedClientCache();
    getFarmClientDataCache().clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("clears in-memory entries on logout, not just the persisted copy", async () => {
    const { adapter, store } = memoryAdapter();
    initPersistedClientCache(adapter, { flushDelayMs: 0 });
    await microtasks();

    const cache = getFarmClientDataCache();
    cache.set("user:profile", {
      data: { email: "alice@example.com" },
      updatedAt: Date.now(),
      staleAt: Date.now() + 60_000,
      status: "success",
      error: null,
      persist: true,
    });
    await flushPersistedClientCache();
    expect(cache.get("user:profile")).toBeTruthy();

    await clearPersistedCache();

    // The persisted copy is gone...
    expect(store.size).toBe(0);
    // ...and so is the in-memory copy, so the next user of this tab cannot read
    // the signed-out user's data.
    expect(cache.get("user:profile")).toBeUndefined();
  });

  it("does not resurrect an in-flight write after the cache is cleared on logout", async () => {
    const store = new Map<string, PersistedEntry>();
    let releaseSet!: () => void;
    const setGate = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    let setStarted!: () => void;
    const setInFlight = new Promise<void>((resolve) => {
      setStarted = resolve;
    });
    const adapter: FarmClientCacheAdapter = {
      keys: async () => Array.from(store.keys()),
      get: async (key) => store.get(key) ?? null,
      set: async (key, entry) => {
        setStarted();
        await setGate;
        store.set(key, entry);
      },
      delete: async (key) => {
        store.delete(key);
      },
      clear: async () => {
        store.clear();
      },
    };
    initPersistedClientCache(adapter, { flushDelayMs: 0 });
    await microtasks();

    getFarmClientDataCache().set("user:secret", {
      data: { token: "abc" },
      updatedAt: Date.now(),
      staleAt: Date.now() + 60_000,
      status: "success",
      error: null,
      persist: true,
    });

    // Start a flush and let it park inside adapter.set (write in flight).
    const flush = flushPersistedClientCache();
    await setInFlight;

    // Log out while that write is still parked, then let the write resolve.
    const clear = clearPersistedCache();
    releaseSet();
    await Promise.all([flush, clear]);

    // The in-flight write must not survive the clear.
    expect(store.size).toBe(0);
    expect(store.has("user:secret")).toBe(false);
  });

  it("clears in-memory entries on logout when no adapter is configured", async () => {
    disposePersistedClientCache();
    const cache = getFarmClientDataCache();
    cache.set("user:profile", {
      data: { email: "alice@example.com" },
      updatedAt: Date.now(),
      staleAt: Date.now() + 60_000,
      status: "success",
      error: null,
      persist: true,
    });

    await clearPersistedCache();

    expect(cache.get("user:profile")).toBeUndefined();
  });

  it("clears the adapter exactly once per logout", async () => {
    const { adapter } = memoryAdapter();
    const clear = vi.fn(adapter.clear);
    initPersistedClientCache({ ...adapter, clear }, { flushDelayMs: 0 });
    await microtasks();

    await clearPersistedCache();
    await microtasks();

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate into the cache after disposal", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = persisted({ email: "alice@example.com" });
    const adapter: FarmClientCacheAdapter = {
      keys: async () => {
        await gate;
        return ["user:profile"];
      },
      get: async () => entry,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
    };

    initPersistedClientCache(adapter, { flushDelayMs: 0 });
    // Hydration is parked on the adapter read; dispose before it resumes.
    disposePersistedClientCache();
    release();
    await microtasks();

    expect(getFarmClientDataCache().get("user:profile")).toBeUndefined();
  });

  it("does not let a disposed engine's hydration reach the next adapter", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = persisted({ email: "alice@example.com" });
    const first: FarmClientCacheAdapter = {
      keys: async () => {
        await gate;
        return ["user:profile"];
      },
      get: async () => stale,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
    };

    initPersistedClientCache(first, { flushDelayMs: 0 });
    // Reconfiguring disposes the first engine while its hydration is parked.
    const { adapter: second, store } = memoryAdapter();
    initPersistedClientCache(second, { flushDelayMs: 0 });
    release();
    await microtasks();
    await flushPersistedClientCache();

    expect(getFarmClientDataCache().get("user:profile")).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("hydrates persisted entries stale-but-visible", async () => {
    const { adapter } = memoryAdapter({
      catalog: persisted({ items: ["a"] }),
    });
    initPersistedClientCache(adapter);
    await microtasks();

    const cache = getFarmClientDataCache();
    const entry = cache.get<{ items: string[] }>("catalog");
    expect(entry?.data.items).toEqual(["a"]);
    expect(entry?.status).toBe("success");
    // Stale on arrival: SWR revalidates through the normal path on first read.
    expect(cache.isStale("catalog")).toBe(true);
  });

  it("drops version-mismatched and expired entries on load", async () => {
    const now = Date.now();
    const { adapter, store } = memoryAdapter({
      stale: persisted({ ok: true }, { version: "0:old" }),
      expired: persisted({ ok: true }, { gcAt: now - 1 }),
      good: persisted({ ok: true }),
    });
    initPersistedClientCache(adapter);
    await microtasks();
    await flushPersistedClientCache();

    const cache = getFarmClientDataCache();
    expect(cache.get("stale")).toBeUndefined();
    expect(cache.get("expired")).toBeUndefined();
    expect(cache.get("good")).toBeDefined();
    expect(store.has("stale")).toBe(false);
    expect(store.has("expired")).toBe(false);
    expect(store.has("good")).toBe(true);
  });

  it("never overwrites a live in-memory entry during hydration", async () => {
    const cache = getFarmClientDataCache();
    cache.set("catalog", {
      data: { items: ["live"] },
      updatedAt: Date.now(),
      staleAt: Number.POSITIVE_INFINITY,
    });

    const { adapter } = memoryAdapter({ catalog: persisted({ items: ["disk"] }) });
    initPersistedClientCache(adapter);
    await microtasks();

    expect(cache.get<{ items: string[] }>("catalog")?.data.items).toEqual(["live"]);
  });

  it("writes only persist-flagged successful entries, debounced", async () => {
    const { adapter, store } = memoryAdapter();
    initPersistedClientCache(adapter);
    await microtasks();

    const cache = getFarmClientDataCache();
    const now = Date.now();
    cache.set("flagged", {
      data: { ok: true },
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
      persist: true,
    });
    cache.set("unflagged", {
      data: { ok: true },
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
    });
    cache.set("pending", {
      data: undefined,
      updatedAt: 0,
      staleAt: 0,
      status: "pending",
      fetching: true,
      persist: true,
    });

    expect(store.size).toBe(0); // nothing before the debounce flush
    await flushPersistedClientCache();

    expect(Array.from(store.keys())).toEqual(["flagged"]);
    expect(store.get("flagged")?.version).toBe(FARM_CLIENT_CACHE_PERSIST_VERSION);
  });

  it("prefers setMany for a flush and honors the persistKey filter", async () => {
    const { adapter, store } = memoryAdapter();
    const setMany = vi.fn(async (entries: Array<[string, PersistedEntry]>) => {
      for (const [key, entry] of entries) store.set(key, entry);
    });
    initPersistedClientCache(
      { ...adapter, setMany },
      { persistKey: (key) => key.startsWith("allowed") },
    );
    await microtasks();

    const cache = getFarmClientDataCache();
    const now = Date.now();
    const base = { updatedAt: now, staleAt: now + 30_000, status: "success" as const };
    cache.set("allowed:a", { data: 1, ...base, persist: true });
    cache.set("allowed:b", { data: 2, ...base, persist: true });
    cache.set("blocked:c", { data: 3, ...base, persist: true });
    await flushPersistedClientCache();

    expect(setMany).toHaveBeenCalledTimes(1);
    expect(Array.from(store.keys()).sort()).toEqual(["allowed:a", "allowed:b"]);
  });

  it("mirrors deletes and clear to the adapter", async () => {
    const { adapter, store } = memoryAdapter({ old: persisted({ ok: true }) });
    initPersistedClientCache(adapter);
    await microtasks();

    const cache = getFarmClientDataCache();
    cache.delete("old");
    await flushPersistedClientCache();
    expect(store.has("old")).toBe(false);

    const now = Date.now();
    cache.set("gone", {
      data: 1,
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
      persist: true,
    });
    await flushPersistedClientCache();
    expect(store.has("gone")).toBe(true);

    cache.clear();
    await microtasks();
    expect(store.size).toBe(0);
  });

  it("disables persistence for the session when the adapter fails", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const { adapter, store } = memoryAdapter();
    initPersistedClientCache({
      ...adapter,
      set: async () => {
        throw new Error("quota exceeded");
      },
    });
    await microtasks();

    const cache = getFarmClientDataCache();
    const now = Date.now();
    cache.set("a", {
      data: 1,
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
      persist: true,
    });
    await flushPersistedClientCache();

    expect(report).toHaveBeenCalledTimes(1);
    // The app keeps running memory-only; later writes are not queued.
    cache.set("b", {
      data: 2,
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
      persist: true,
    });
    await flushPersistedClientCache();
    expect(store.size).toBe(0);
    expect(cache.get("b")).toBeDefined();
  });

  it("clearPersistedCache empties the adapter and is safe without an engine", async () => {
    await expect(clearPersistedCache()).resolves.toBeUndefined();

    const { adapter, store } = memoryAdapter({ session: persisted({ user: "a" }) });
    initPersistedClientCache(adapter);
    await microtasks();

    await clearPersistedCache();
    expect(store.size).toBe(0);
  });

  it("stamps the version salt and drops entries written under another salt", async () => {
    const { adapter, store } = memoryAdapter();
    initPersistedClientCache(adapter, { version: "build-1" });
    await microtasks();

    const cache = getFarmClientDataCache();
    const now = Date.now();
    cache.set("k", {
      data: 1,
      updatedAt: now,
      staleAt: now + 30_000,
      status: "success",
      persist: true,
    });
    await flushPersistedClientCache();
    expect(store.get("k")?.version).toBe(`${FARM_CLIENT_CACHE_PERSIST_VERSION}:build-1`);

    disposePersistedClientCache();
    getFarmClientDataCache().clear();
    initPersistedClientCache(adapter, { version: "build-2" });
    await microtasks();
    await flushPersistedClientCache();

    expect(getFarmClientDataCache().get("k")).toBeUndefined();
    expect(store.has("k")).toBe(false);
  });
});

describe("persist flag plumbing", () => {
  beforeEach(() => {
    getFarmClientDataCache().clear();
    disposePersistedClientCache();
  });
  afterEach(() => {
    disposePersistedClientCache();
    getFarmClientDataCache().clear();
  });

  it("carries a query-declared persist flag from the envelope into the cache entry", async () => {
    const [
      { createServerQuery },
      { runWithServerActionRequest },
      { completeFarmServerQueryAction },
    ] = await Promise.all([
      import("../server-query"),
      import("../server-action-security"),
      import("../server-query-runtime"),
    ]);

    const query = createServerQuery({
      key: () => ["persisted-product", "1"],
      staleTime: "30s",
      persist: true,
      async handler() {
        return { id: "1" };
      },
    });

    const request = new Request("https://farm.test/persist", { method: "POST" });
    const transported = await runWithServerActionRequest(request, () => query());
    expect(transported).toMatchObject({ __farmServerQuery: { persist: true } });

    const data = completeFarmServerQueryAction(
      { actionId: "persisted", args: [] },
      transported as never,
    );
    expect(data).toEqual({ id: "1" });

    const entry = getFarmClientDataCache().get(
      (transported as { __farmServerQuery: { key: string } }).__farmServerQuery.key,
    );
    expect(entry?.persist).toBe(true);
  });

  it("omits the flag entirely for undeclared queries", async () => {
    const [{ createServerQuery }, { runWithServerActionRequest }] = await Promise.all([
      import("../server-query"),
      import("../server-action-security"),
    ]);

    const query = createServerQuery({
      key: () => ["unpersisted-product", "1"],
      async handler() {
        return { id: "1" };
      },
    });

    const request = new Request("https://farm.test/no-persist", { method: "POST" });
    const transported = (await runWithServerActionRequest(request, () => query())) as {
      __farmServerQuery: Record<string, unknown>;
    };
    expect("persist" in transported.__farmServerQuery).toBe(false);
  });
});

describe("defineClientCacheAdapter", () => {
  it("rejects adapters missing required methods", () => {
    expect(() => defineClientCacheAdapter({} as never)).toThrow(/keys/);
  });
});

describe("storageClientCacheAdapter", () => {
  function kv() {
    const store = new Map<string, unknown>();
    return {
      store,
      client: {
        getItem: async <T>(key: string) => (store.get(key) as T) ?? null,
        setItem: async (key: string, value: unknown) => {
          store.set(key, value);
        },
        removeItem: async (key: string) => {
          store.delete(key);
        },
        getKeys: async () => Array.from(store.keys()),
      },
    };
  }

  it("prefixes keys and round-trips entries", async () => {
    const { store, client } = kv();
    const adapter = storageClientCacheAdapter(client, { base: "app" });

    await adapter.set("catalog", persisted({ ok: true }));
    expect(Array.from(store.keys())).toEqual(["app:catalog"]);
    expect(await adapter.keys()).toEqual(["catalog"]);
    expect((await adapter.get("catalog"))?.data).toEqual({ ok: true });

    await adapter.delete("catalog");
    expect(await adapter.get("catalog")).toBeNull();

    await adapter.set("a", persisted(1));
    await adapter.set("b", persisted(2));
    await adapter.clear();
    expect(store.size).toBe(0);
  });

  it("rejects incompatible clients and works without key enumeration", async () => {
    expect(() => storageClientCacheAdapter({} as never)).toThrow(/compatible/);

    const { client } = kv();
    const { getKeys: _getKeys, ...withoutKeys } = client;
    const adapter = storageClientCacheAdapter(withoutKeys);
    await adapter.set("k", persisted(1));
    expect(await adapter.keys()).toEqual([]); // persists, cannot warm-start
  });
});
