"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getFarmClientDataCache, type FarmClientCacheStatus } from "./client-cache";
import type { ServerQuery } from "./server-query";
import {
  createServerQueryCallKey,
  fetchServerQuery,
  type ServerQueryFetchOptions,
} from "./server-query-runtime";

export {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  fetchServerQuery,
  prefetchServerQuery,
} from "./server-query-runtime";
export type {
  FarmServerQueryActionInvocation,
  ServerQueryFetchOptions,
} from "./server-query-runtime";

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

export function useServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: UseServerQueryOptions = {},
): UseServerQueryResult<TData> {
  const cache = getFarmClientDataCache();
  const key = createServerQueryCallKey(query, input);
  const inputRef = useRef(input);
  const optionsRef = useRef(options);
  const mountedKeyRef = useRef<string | undefined>(undefined);
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
