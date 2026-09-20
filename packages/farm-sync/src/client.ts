import {
  SyncModelStore,
  type SyncModelDescriptor,
  type SyncRow,
  type SyncRuntimeConfig,
} from "./store.js";

export type SyncMutationState = "pending" | "paused" | "completed" | "failed";

export type SyncMutationHandle<TRow = SyncRow> = {
  readonly key: unknown;
  readonly state: SyncMutationState;
  readonly isPersisted: Promise<TRow>;
};

export type SyncClientOptions = {
  /** Pause writes while offline and resume them on reconnect. Default true. */
  networkMode?: "always" | "online";
  /** Retry transient failures. Default 2 retries with linear backoff. */
  retry?: { count?: number; delay?: number | ((attempt: number) => number) };
};

type SyncRuntimeState = {
  config: SyncRuntimeConfig;
  stores: Map<string, SyncModelStore>;
  options: SyncClientOptions;
};

let runtime: SyncRuntimeState | undefined;

/** @internal Called by the plugin's client hook once the descriptor is available. */
export function startSyncRuntime(config: SyncRuntimeConfig, options: SyncClientOptions = {}): void {
  if (runtime) return;
  runtime = { config, stores: new Map(), options };
}

const isBrowser = () => typeof window !== "undefined";

/** Placeholder used while server rendering, before the browser runtime starts. */
const SSR_DESCRIPTOR: SyncModelDescriptor = {
  key: "id",
  access: "read",
  persist: false,
  cursor: null,
};

function requireRuntime(): SyncRuntimeState {
  if (runtime) return runtime;

  const pending = (globalThis as { __FARM_SYNC_CONFIG__?: SyncRuntimeConfig }).__FARM_SYNC_CONFIG__;
  if (pending) {
    startSyncRuntime(pending);
    return runtime!;
  }

  // Server rendering runs before the plugin's client hook, and the rows live in
  // the browser anyway. Render an empty store rather than failing the request;
  // hydration starts the real runtime and fills it in.
  if (!isBrowser()) {
    return { config: { path: "", models: {} }, stores: new Map(), options: {} };
  }

  throw new Error(
    "The sync runtime is not started. Add `sync({ ... })` to the plugins in farm.config.ts.",
  );
}

export function getSyncStore(model: string): SyncModelStore {
  const state = requireRuntime();
  let store = state.stores.get(model);
  if (store) return store;

  const descriptor = state.config.models[model];
  if (!descriptor) {
    if (!isBrowser()) return new SyncModelStore(model, SSR_DESCRIPTOR);
    throw new Error(
      `Model "${model}" is not exposed to the browser. Add it to \`models\` in sync().`,
    );
  }

  store = new SyncModelStore(model, descriptor);
  state.stores.set(model, store);
  if (isBrowser()) void loadModel(model);
  return store;
}

async function request(body: unknown): Promise<any> {
  const state = requireRuntime();
  const response = await fetch(state.config.path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload?.error?.message ?? `Sync request failed with ${response.status}`;
    const error = new Error(message) as Error & { code?: string; status?: number };
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

/** Fetch rows for a model, incrementally when the schema supports a cursor. */
export async function loadModel(model: string): Promise<void> {
  const store = getSyncStore(model);
  if (store.status === "idle") store.setStatus("loading");

  try {
    const result = await request({ model, operation: "list", since: store.cursor });
    store.applyServerRows(result.rows ?? [], {
      full: result.full !== false,
      cursor: result.cursor ?? null,
    });
  } catch (cause) {
    store.setStatus("error", cause instanceof Error ? cause : new Error(String(cause)));
  }
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || typeof navigator.onLine !== "boolean"
    ? true
    : navigator.onLine;
}

function waitForOnline(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const onOnline = () => {
      window.removeEventListener("online", onOnline);
      resolve();
    };
    window.addEventListener("online", onOnline);
  });
}

/**
 * Send a write, pausing while offline and retrying transient failures. The
 * caller has already applied an optimistic layer, so the row stays on screen
 * for the whole wait.
 */
async function dispatchWrite(
  store: SyncModelStore,
  body: unknown,
  options: SyncClientOptions,
): Promise<any> {
  const mode = options.networkMode ?? "online";
  const maxRetries = options.retry?.count ?? 2;
  let attempt = 0;

  while (true) {
    if (mode === "online" && !isOnline()) {
      store.trackPaused(1);
      try {
        await waitForOnline();
      } finally {
        store.trackPaused(-1);
      }
    }

    try {
      return await request(body);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      // A rejection the server reasoned about is final; only transport and
      // server faults are worth retrying.
      const retriable = status === 0 || status >= 500;
      if (mode === "online" && !isOnline()) continue;
      if (!retriable || attempt >= maxRetries) throw error;

      attempt += 1;
      const delay =
        typeof options.retry?.delay === "function"
          ? options.retry.delay(attempt)
          : (options.retry?.delay ?? attempt * 300);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function runMutation(
  model: string,
  operation: "insert" | "update" | "delete",
  input: SyncRow,
  optimistic: { key: unknown; row: SyncRow | null },
): SyncMutationHandle {
  const state = requireRuntime();
  const store = getSyncStore(model);
  const layer =
    optimistic.row === null
      ? ({ type: "delete", key: optimistic.key } as const)
      : ({ type: "upsert", key: optimistic.key, row: optimistic.row } as const);

  store.addLayer(layer);
  store.trackPending(1);

  let handleState: SyncMutationState = "pending";
  const isPersisted = (async () => {
    try {
      const result = await dispatchWrite(store, { model, operation, input }, state.options);
      store.commitLayer(layer, operation === "delete" ? null : (result as SyncRow));
      handleState = "completed";
      void persistModel(model);
      return result as SyncRow;
    } catch (error) {
      store.removeLayer(layer);
      handleState = "failed";
      throw error;
    } finally {
      store.trackPending(-1);
    }
  })();

  // Never surface an unhandled rejection for fire-and-forget calls.
  void isPersisted.catch(() => undefined);

  return {
    key: optimistic.key,
    get state() {
      return handleState;
    },
    isPersisted,
  };
}

export type SyncModelClient = {
  insert(input: SyncRow): SyncMutationHandle;
  update(input: SyncRow): SyncMutationHandle;
  delete(input: SyncRow): SyncMutationHandle;
  get(key: unknown): SyncRow | undefined;
  refresh(): Promise<void>;
  readonly rows: SyncRow[];
  readonly status: string;
  readonly pending: number;
  readonly paused: number;
  /** @internal */
  readonly __farmSyncModel: string;
};

const clientCache = new Map<string, SyncModelClient>();

function createModelClient(model: string): SyncModelClient {
  const client: SyncModelClient = {
    insert(input) {
      const store = getSyncStore(model);
      const key = input[store.descriptor.key] ?? generateKey();
      const row = { ...input, [store.descriptor.key]: key };
      return runMutation(model, "insert", row, { key, row });
    },
    update(input) {
      const store = getSyncStore(model);
      const key = input[store.descriptor.key];
      if (key === undefined) {
        throw new Error(`${model}.update() requires "${store.descriptor.key}" in its input.`);
      }
      return runMutation(model, "update", input, { key, row: store.mergeRow(key, input) });
    },
    delete(input) {
      const store = getSyncStore(model);
      const key = input[store.descriptor.key];
      if (key === undefined) {
        throw new Error(`${model}.delete() requires "${store.descriptor.key}" in its input.`);
      }
      return runMutation(model, "delete", { [store.descriptor.key]: key }, { key, row: null });
    },
    get(key) {
      return getSyncStore(model).get(key);
    },
    refresh() {
      return loadModel(model);
    },
    get rows() {
      return getSyncStore(model).getRows();
    },
    get status() {
      return getSyncStore(model).status;
    },
    get pending() {
      return getSyncStore(model).pending;
    },
    get paused() {
      return getSyncStore(model).paused;
    },
    __farmSyncModel: model,
  };

  // Bind so `useMutation(db.tasks.update)` keeps working when detached.
  client.insert = client.insert.bind(client);
  client.update = client.update.bind(client);
  client.delete = client.delete.bind(client);
  return client;
}

function generateKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Typed per-model client accessor, resolved lazily so imports stay cheap. */
export const db: Record<string, SyncModelClient> = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (typeof property !== "string") return undefined;
      let client = clientCache.get(property);
      if (!client) {
        client = createModelClient(property);
        clientCache.set(property, client);
      }
      return client;
    },
  },
) as Record<string, SyncModelClient>;

// ── persistence ────────────────────────────────────────────────────────────
// Rows ride the client cache adapter configured through cache.client.adapter,
// so warm starts render from disk before the first network round trip.

const PERSIST_PREFIX = "farm-sync:";

async function persistModel(model: string): Promise<void> {
  const store = runtime?.stores.get(model);
  if (!store?.descriptor.persist) return;

  const cache = await importClientCache();
  cache?.set(`${PERSIST_PREFIX}${model}`, {
    data: { rows: store.confirmedRows(), cursor: store.cursor },
    updatedAt: Date.now(),
    staleAt: 0,
    persist: true,
  });
}

export async function hydrateModel(model: string): Promise<void> {
  const store = getSyncStore(model);
  if (!store.descriptor.persist) return;

  const cache = await importClientCache();
  const entry = cache?.get(`${PERSIST_PREFIX}${model}`) as
    | { data?: { rows?: SyncRow[]; cursor?: string | null } }
    | undefined;
  if (entry?.data?.rows?.length) {
    store.hydrate(entry.data.rows, entry.data.cursor ?? null);
  }
}

type ClientCacheLike = {
  get(key: string): unknown;
  set(key: string, entry: Record<string, unknown>): unknown;
};

let cachePromise: Promise<ClientCacheLike | undefined> | undefined;
let cacheWarned = false;

function importClientCache(): Promise<ClientCacheLike | undefined> {
  cachePromise ??= import("@farm.js/core/client")
    .then((mod) => {
      const accessor = (mod as { getFarmClientDataCache?: () => ClientCacheLike })
        .getFarmClientDataCache;
      if (typeof accessor !== "function") {
        // Persistence is optional, but failing silently would look like a bug
        // in the app rather than a missing export.
        warnOnce(
          "@farm.js/core/client does not export getFarmClientDataCache; synced rows will not persist.",
        );
        return undefined;
      }
      return accessor();
    })
    .catch((error) => {
      warnOnce(`Sync persistence is unavailable: ${String(error)}`);
      return undefined;
    });
  return cachePromise;
}

function warnOnce(message: string): void {
  if (cacheWarned) return;
  cacheWarned = true;
  console.warn(`[farm:sync] ${message}`);
}

// Register for the plugin handshake: the client hook may run before or after
// this module is evaluated, so both directions are covered.
const scope = globalThis as {
  __FARM_SYNC__?: unknown;
  __FARM_SYNC_CONFIG__?: SyncRuntimeConfig;
};
scope.__FARM_SYNC__ = { start: (config: SyncRuntimeConfig) => startSyncRuntime(config) };
if (scope.__FARM_SYNC_CONFIG__) startSyncRuntime(scope.__FARM_SYNC_CONFIG__);
