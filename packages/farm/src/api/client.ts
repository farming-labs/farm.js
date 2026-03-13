import type { TypedEndpoint } from "./endpoint";

export type APIClientOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
  cacheDefaults?: CacheOptions;
};

export type StatusPhase =
  | "idle"
  | "pending"
  | "success"
  | "error"
  | "revalidating"
  | "invalidated";

export type StatusEvent<TData = unknown, TError = unknown> = {
  phase: StatusPhase;
  requestId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  key: string;
  input?: unknown;
  data?: TData;
  error?: TError;
  isBackground?: boolean;
  timestamp: number;
};

export type APIResult<TData = unknown, TError = Error> = {
  data: TData | undefined;
  error: TError | null;
};

export type RequestEvent = {
  requestId: string;
  method: StatusEvent["method"];
  key: string;
  path: string;
  input?: unknown;
  attempt: number;
  timestamp: number;
};

export type ResponseEvent<TData = unknown, TError = Error> = {
  requestId: string;
  method: StatusEvent["method"];
  key: string;
  path: string;
  input?: unknown;
  attempt: number;
  timestamp: number;
  response?: Response;
  data?: TData;
  error?: TError;
  ok?: boolean;
  status?: number;
};

export type CachePolicy = "cache-first" | "network-only" | "stale-while-revalidate";

export type CacheOptions = {
  key?: string;
  policy?: CachePolicy;
  staleTime?: number;
  gcTime?: number;
  dedupeMs?: number;
};

export type RetryOptions = {
  count?: number;
  delay?: number | ((attempt: number) => number);
};

export type InvalidateTarget =
  | string
  | {
      key: string;
    }
  | {
      path: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
      input?: unknown;
    }
  | [RouteRef, unknown?];

export type InvalidateOptions =
  | InvalidateTarget[]
  | {
      targets: InvalidateTarget[];
      refetch?: boolean;
    };

export type OptimisticUpdate = [RouteRef, unknown, (prev: any) => any];

export type OptimisticOptions = {
  update: OptimisticUpdate[];
  rollbackOnError?: boolean;
};

export type ClientOptions<TData = unknown, TError = unknown> = {
  cache?: CacheOptions;
  retry?: RetryOptions;
  invalidate?: InvalidateOptions;
  optimistic?: OptimisticOptions;
  onRequest?: (event: RequestEvent) => void;
  onResponse?: (data: TData | undefined, error: TError | null, event: ResponseEvent<TData, TError>) => void;
  onSuccess?: (data: TData) => void;
  onError?: (err: TError) => void;
  onSettled?: (data?: TData, err?: TError | null) => void;
  onStatus?: (event: StatusEvent<TData, TError>) => void;
};

type RouteRef = (...args: any[]) => any;

// Type utilities to extract endpoint input/output types from TypedEndpoint
type InferEndpointInput<T> = T extends {
  __types: {
    body: infer TBody;
    query: infer TQuery;
  };
}
  ? TBody extends never
    ? TQuery extends never
      ? {}
      : { query?: TQuery }
    : TQuery extends never
      ? { body?: TBody }
      : { body?: TBody; query?: TQuery }
  : {};

type InferEndpointOutput<T> = T extends {
  __types: {
    response: infer R;
  };
}
  ? R
  : any;

// Type for a single endpoint method
type EndpointMethod<T = any> = (
  options?: InferEndpointInput<T>,
  clientOptions?: ClientOptions<InferEndpointOutput<T>, Error>,
) => Promise<APIResult<InferEndpointOutput<T>, Error>>;

// Type for converting router structure to client structure
type RouterToClient<T> = {
  [K in keyof T]: T[K] extends Record<string, TypedEndpoint<any, any, any>>
    ? {
        [M in keyof T[K]]: M extends "get" | "post" | "put" | "delete" | "patch"
          ? EndpointMethod<T[K][M]>
          : never;
      }
    : T[K] extends Record<string, any>
      ? RouterToClient<T[K]> // Recurssive handling of the multi level api routes
      : EndpointMethod<T[K]>;
};

/**
 * Create a typed RPC client for Farm.js API routes
 *
 * Returns a nested proxy that supports:
 * - api.hello.get({ query: { name: 'World' } })
 * - api['auth/login'].post({ body: { email: '...', password: '...' } })
 * - api.users.get({ query: { limit: '10' } })
 *
 * @example
 * ```typescript
 * import { createAPIClient } from 'farm/client';
 * import type { APIRouter } from '@/api';
 *
 * export const api = createAPIClient<APIRouter>();
 *
 * // Use it (nested property access)
 * const result = await api.hello.get({ query: { name: 'World' } });
 * if (result.error) console.error(result.error);
 * else console.log(result.data);
 *
 * // Or with string keys for nested paths
 * const result = await api['auth/login'].post({
 *   body: { email: 'test@example.com', password: 'pass123' }
 * });
 * ```
 */
export function createAPIClient<TRouter extends Record<string, any>>(
  options: APIClientOptions = {},
): RouterToClient<TRouter> {
  // Auto-detect baseURL
  const baseURL =
    options.baseURL ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

  const cacheState = new Map<string, CacheEntry>();
  const inflightState = new Map<string, InflightEntry>();
  const routeMeta = new WeakMap<RouteRef, RouteMeta>();
  let requestCounter = 0;

  // Create a simple fetch-based client (browser compatible)
  const fetchClient = async (path: string, requestOptions: any = {}) => {
    const url = new URL(path, baseURL);

    // Handle query parameters
    if (requestOptions.query) {
      Object.entries(requestOptions.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    // Prepare fetch options
    const fetchOptions: RequestInit = {
      method: requestOptions.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
        ...requestOptions.headers,
      },
    };

    // Handle body
    if (requestOptions.body) {
      fetchOptions.body = JSON.stringify(requestOptions.body);
    }

    const response = await fetch(url.toString(), fetchOptions);
    let data: any = undefined;
    if (response.status !== 204 && response.status !== 205) {
      data = await response.json();
    }

    return { response, data };
  };

  const request = async (
    path: string,
    method: string,
    input: any = {},
    clientOptions?: ClientOptions<any, any>,
  ): Promise<APIResult<any, Error>> => {
    const methodUpper = method.toUpperCase() as StatusEvent["method"];
    const requestId = `${Date.now()}-${++requestCounter}`;
    const cacheOptions = clientOptions?.cache
      ? {
          ...options.cacheDefaults,
          ...clientOptions.cache,
        }
      : undefined;
    const cacheKey = cacheOptions?.key || buildCacheKey(methodUpper, path, input);
    const now = Date.now();

    const emitStatus = (phase: StatusPhase, payload?: Partial<StatusEvent>) => {
      clientOptions?.onStatus?.({
        phase,
        requestId,
        method: methodUpper,
        key: cacheKey,
        input,
        timestamp: Date.now(),
        ...payload,
      });
    };

    const entry = getValidCacheEntry(cacheState, cacheKey, now);
    const policy = cacheOptions?.policy ?? (cacheOptions ? "cache-first" : "network-only");
    const staleTime = cacheOptions?.staleTime ?? 0;
    const isCacheEnabled = Boolean(cacheOptions) && methodUpper === "GET";
    const isStale = entry ? isEntryStale(entry, now) : true;

    const applyOptimisticUpdates = () => {
      if (!clientOptions?.optimistic?.update?.length) return [] as OptimisticSnapshot[];

      const snapshots: OptimisticSnapshot[] = [];
      for (const [target, targetInput, updater] of clientOptions.optimistic.update) {
        const targetKey = resolveTargetKey(routeMeta, target, targetInput);
        if (!targetKey) continue;

        const targetEntry = getValidCacheEntry(cacheState, targetKey, now);
        const previousEntry = targetEntry ? { ...targetEntry } : undefined;
        const previousData = targetEntry?.data;
        const nextData = updater(previousData);
        const nextStaleAt =
          targetEntry?.staleAt ??
          now + (cacheOptions?.staleTime ?? options.cacheDefaults?.staleTime ?? 0);
        const nextGcAt =
          targetEntry?.gcAt ?? getGcAt(now, cacheOptions?.gcTime ?? options.cacheDefaults?.gcTime);

        cacheState.set(targetKey, {
          data: nextData,
          updatedAt: now,
          staleAt: nextStaleAt,
          gcAt: nextGcAt,
          invalidatedAt: targetEntry?.invalidatedAt,
        });

        snapshots.push({ key: targetKey, entry: previousEntry });
      }

      return snapshots;
    };

    const rollbackOptimisticUpdates = (snapshots: OptimisticSnapshot[]) => {
      if (!clientOptions?.optimistic?.rollbackOnError) return;

      for (const snapshot of snapshots) {
        if (!snapshot.entry) {
          cacheState.delete(snapshot.key);
          continue;
        }

        cacheState.set(snapshot.key, { ...snapshot.entry });
      }
    };

    const executeNetwork = async (opts?: { isBackground?: boolean; callCallbacks?: boolean }) => {
      const dedupeMs = cacheOptions?.dedupeMs ?? 0;
      const inflight = inflightState.get(cacheKey);
      const allowDedupe = isCacheEnabled && dedupeMs > 0;

      if (allowDedupe && inflight && now - inflight.startedAt < dedupeMs) {
        emitStatus("pending", { isBackground: opts?.isBackground, data: entry?.data });
        const result = await inflight.promise;

        if (result.error) {
          emitStatus("error", { error: result.error, isBackground: opts?.isBackground });
          if (opts?.callCallbacks !== false) {
            clientOptions?.onError?.(result.error);
          }
        } else {
          emitStatus("success", { data: result.data, isBackground: opts?.isBackground });
          if (opts?.callCallbacks !== false) {
            clientOptions?.onSuccess?.(result.data as any);
          }
        }

        return result;
      }

      emitStatus(opts?.isBackground ? "revalidating" : "pending", {
        isBackground: opts?.isBackground,
      });

      const promise = (async () => {
        const maxRetries = Math.max(0, clientOptions?.retry?.count ?? 0);
        let attempt = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          clientOptions?.onRequest?.({
            requestId,
            method: methodUpper,
            key: cacheKey,
            path,
            input,
            attempt,
            timestamp: Date.now(),
          });

          try {
            const { response, data } = await fetchClient(path, {
              ...input,
              method: methodUpper,
            });

            const error = response.ok ? null : createResponseError(response, data);

            const responseEvent: ResponseEvent<any, Error> = {
              requestId,
              method: methodUpper,
              key: cacheKey,
              path,
              input,
              attempt,
              timestamp: Date.now(),
              response,
              data: response.ok ? data : undefined,
              error: error ?? undefined,
              ok: response.ok,
              status: response.status,
            };

            clientOptions?.onResponse?.(
              response.ok ? data : undefined,
              error,
              responseEvent,
            );

            if (!error) {
              return { data, error: null } as APIResult<any, Error>;
            }

            if (attempt >= maxRetries) {
              return { data: undefined, error } as APIResult<any, Error>;
            }
          } catch (err: any) {
            const error = normalizeError(err);
            const responseEvent: ResponseEvent<any, Error> = {
              requestId,
              method: methodUpper,
              key: cacheKey,
              path,
              input,
              attempt,
              timestamp: Date.now(),
              error,
              ok: false,
            };

            clientOptions?.onResponse?.(undefined, error, responseEvent);

            if (attempt >= maxRetries) {
              return { data: undefined, error } as APIResult<any, Error>;
            }
          }

          attempt += 1;
          const delay =
            typeof clientOptions?.retry?.delay === "function"
              ? clientOptions.retry.delay(attempt)
              : clientOptions?.retry?.delay ?? 0;

          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      })();

      inflightState.set(cacheKey, { promise, startedAt: now });

      try {
        const result = await promise;

        if (!result.error && isCacheEnabled) {
          const updatedAt = Date.now();
          cacheState.set(cacheKey, {
            data: result.data,
            updatedAt,
            staleAt: updatedAt + staleTime,
            gcAt: getGcAt(updatedAt, cacheOptions?.gcTime),
            invalidatedAt: undefined,
          });
        }

        if (result.error) {
          emitStatus("error", { error: result.error, isBackground: opts?.isBackground });
          if (opts?.callCallbacks !== false) {
            clientOptions?.onError?.(result.error);
          }
        } else {
          emitStatus("success", { data: result.data, isBackground: opts?.isBackground });
          if (opts?.callCallbacks !== false) {
            clientOptions?.onSuccess?.(result.data as any);
          }
        }

        return result;
      } finally {
        inflightState.delete(cacheKey);
      }
    };

    const invalidateTargets = async () => {
      if (!clientOptions?.invalidate) return;

      const invalidateOptions = Array.isArray(clientOptions.invalidate)
        ? { targets: clientOptions.invalidate, refetch: false }
        : {
            targets: clientOptions.invalidate.targets,
            refetch: clientOptions.invalidate.refetch ?? false,
          };

      for (const target of invalidateOptions.targets) {
        const targetKey = resolveTargetKey(routeMeta, target);
        if (!targetKey) continue;

        const existing = cacheState.get(targetKey);
        if (existing) {
          cacheState.set(targetKey, {
            ...existing,
            staleAt: 0,
            invalidatedAt: Date.now(),
          });
        }

        emitStatus("invalidated", { key: targetKey });

        if (invalidateOptions.refetch && existing && targetKey === cacheKey) {
          void executeNetwork({ isBackground: true, callCallbacks: false });
        }
      }
    };

    const optimisticSnapshots = applyOptimisticUpdates();

    if (isCacheEnabled) {
      if (entry && !isStale && policy !== "network-only") {
        emitStatus("success", { data: entry.data });
        clientOptions?.onSuccess?.(entry.data);
        clientOptions?.onSettled?.(entry.data, null);
        return { data: entry.data, error: null };
      }

      if (entry && isStale && policy === "stale-while-revalidate") {
        emitStatus("success", { data: entry.data });
        clientOptions?.onSuccess?.(entry.data);
        clientOptions?.onSettled?.(entry.data, null);

        void executeNetwork({ isBackground: true, callCallbacks: false });
        return { data: entry.data, error: null };
      }
    }

    const result = await executeNetwork();
    if (result.error) {
      rollbackOptimisticUpdates(optimisticSnapshots);
    }
    await invalidateTargets();
    clientOptions?.onSettled?.(result.data, result.error);
    return result;
  };

  // Return nested proxy (starts with empty path, user adds to it)
  return createNestedProxy([], request, routeMeta) as RouterToClient<TRouter>;
}

/**
 * Create a nested proxy that builds up the path
 *
 * Flow:
 * 1. api.hello       -> Proxy(['hello'])
 * 2. api.hello.get   -> Proxy(['hello', 'get'])
 * 3. api.hello.get({ query: {...} })
 *    -> fetch('/api/hello', { method: 'GET', ... })
 *
 * For routes with single method:
 * 1. api.hello       -> Proxy(['hello'])
 * 2. api.hello({ query: {...} })
 *    -> fetch('/api/hello', ...)
 */
function createNestedProxy(
  path: string[],
  client: any,
  routeMeta: WeakMap<RouteRef, RouteMeta>,
): any {
  const target = () => {};
  const proxy = new Proxy(target, {
    // When accessing a property (api.hello)
    get(_target, prop: string) {
      // Add prop to path and return new proxy
      return createNestedProxy([...path, prop], client, routeMeta);
    },

    // When calling as a function
    apply(_target, _thisArg, args) {
      // Check if the last part is an HTTP method
      const lastPart = path[path.length - 1];
      const httpMethods = ["get", "post", "put", "delete", "patch", "options", "head"];

      if (httpMethods.includes(lastPart)) {
        // Method is explicitly called: api.users.get() or api['auth/login'].post()
        // Remove the method from path and use it as the HTTP method
        const routePath = "/api/" + path.slice(0, -1).join("/");
        const method = lastPart.toUpperCase();

        // Extract options from arguments
        const [options, clientOptions] = args;

        // Call fetch client with explicit method
        return client(routePath, method, options, clientOptions);
      } else {
        // Direct call without method: api.hello()
        // Use the full path and let the server determine the method (usually GET)
        const routePath = "/api/" + path.join("/");

        // Extract options from arguments
        const [options, clientOptions] = args;

        // Call fetch client (default method will be GET)
        return client(routePath, options?.method || "GET", options, clientOptions);
      }
    },
  });

  routeMeta.set(proxy, { path: [...path] });
  return proxy;
}

/**
 * Server-side API client that calls endpoints directly as functions
 * No HTTP overhead, just direct function calls
 */
export function createServerAPIClient<TEndpoints extends Record<string, any>>(
  endpoints: TEndpoints,
): TEndpoints {
  return endpoints;
}

type CacheEntry = {
  data: any;
  updatedAt: number;
  staleAt: number;
  gcAt?: number;
  invalidatedAt?: number;
};

type InflightEntry = {
  promise: Promise<APIResult<any, Error>>;
  startedAt: number;
};

type RouteMeta = {
  path: string[];
};

type OptimisticSnapshot = {
  key: string;
  entry?: CacheEntry;
};

function buildCacheKey(method: string, path: string, input: any): string {
  const keyInput =
    input && typeof input === "object" ? { query: input.query, body: input.body } : input;
  return `${method}:${path}:${stableStringify(keyInput ?? {})}`;
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
}

function getGcAt(now: number, gcTime?: number): number | undefined {
  if (gcTime === undefined) return undefined;
  if (!Number.isFinite(gcTime) || gcTime <= 0) return now;
  return now + gcTime;
}

function getValidCacheEntry(
  cacheState: Map<string, CacheEntry>,
  key: string,
  now: number,
): CacheEntry | undefined {
  const entry = cacheState.get(key);
  if (!entry) return undefined;

  if (entry.gcAt !== undefined && now >= entry.gcAt) {
    cacheState.delete(key);
    return undefined;
  }

  return entry;
}

function isEntryStale(entry: CacheEntry, now: number): boolean {
  if (entry.invalidatedAt !== undefined) return true;
  return now >= entry.staleAt;
}

function resolveTargetKey(
  routeMeta: WeakMap<RouteRef, RouteMeta>,
  target: InvalidateTarget | RouteRef,
  input?: unknown,
): string | null {
  if (!target) return null;

  if (typeof target === "string") return target;

  if (typeof target === "function") {
    const meta = routeMeta.get(target);
    if (!meta) return null;

    const { method, routePath } = resolveRouteMeta(meta);
    return buildCacheKey(method, routePath, input ?? {});
  }

  if (Array.isArray(target)) {
    const [route, routeInput] = target;
    return resolveTargetKey(routeMeta, route, routeInput);
  }

  if ("key" in target) return target.key;

  if ("path" in target) {
    const method = target.method ?? "GET";
    return buildCacheKey(method, target.path, target.input ?? {});
  }

  return null;
}

function resolveRouteMeta(meta: RouteMeta): { routePath: string; method: string } {
  const httpMethods = ["get", "post", "put", "delete", "patch", "options", "head"];
  const lastPart = meta.path[meta.path.length - 1];
  if (lastPart && httpMethods.includes(lastPart)) {
    return {
      routePath: "/api/" + meta.path.slice(0, -1).join("/"),
      method: lastPart.toUpperCase(),
    };
  }

  return {
    routePath: "/api/" + meta.path.join("/"),
    method: "GET",
  };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "Unknown error");
}

function createResponseError(response: Response, data: any): Error {
  const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
  (error as any).status = response.status;
  (error as any).response = response;
  (error as any).data = data;
  return error;
}
