"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createFarmCacheKey } from "./cache";
import {
  getFarmClientDataCache,
  type FarmClientCacheEntry,
  type FarmClientCacheStatus,
} from "./client-cache";
import type { ServerQuery } from "./server-query";
import { isFarmServerQueryResult, type FarmServerQueryResult } from "./server-query-protocol";

export type ServerQueryFetchOptions = {
  /** Used only when a non-Farm transport returns plain data. Farm transports use the declaration. */
  staleTime?: number | false;
  /** Return stale data immediately while refreshing it in the background. Default true. */
  swr?: boolean;
  /** Always wait for a new result. */
  force?: boolean;
};

export type UseServerQueryOptions = ServerQueryFetchOptions & {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
};

export type UseServerQueryResult<TData> = {
  data: TData | undefined;
  error: Error | null;
  status: FarmClientCacheStatus;
  pending: boolean;
  fetching: boolean;
  stale: boolean;
  refetch: () => Promise<TData>;
};

export type FarmServerQueryActionInvocation = {
  actionId: string;
  args: readonly unknown[];
  provisionalKey?: string;
};

type ActiveServerQueryInvocation = {
  provisionalKey: string;
};

type ServerQueryClientState = {
  functionIds: WeakMap<Function, number>;
  nextFunctionId: number;
  active: ActiveServerQueryInvocation[];
};

const FARM_SERVER_QUERY_CLIENT_STATE = Symbol.for("farm.serverQueryClientState");
const serverQueryClientGlobal = globalThis as typeof globalThis & {
  [FARM_SERVER_QUERY_CLIENT_STATE]?: ServerQueryClientState;
};
const serverQueryClientState = (serverQueryClientGlobal[FARM_SERVER_QUERY_CLIENT_STATE] ??= {
  functionIds: new WeakMap(),
  nextFunctionId: 0,
  active: [],
});

export function beginFarmServerQueryAction(
  actionId: string,
  args: readonly unknown[],
): FarmServerQueryActionInvocation {
  const active = serverQueryClientState.active.at(-1);
  return {
    actionId,
    args,
    provisionalKey: active?.provisionalKey,
  };
}

export function completeFarmServerQueryAction<TData>(
  invocation: FarmServerQueryActionInvocation,
  value: TData | FarmServerQueryResult<TData>,
): TData {
  if (!isFarmServerQueryResult(value)) return value as TData;

  const cache = getFarmClientDataCache();
  const metadata = value.__farmServerQuery;
  if (invocation.provisionalKey) {
    cache.alias(invocation.provisionalKey, metadata.key);
  }

  cache.set(metadata.key, {
    data: value.data,
    updatedAt: metadata.updatedAt,
    staleAt:
      metadata.staleTime === false
        ? Number.POSITIVE_INFINITY
        : metadata.updatedAt + metadata.staleTime,
    status: "success",
    error: null,
    fetching: false,
  });

  return value.data as TData;
}

export async function fetchServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: ServerQueryFetchOptions = {},
): Promise<TData> {
  const cache = getFarmClientDataCache();
  const provisionalKey = createServerQueryCallKey(query, input);
  const entry = cache.get<TData>(provisionalKey);
  const stale = cache.isStale(provisionalKey);
  const inflight = cache.getInflight<TData>(provisionalKey);

  if (inflight) return inflight;

  if (!options.force && entry && !stale && entry.status !== "error") {
    return entry.data;
  }

  if (
    !options.force &&
    entry &&
    stale &&
    entry.status !== "pending" &&
    entry.status !== "error" &&
    (options.swr ?? true)
  ) {
    void executeServerQuery(query, input, provisionalKey, options).catch(() => undefined);
    return entry.data;
  }

  return executeServerQuery(query, input, provisionalKey, options);
}

export function prefetchServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: Omit<ServerQueryFetchOptions, "force"> = {},
): Promise<TData> {
  return fetchServerQuery(query, input, options);
}

export function useServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: UseServerQueryOptions = {},
): UseServerQueryResult<TData> {
  const cache = getFarmClientDataCache();
  const key = createServerQueryCallKey(query, input);
  const inputRef = useRef(input);
  const optionsRef = useRef(options);
  const mountedKeyRef = useRef<string>();
  inputRef.current = input;
  optionsRef.current = options;

  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(key, listener),
    [cache, key],
  );
  const getSnapshot = useCallback(() => cache.get<TData>(key), [cache, key]);
  const entry = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

  const run = useCallback(
    (force = false) =>
      fetchServerQuery(query, inputRef.current, {
        ...optionsRef.current,
        force,
      }),
    [query],
  );

  useEffect(() => {
    if (options.enabled === false) return;

    const firstReadForKey = mountedKeyRef.current !== key;
    if (firstReadForKey) mountedKeyRef.current = key;

    if (
      (firstReadForKey && (!entry || cache.isStale(key))) ||
      (entry?.invalidatedAt !== undefined && !entry.fetching)
    ) {
      void run().catch(() => undefined);
    }
  }, [cache, entry, key, options.enabled, run]);

  useEffect(() => {
    if (options.enabled === false || typeof window === "undefined") return;

    const refreshIfStale = () => {
      if (cache.isStale(key)) void run().catch(() => undefined);
    };
    const onFocus = options.refetchOnWindowFocus === false ? undefined : refreshIfStale;
    const onOnline = options.refetchOnReconnect === false ? undefined : refreshIfStale;

    if (onFocus) window.addEventListener("focus", onFocus);
    if (onOnline) window.addEventListener("online", onOnline);
    return () => {
      if (onFocus) window.removeEventListener("focus", onFocus);
      if (onOnline) window.removeEventListener("online", onOnline);
    };
  }, [cache, key, options.enabled, options.refetchOnReconnect, options.refetchOnWindowFocus, run]);

  const status = entry?.status ?? (entry ? "success" : "idle");
  const fetching = entry?.fetching ?? false;

  return {
    data: entry?.data,
    error: entry?.error ?? null,
    status,
    pending: status === "pending" && (entry?.updatedAt ?? 0) === 0,
    fetching,
    stale: cache.isStale(key),
    refetch: () => run(true),
  };
}

function createServerQueryCallKey<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
): string {
  let id = serverQueryClientState.functionIds.get(query);
  if (!id) {
    id = ++serverQueryClientState.nextFunctionId;
    serverQueryClientState.functionIds.set(query, id);
  }
  return createFarmCacheKey(["server-query-call", id, input]);
}

async function executeServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  provisionalKey: string,
  options: ServerQueryFetchOptions,
): Promise<TData> {
  const cache = getFarmClientDataCache();
  const inflight = cache.getInflight<TData>(provisionalKey);
  if (inflight) return inflight;

  const previous = cache.get<TData>(provisionalKey);
  cache.set(provisionalKey, {
    data: previous?.data as TData,
    updatedAt: previous?.updatedAt ?? 0,
    staleAt: previous?.staleAt ?? 0,
    gcAt: previous?.gcAt,
    invalidatedAt: previous?.invalidatedAt,
    status: "pending",
    error: null,
    fetching: true,
  });

  const promise = (async () => {
    try {
      serverQueryClientState.active.push({ provisionalKey });
      let pending: Promise<TData>;
      try {
        pending = query(input);
      } finally {
        serverQueryClientState.active.pop();
      }

      const data = await pending;
      const transported = cache.get<TData>(provisionalKey);
      if (!transported || transported.fetching) {
        const updatedAt = Date.now();
        cache.set(provisionalKey, {
          data,
          updatedAt,
          staleAt:
            options.staleTime === false
              ? Number.POSITIVE_INFINITY
              : updatedAt + (options.staleTime ?? 0),
          status: "success",
          error: null,
          fetching: false,
        });
      }
      return data;
    } catch (cause) {
      const error = normalizeServerQueryError(cause);
      const current = cache.get<TData>(provisionalKey);
      cache.set(provisionalKey, {
        data: current?.data as TData,
        updatedAt: current?.updatedAt ?? 0,
        staleAt: current?.staleAt ?? 0,
        gcAt: current?.gcAt,
        invalidatedAt: current?.invalidatedAt,
        status: "error",
        error,
        fetching: false,
      });
      throw error;
    } finally {
      cache.deleteInflight(provisionalKey);
    }
  })();

  cache.setInflight(provisionalKey, promise);
  return promise;
}

function normalizeServerQueryError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  const error = new Error(typeof cause === "string" ? cause : "Server query failed");
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}
