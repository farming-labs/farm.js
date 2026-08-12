"use client";

import { createFarmCacheKey } from "./cache";
import { getFarmClientDataCache } from "./client-cache";
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

export function createServerQueryCallKey<TInput, TData>(
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
  if (!options.force && entry && !stale && entry.status !== "error") return entry.data;

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
