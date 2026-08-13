import {
  integrationsClient,
  integrationsServer,
  type IntegrationClientOptions,
  type IntegrationClientRoot,
  type IntegrationServerClientOptions,
  type IntegrationServerClientRoot,
} from "../integration-client";
import {
  getFarmClientDataCache,
  normalizeFarmClientCacheKey,
  type FarmClientCacheEntry,
  type FarmClientCacheKey,
  type FarmClientDataCache,
} from "../client-cache";
import {
  applyFarmCacheInvalidations,
  decodeFarmCacheInvalidations,
  FARM_CACHE_INVALIDATION_HEADER,
} from "../cache-invalidation";
import type { DefinedCacheKey, InferCacheKeyData, RouteDataCacheKey } from "../cache";
import { getFarmAPIBaseURL, resolveFarmAPIRequestURL } from "./config";
import {
  isFarmAPIStream,
  isJSONStreamResponse,
  readJSONStream,
  type FarmAPIStream,
} from "./transport";

export const FARM_API_ROUTE_REF_SYMBOL: unique symbol = Symbol.for("farm.api.route-ref") as any;
export const FARM_API_ROUTE_META_SYMBOL: unique symbol = Symbol.for("farm.api.route-meta") as any;

export type APIRouteRefMetadata = {
  path: string;
  method: string;
  baseURL: string;
  sameOrigin: boolean;
};

export type APIClientOptions = {
  baseURL?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  cacheDefaults?: CacheOptions;
  integrations?: IntegrationClientOptions;
};

export type APIClientWithoutIntegrationsOptions = Omit<APIClientOptions, "integrations"> & {
  integrations: false;
};

export type ServerAPIClientOptions = {
  integrations?: Omit<IntegrationServerClientOptions, "isServer">;
};

export type ServerAPIClientWithoutIntegrationsOptions = Omit<
  ServerAPIClientOptions,
  "integrations"
> & {
  integrations: false;
};

export type StatusPhase = "idle" | "pending" | "success" | "error" | "revalidating" | "invalidated";

export type StatusEvent<TData = unknown, TError = unknown> = {
  phase: StatusPhase;
  requestId: string;
  method: "GET" | "HEAD" | "QUERY" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  key: string;
  input?: unknown;
  data?: TData;
  error?: TError;
  isBackground?: boolean;
  timestamp: number;
};

export type CacheKey<TData = unknown> = string & {
  readonly __farmCacheData?: TData;
};

export type APIResult<TData = unknown, TError = Error> = {
  data: TData | undefined;
  error: TError | null;
  key: CacheKey<TData>;
};

export class APIClientError<
  TCode extends string = string,
  TData = unknown,
  TStatus extends number = number,
> extends Error {
  readonly code: TCode;
  readonly data: TData;
  readonly status: TStatus;
  readonly response?: Response;

  constructor(
    code: TCode,
    data: TData,
    options: {
      status: TStatus;
      message: string;
      response?: Response;
    },
  ) {
    super(options.message);
    this.name = "APIClientError";
    this.code = code;
    this.data = data;
    this.status = options.status;
    this.response = options.response;
  }
}

export type APIClientSystemError =
  | APIClientError<"http_error", unknown, number>
  | APIClientError<"network_error", unknown, 0>;

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
  key?: FarmClientCacheKey;
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
  | FarmClientCacheKey
  | {
      key: FarmClientCacheKey;
    }
  | {
      path: string;
      method?: "GET" | "HEAD" | "QUERY" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
      input?: unknown;
    }
  | [CallableRouteRef<any>, unknown?];

export type InvalidateOptions =
  | InvalidateTarget[]
  | {
      targets: InvalidateTarget[];
      refetch?: boolean;
    };

export type OptimisticUpdate =
  | [CallableRouteRef<any>, unknown, (prev: any) => any]
  | [CacheKey<any> | DefinedCacheKey<any> | string, (prev: any) => any];

export type OptimisticOptions<TUpdates extends readonly unknown[] = readonly OptimisticUpdate[]> = {
  update: TUpdates & NormalizeOptimisticUpdates<TUpdates>;
  rollbackOnError?: boolean;
};

export type ClientOptions<
  TData = unknown,
  TError = unknown,
  TUpdates extends readonly unknown[] = readonly OptimisticUpdate[],
> = {
  key?: CacheKey<TData> | FarmClientCacheKey;
  cache?: CacheOptions;
  retry?: RetryOptions;
  invalidate?: InvalidateOptions;
  optimistic?: OptimisticOptions<TUpdates>;
  onRequest?: (event: RequestEvent) => void;
  onResponse?: (
    data: TData | undefined,
    error: TError | null,
    event: ResponseEvent<TData, TError>,
  ) => void;
  onSuccess?: (data: TData) => void;
  onError?: (err: TError) => void;
  onSettled?: (data?: TData, err?: TError | null) => void;
  onStatus?: (event: StatusEvent<TData, TError>) => void;
};

type AnyRouteRef = (...args: any[]) => any;
type RouteRef<TData = any, TInput = any> = {
  readonly __farmRouteInput: TInput;
  readonly __farmRouteData: TData;
};
type CallableRouteRef<TData = any, TInput = any> = AnyRouteRef & RouteRef<TData, TInput>;

type InferRouteInput<TRoute> = TRoute extends { readonly __farmRouteInput: infer TInput }
  ? TInput
  : never;
type InferRouteData<TRoute> = TRoute extends { readonly __farmRouteData: infer TData }
  ? TData
  : never;

type NormalizeOptimisticUpdate<TUpdate> = TUpdate extends readonly [
  infer TRoute,
  unknown,
  (prev: any) => any,
]
  ? TRoute extends RouteRef<any, any>
    ? [
        TRoute,
        InferRouteInput<TRoute> | undefined,
        (prev: InferRouteData<TRoute> | undefined) => InferRouteData<TRoute>,
      ]
    : never
  : TUpdate extends readonly [infer TKey, (prev: any) => any]
    ? TKey extends DefinedCacheKey<any, RouteDataCacheKey>
      ? [TKey, (prev: InferCacheKeyData<TKey> | undefined) => InferCacheKeyData<TKey>]
      : TKey extends CacheKey<infer TData>
        ? [TKey, (prev: TData | undefined) => TData]
        : TKey extends string
          ? [TKey, (prev: unknown) => unknown]
          : never
    : never;

type NormalizeOptimisticUpdates<TUpdates extends readonly unknown[]> = {
  [K in keyof TUpdates]: NormalizeOptimisticUpdate<TUpdates[K]>;
};

type TypedEndpointLike = {
  __types: {
    body: any;
    query: any;
    response: any;
    errors?: any;
  };
};

type Simplify<T> = {
  [K in keyof T]: T[K];
} & {};

type IsNever<T> = [T] extends [never] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type RequiredKeys<T> = T extends object
  ? {
      [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
    }[keyof T]
  : never;

type BodyInputProp<TValue> =
  IsNever<TValue> extends true
    ? {}
    : IsAny<TValue> extends true
      ? { body?: TValue }
      : undefined extends TValue
        ? { body?: TValue }
        : { body: TValue };

type QueryInputProp<TValue> =
  IsNever<TValue> extends true
    ? {}
    : IsAny<TValue> extends true
      ? { query?: TValue }
      : undefined extends TValue
        ? { query?: TValue }
        : RequiredKeys<TValue> extends never
          ? { query?: TValue }
          : { query: TValue };

type HasRequiredKeys<T> = RequiredKeys<T> extends never ? false : true;

// Type utilities to extract endpoint input/output types from TypedEndpoint
type InferEndpointBody<T> = T extends {
  __types: {
    inputBody: infer TInputBody;
  };
}
  ? TInputBody
  : T extends {
        __types: {
          body: infer TBody;
        };
      }
    ? TBody
    : never;

type InferEndpointInput<T> = T extends {
  __types: {
    query: infer TQuery;
  };
}
  ? Simplify<BodyInputProp<InferEndpointBody<T>> & QueryInputProp<TQuery>>
  : {};

type InferEndpointOutput<T> = T extends {
  __types: {
    response: infer R;
  };
}
  ? R extends { readonly __farmStreamItem: infer TItem }
    ? FarmAPIStream<TItem>
    : R
  : any;

type InferEndpointError<T> = T extends {
  __types: {
    errors: infer TErrors;
  };
}
  ? keyof TErrors extends never
    ? Error
    :
        | {
            [TCode in keyof TErrors]: TErrors[TCode] extends {
              data: infer TData;
              status: infer TStatus extends number;
            }
              ? APIClientError<TCode & string, TData, TStatus>
              : never;
          }[keyof TErrors]
        | APIClientSystemError
  : Error;

// Type for a single endpoint method
type EndpointMethod<T = any> = (<TUpdates extends readonly unknown[] = readonly OptimisticUpdate[]>(
  ...args: HasRequiredKeys<InferEndpointInput<T>> extends true
    ? [
        options: InferEndpointInput<T>,
        clientOptions?: ClientOptions<InferEndpointOutput<T>, InferEndpointError<T>, TUpdates>,
      ]
    : [
        options?: InferEndpointInput<T>,
        clientOptions?: ClientOptions<InferEndpointOutput<T>, InferEndpointError<T>, TUpdates>,
      ]
) => Promise<APIResult<InferEndpointOutput<T>, InferEndpointError<T>>>) &
  RouteRef<InferEndpointOutput<T>, InferEndpointInput<T>>;

// Type for converting router structure to client structure
type RouterToClient<T> = {
  [K in keyof T]: T[K] extends TypedEndpointLike
    ? EndpointMethod<T[K]>
    : T[K] extends Record<string, any>
      ? RouterToClient<T[K]> // Recurssive handling of the multi level api routes
      : EndpointMethod<T[K]>;
};

export type RouteAPIClient<TRouter extends Record<string, any>> = RouterToClient<TRouter>;

export type APIClient<
  TRouter extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
> = RouteAPIClient<TRouter> & IntegrationClientRoot<TIntegrations>;

export type ServerAPIClient<
  TEndpoints extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
> = TEndpoints & IntegrationServerClientRoot<TIntegrations>;

/**
 * Create a typed RPC client for Farm.js API routes
 *
 * Returns a nested proxy that supports:
 * - api.hello.get({ query: { name: 'World' } })
 * - api['auth/login'].post({ body: { email: '...', password: '...' } })
 * - api.users.get({ query: { limit: '10' } })
 * - api.integrations.billing.checkout({ body: { priceId: 'price_...' } })
 *
 * @example
 * ```typescript
 * import { createAPIClient } from 'farm/client';
 * import type { APIRouter } from '@/api';
 * import type { AppIntegrations } from '@/lib/integrations';
 *
 * export const api = createAPIClient<APIRouter, AppIntegrations>();
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
 *
 * // Integration APIs live under a reserved namespace.
 * const checkout = await api.integrations.billing.checkout({
 *   body: { priceId: 'price_123' }
 * });
 * ```
 */
export function createAPIClient<TRouter extends Record<string, any>>(
  options: APIClientWithoutIntegrationsOptions,
): RouteAPIClient<TRouter>;
export function createAPIClient<
  TRouter extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
>(options?: APIClientOptions): APIClient<TRouter, TIntegrations>;
export function createAPIClient<
  TRouter extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
>(
  options: APIClientOptions | APIClientWithoutIntegrationsOptions = {},
): RouteAPIClient<TRouter> | APIClient<TRouter, TIntegrations> {
  options ??= {};
  const baseURL = options.baseURL || getFarmAPIBaseURL();
  const integrationOptions =
    options.integrations === false
      ? false
      : {
          baseURL: options.baseURL,
          headers: options.headers,
          credentials: options.credentials,
          ...(typeof options.integrations === "object" ? options.integrations : {}),
        };
  const rootAliases =
    integrationOptions === false
      ? undefined
      : {
          integrations: integrationsClient<TIntegrations>(integrationOptions),
        };

  const cacheState = getFarmClientDataCache();
  const inflightState = new Map<string, InflightEntry>();
  const routeMeta = new WeakMap<AnyRouteRef, RouteMeta>();
  let requestCounter = 0;

  // Create a simple fetch-based client (browser compatible)
  const fetchClient = async (path: string, requestOptions: any = {}) => {
    const url = resolveFarmAPIRequestURL(path, baseURL);

    // Handle query parameters
    if (requestOptions.query) {
      Object.entries(requestOptions.query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    // Prepare fetch options
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
      ...requestOptions.headers,
    };
    const fetchOptions: RequestInit = {
      method: requestOptions.method || "GET",
      headers,
    };

    // Handle body
    if (requestOptions.body !== undefined) {
      if (isFormData(requestOptions.body)) {
        deleteHeader(headers, "content-type");
        fetchOptions.body = requestOptions.body;
      } else {
        fetchOptions.body = JSON.stringify(requestOptions.body);
      }
    }

    const response = await fetch(url.toString(), fetchOptions);
    applyFarmCacheInvalidations(
      decodeFarmCacheInvalidations(response.headers?.get?.(FARM_CACHE_INVALIDATION_HEADER)),
    );
    let data: any = undefined;
    if (response.status !== 204 && response.status !== 205) {
      data = isJSONStreamResponse(response) ? readJSONStream(response) : await response.json();
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
    const configuredCacheKey = clientOptions?.key ?? cacheOptions?.key;
    const cacheKey = normalizeFarmClientCacheKey(
      configuredCacheKey ?? buildCacheKey(methodUpper, path, input, baseURL, options.headers),
    ) as CacheKey<any>;
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
    const hasReliableDefaultCacheKey =
      methodUpper !== "QUERY" || !isFormData(input?.body) || configuredCacheKey !== undefined;
    const isCacheEnabled =
      Boolean(cacheOptions) &&
      (methodUpper === "GET" || methodUpper === "QUERY") &&
      hasReliableDefaultCacheKey;
    const isStale = entry ? isEntryStale(entry, now) : true;

    const applyOptimisticUpdates = () => {
      if (!clientOptions?.optimistic?.update?.length) return [] as OptimisticSnapshot[];

      const snapshots: OptimisticSnapshot[] = [];
      for (const update of clientOptions.optimistic.update) {
        const [target, targetInput, updater] =
          update.length === 2
            ? [update[0], undefined, update[1]]
            : [update[0], update[1], update[2]];
        const targetKey = resolveTargetKey(
          routeMeta,
          target,
          targetInput,
          baseURL,
          options.headers,
        );
        if (!targetKey) continue;

        const targetEntry = getValidCacheEntry(cacheState, targetKey, now);
        const previousEntry = targetEntry ? { ...targetEntry } : undefined;
        const previousData = targetEntry?.data;
        const nextData = updater(previousData);
        cacheState.set(targetKey, {
          data: nextData,
          updatedAt: now,
          staleAt:
            targetEntry?.staleAt ??
            now + (cacheOptions?.staleTime ?? options.cacheDefaults?.staleTime ?? 0),
          gcAt:
            targetEntry?.gcAt ??
            getGcAt(now, cacheOptions?.gcTime ?? options.cacheDefaults?.gcTime),
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

            clientOptions?.onResponse?.(response.ok ? data : undefined, error, responseEvent);

            if (!error) {
              return { data, error: null, key: cacheKey } as APIResult<any, Error>;
            }

            if (attempt >= maxRetries) {
              return { data: undefined, error, key: cacheKey } as APIResult<any, Error>;
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
              return { data: undefined, error, key: cacheKey } as APIResult<any, Error>;
            }
          }

          attempt += 1;
          const delay =
            typeof clientOptions?.retry?.delay === "function"
              ? clientOptions.retry.delay(attempt)
              : (clientOptions?.retry?.delay ?? 0);

          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      })();

      inflightState.set(cacheKey, { promise, startedAt: now });

      try {
        const result = await promise;

        if (!result.error && isCacheEnabled && !isFarmAPIStream(result.data)) {
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
        const targetKey = resolveTargetKey(routeMeta, target, undefined, baseURL, options.headers);
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
        return { data: entry.data, error: null, key: cacheKey };
      }

      if (entry && isStale && policy === "stale-while-revalidate") {
        emitStatus("success", { data: entry.data });
        clientOptions?.onSuccess?.(entry.data);
        clientOptions?.onSettled?.(entry.data, null);

        void executeNetwork({ isBackground: true, callCallbacks: false });
        return { data: entry.data, error: null, key: cacheKey };
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
  return createNestedProxy(
    [],
    request,
    routeMeta,
    baseURL,
    isSameOriginAPIBaseURL(baseURL),
    rootAliases,
  ) as APIClient<TRouter, TIntegrations>;
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
  routeMeta: WeakMap<AnyRouteRef, RouteMeta>,
  baseURL: string,
  sameOrigin: boolean,
  rootAliases?: Record<string, unknown>,
): any {
  const target = () => {};
  const proxy = new Proxy(target, {
    // When accessing a property (api.hello)
    get(_target, prop: string | symbol) {
      if (prop === FARM_API_ROUTE_REF_SYMBOL) {
        return path.length > 0;
      }
      if (prop === FARM_API_ROUTE_META_SYMBOL) {
        const metadata = resolveRouteMeta({ path, baseURL });
        const requestURL = resolveFarmAPIRequestURL(metadata.routePath, baseURL);
        return Object.freeze({
          path: `${requestURL.pathname}${requestURL.search}${requestURL.hash}`,
          method: metadata.method,
          baseURL: requestURL.origin,
          sameOrigin,
        });
      }

      if (path.length === 0 && typeof prop === "string" && rootAliases && prop in rootAliases) {
        return rootAliases[prop];
      }

      if (typeof prop !== "string") {
        return Reflect.get(_target, prop);
      }

      // Add prop to path and return new proxy
      return createNestedProxy(
        [...path, prop],
        client,
        routeMeta,
        baseURL,
        sameOrigin,
        rootAliases,
      );
    },

    // When calling as a function
    apply(_target, _thisArg, args) {
      // Check if the last part is an HTTP method
      const lastPart = path[path.length - 1];
      const httpMethods = ["get", "head", "query", "post", "put", "delete", "patch", "options"];

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

  routeMeta.set(proxy, { path: [...path], baseURL });
  return proxy;
}

export function isAPIRouteRef(value: unknown): value is CallableRouteRef {
  return (
    typeof value === "function" &&
    (value as { [FARM_API_ROUTE_REF_SYMBOL]?: unknown })[FARM_API_ROUTE_REF_SYMBOL] === true
  );
}

export function getAPIRouteRefMetadata(value: unknown): APIRouteRefMetadata | null {
  if (!isAPIRouteRef(value)) return null;
  const metadata = (value as { [FARM_API_ROUTE_META_SYMBOL]?: unknown })[
    FARM_API_ROUTE_META_SYMBOL
  ];
  if (!metadata || typeof metadata !== "object") return null;

  const candidate = metadata as Partial<APIRouteRefMetadata>;
  if (
    typeof candidate.path !== "string" ||
    typeof candidate.method !== "string" ||
    typeof candidate.baseURL !== "string" ||
    typeof candidate.sameOrigin !== "boolean"
  ) {
    return null;
  }

  return {
    path: candidate.path,
    method: candidate.method,
    baseURL: candidate.baseURL,
    sameOrigin: candidate.sameOrigin,
  };
}

/**
 * Server-side API client that calls endpoints directly as functions
 * No HTTP overhead for app endpoints, and registered integration routes can be exposed at
 * api.integrations.* where Farm can dispatch them directly to the integration handler.
 *
 * @example
 * ```typescript
 * import { createServerAPIClient } from 'farm/client';
 * import type { AppIntegrations } from '@/lib/integrations';
 *
 * export const api = createServerAPIClient<{}, AppIntegrations>({});
 *
 * const result = await api.integrations.billing.status();
 * ```
 */
export function createServerAPIClient<TEndpoints extends Record<string, any>>(
  endpoints: TEndpoints,
): TEndpoints;
export function createServerAPIClient<TEndpoints extends Record<string, any>>(
  endpoints: TEndpoints,
  options: ServerAPIClientWithoutIntegrationsOptions,
): TEndpoints;
export function createServerAPIClient<
  TEndpoints extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
>(
  endpoints: TEndpoints,
  options?: ServerAPIClientOptions,
): ServerAPIClient<TEndpoints, TIntegrations>;
export function createServerAPIClient<
  TEndpoints extends Record<string, any>,
  TIntegrations extends Record<string, any> = {},
>(
  endpoints: TEndpoints,
  options: ServerAPIClientOptions | ServerAPIClientWithoutIntegrationsOptions = {},
): TEndpoints | ServerAPIClient<TEndpoints, TIntegrations> {
  if (
    options.integrations === false ||
    Object.prototype.hasOwnProperty.call(endpoints, "integrations")
  ) {
    return endpoints;
  }

  Object.defineProperty(endpoints, "integrations", {
    get() {
      return integrationsServer<TIntegrations>(
        typeof options.integrations === "object" ? options.integrations : {},
      );
    },
    enumerable: false,
    configurable: true,
  });

  return endpoints as ServerAPIClient<TEndpoints, TIntegrations>;
}

type CacheEntry = FarmClientCacheEntry<any>;

type InflightEntry = {
  promise: Promise<APIResult<any, Error>>;
  startedAt: number;
};

type RouteMeta = {
  path: string[];
  baseURL: string;
};

type OptimisticSnapshot = {
  key: string;
  entry?: CacheEntry;
};

function buildCacheKey(
  method: string,
  path: string,
  input: any,
  baseURL: string,
  defaultHeaders?: Record<string, string>,
): string {
  const keyInput =
    input && typeof input === "object"
      ? {
          query: input.query,
          body: input.body,
          ...(method === "QUERY"
            ? {
                contentType:
                  getHeader(input.headers, "content-type") ??
                  getHeader(defaultHeaders, "content-type") ??
                  "application/json",
                contentEncoding:
                  getHeader(input.headers, "content-encoding") ??
                  getHeader(defaultHeaders, "content-encoding"),
              }
            : {}),
        }
      : input;
  const url = resolveFarmAPIRequestURL(path, baseURL);
  return `${method}:${url.origin}${url.pathname}:${stableStringify(keyInput ?? {})}`;
}

function isSameOriginAPIBaseURL(baseURL: string): boolean {
  if (typeof window === "undefined") return baseURL.startsWith("/");
  return resolveFarmAPIRequestURL("/api", baseURL).origin === window.location.origin;
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

function getHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] === undefined ? undefined : String(entry[1]);
}

function getGcAt(now: number, gcTime?: number): number | undefined {
  if (gcTime === undefined) return undefined;
  if (!Number.isFinite(gcTime) || gcTime <= 0) return now;
  return now + gcTime;
}

function getValidCacheEntry(
  cacheState: FarmClientDataCache,
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
  routeMeta: WeakMap<AnyRouteRef, RouteMeta>,
  target: InvalidateTarget | AnyRouteRef,
  input?: unknown,
  baseURL = "http://localhost:3000",
  defaultHeaders?: Record<string, string>,
): string | null {
  if (!target) return null;

  if (typeof target === "string") return target;

  if (typeof target === "function") {
    const meta = routeMeta.get(target);
    if (!meta) return null;

    const { method, routePath } = resolveRouteMeta(meta);
    return buildCacheKey(method, routePath, input ?? {}, meta.baseURL, defaultHeaders);
  }

  if (Array.isArray(target)) {
    const [route, routeInput] = target;
    if (typeof route === "function") {
      return resolveTargetKey(routeMeta, route, routeInput, baseURL, defaultHeaders);
    }
    return normalizeFarmClientCacheKey(target);
  }

  if ("key" in target) return normalizeFarmClientCacheKey(target.key);

  if ("path" in target) {
    const method = target.method ?? "GET";
    return buildCacheKey(method, target.path, target.input ?? {}, baseURL, defaultHeaders);
  }

  return null;
}

function resolveRouteMeta(meta: RouteMeta): { routePath: string; method: string } {
  const httpMethods = ["get", "head", "query", "post", "put", "delete", "patch", "options"];
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
  if (error instanceof APIClientError) return error;

  const normalized = new APIClientError("network_error", undefined, {
    status: 0,
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Network request failed",
  });
  (normalized as Error & { cause?: unknown }).cause = error;
  return normalized;
}

function isFormData(value: unknown): value is FormData {
  return (
    typeof value === "object" &&
    value !== null &&
    ((typeof FormData !== "undefined" && value instanceof FormData) ||
      (Object.prototype.toString.call(value) === "[object FormData]" &&
        typeof (value as { entries?: unknown }).entries === "function"))
  );
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const normalized = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalized) delete headers[key];
  }
}

function createResponseError(response: Response, data: any): Error {
  const expected = readEndpointErrorEnvelope(data);
  if (expected) {
    return new APIClientError(expected.code, expected.data, {
      status: response.status,
      message: expected.message,
      response,
    });
  }

  return new APIClientError("http_error", data, {
    status: response.status,
    message: `HTTP ${response.status}: ${response.statusText}`,
    response,
  });
}

function readEndpointErrorEnvelope(data: unknown): {
  code: string;
  message: string;
  data: unknown;
} | null {
  if (!data || typeof data !== "object") return null;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;

  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== "string" || typeof message !== "string") return null;

  return {
    code,
    message,
    data: (error as { data?: unknown }).data,
  };
}
