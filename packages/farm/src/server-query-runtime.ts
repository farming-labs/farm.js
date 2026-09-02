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
  owner?: object;
};

type ActiveServerQueryInvocation = {
  provisionalKey: string;
  owner: object;
};

type ServerQueryClientState = {
  functionIds: WeakMap<Function, number>;
  nextFunctionId: number;
  active: ActiveServerQueryInvocation[];
  latestOwners: Map<string, object>;
};

const FARM_SERVER_QUERY_CLIENT_STATE = Symbol.for("farm.serverQueryClientState");
const serverQueryClientGlobal = globalThis as typeof globalThis & {
  [FARM_SERVER_QUERY_CLIENT_STATE]?: ServerQueryClientState;
};
const serverQueryClientState: ServerQueryClientState = (serverQueryClientGlobal[
  FARM_SERVER_QUERY_CLIENT_STATE
] ??= {
  functionIds: new WeakMap(),
  nextFunctionId: 0,
  active: [],
  latestOwners: new Map(),
});
serverQueryClientState.latestOwners ??= new Map();

// Global symbol registry key set on raw server query implementations by
// createServerQuery. Referenced via Symbol.for instead of importing
// server-query.ts, which would pull the server handler pipeline into the
// client bundle.
const RAW_SERVER_QUERY_SYMBOL = Symbol.for("farm.server-query");

/**
 * A query reaching the browser should be a transformed server reference. The
 * raw implementation carries the server query symbol; executing it here would
 * run the server handler in the browser (#408). During SSR the raw
 * implementation is expected and runs directly.
 */
function assertNotRawServerQueryInBrowser(query: unknown): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (!(query as Record<symbol, unknown> | null)?.[RAW_SERVER_QUERY_SYMBOL]) return;
  throw new Error(
    [
      "useServerQuery received a raw server query implementation in the browser.",
      "Server query handlers run only on the server. Enable the server-function transform (add @farm.js/plugin/rsc and set experimental.serverActions: true in farm.config.ts) so client imports become server references,",
      "or call the query from server code / an API route (createAPIClient) instead.",
    ].join("\n"),
  );
}

export function beginFarmServerQueryAction(
  actionId: string,
  args: readonly unknown[],
): FarmServerQueryActionInvocation {
  const active = serverQueryClientState.active.at(-1);
  return {
    actionId,
    args,
    provisionalKey: active?.provisionalKey,
    owner: active?.owner,
  };
}

export function completeFarmServerQueryAction<TData>(
  invocation: FarmServerQueryActionInvocation,
  value: TData | FarmServerQueryResult<TData>,
): TData {
  if (!isFarmServerQueryResult(value)) return value as TData;

  const cache = getFarmClientDataCache();
  const metadata = value.__farmServerQuery;
  if (
    invocation.provisionalKey &&
    invocation.owner &&
    serverQueryClientState.latestOwners.get(invocation.provisionalKey) !== invocation.owner
  ) {
    return value.data as TData;
  }
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

  if (inflight && !options.force) return inflight;
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
  assertNotRawServerQueryInBrowser(query);
  const cache = getFarmClientDataCache();
  const inflight = cache.getInflight<TData>(provisionalKey);
  if (inflight && !options.force) return inflight;

  const owner = {};
  serverQueryClientState.latestOwners.set(provisionalKey, owner);

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

  let promise!: Promise<TData>;
  promise = (async () => {
    try {
      serverQueryClientState.active.push({ provisionalKey, owner });
      let pending: Promise<TData>;
      try {
        pending = query(input);
      } finally {
        serverQueryClientState.active.pop();
      }

      const data = await pending;
      const transported = cache.get<TData>(provisionalKey);
      if (
        serverQueryClientState.latestOwners.get(provisionalKey) === owner &&
        (!transported || transported.fetching)
      ) {
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
      if (serverQueryClientState.latestOwners.get(provisionalKey) === owner) {
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
      }
      throw error;
    } finally {
      if (cache.getInflight(provisionalKey) === promise) {
        cache.deleteInflight(provisionalKey);
      }
      if (serverQueryClientState.latestOwners.get(provisionalKey) === owner) {
        serverQueryClientState.latestOwners.delete(provisionalKey);
      }
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
