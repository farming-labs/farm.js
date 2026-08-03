import {
  createFarmCacheKey,
  createRouteDataCacheKey,
  createRouteDataCacheTag,
  getFarmDataCache,
  type RouteDataCacheKey,
} from "./cache";
import { getServerActionExecutionContext } from "./server-action-security";
import {
  createServerFn,
  type AnyServerFnMiddleware,
  type InferServerFnSchemaInput,
  type InferServerFnSchemaOutput,
  type ServerFn,
  type ServerFnContext,
  type ServerFnHandler,
  type ServerFnHandlerContext,
  type ServerFnMiddlewareContext,
  type ServerFnSchema,
  _parseServerFnSchema,
} from "./server-fn";
import { createFarmServerQueryResult, type FarmServerQueryResult } from "./server-query-protocol";

type MaybePromise<T> = T | Promise<T>;

export type ServerQueryStaleTime = number | false | `${number}${"ms" | "s" | "m" | "h"}`;

export type ServerQueryKey<TInput, TContext extends object = {}> = (
  context: ServerFnContext<TInput, TContext>,
) => MaybePromise<RouteDataCacheKey>;

export type ServerQueryOptions<
  TSchema extends ServerFnSchema | undefined,
  TResult,
  TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
> = {
  input?: TSchema;
  output?: undefined;
  middleware?: TMiddlewares;
  key: ServerQueryKey<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  /** Milliseconds, a duration string such as "30s", or false for no expiry. */
  staleTime?: ServerQueryStaleTime;
  handler: ServerFnHandler<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    TResult,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
};

export type ServerQueryOutputOptions<
  TInputSchema extends ServerFnSchema | undefined,
  TOutputSchema extends ServerFnSchema,
  TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
> = {
  input?: TInputSchema;
  output: TOutputSchema;
  middleware?: TMiddlewares;
  key: ServerQueryKey<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  /** Milliseconds, a duration string such as "30s", or false for no expiry. */
  staleTime?: ServerQueryStaleTime;
  handler: ServerFnHandler<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    unknown,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
};

export type ServerQuery<TInput, TResult> = ([unknown] extends [TInput]
  ? (input?: TInput) => Promise<TResult>
  : (input: TInput) => Promise<TResult>) & {
  readonly __farmServerQuery: true;
  readonly __farmServerQueryInput?: unknown;
  readonly __farmServerQueryOutput?: unknown;
};

export const FARM_SERVER_QUERY_SYMBOL = Symbol.for("farm.server-query");

type AnyServerQueryOptions = {
  input?: ServerFnSchema;
  output?: ServerFnSchema;
  middleware?: readonly AnyServerFnMiddleware[];
  key: ServerQueryKey<any, any>;
  staleTime?: ServerQueryStaleTime;
  handler: ServerFnHandler<any, any, any>;
};

const requestInflight = new WeakMap<Request, Map<string, Promise<unknown>>>();
const detachedInflight = new Map<string, Promise<unknown>>();

export function createServerQuery<
  TInputSchema extends ServerFnSchema,
  TOutputSchema extends ServerFnSchema,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerQueryOutputOptions<TInputSchema, TOutputSchema, TMiddlewares>,
): ServerQuery<
  InferServerFnSchemaInput<TInputSchema>,
  Awaited<InferServerFnSchemaOutput<TOutputSchema>>
>;
export function createServerQuery<
  TOutputSchema extends ServerFnSchema,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerQueryOutputOptions<undefined, TOutputSchema, TMiddlewares>,
): ServerQuery<unknown, Awaited<InferServerFnSchemaOutput<TOutputSchema>>>;
export function createServerQuery<
  TSchema extends ServerFnSchema,
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerQueryOptions<TSchema, TResult, TMiddlewares>,
): ServerQuery<InferServerFnSchemaInput<TSchema>, Awaited<TResult>>;
export function createServerQuery<
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerQueryOptions<undefined, TResult, TMiddlewares>,
): ServerQuery<unknown, Awaited<TResult>>;
export function createServerQuery(options: AnyServerQueryOptions): ServerQuery<unknown, unknown> {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerQuery requires a handler function");
  }
  if (typeof options.key !== "function") {
    throw new TypeError("createServerQuery requires a key function");
  }

  const staleTime = normalizeServerQueryStaleTime(options.staleTime);
  const execute = (
    createServerFn as (options: any) => ServerFn<unknown, FarmServerQueryResult<any>>
  )({
    input: options.input,
    middleware: options.middleware,
    handler: async (context: ServerFnHandlerContext<any, any>) => {
      const routeKey = await options.key(context);
      assertServerQueryKey(routeKey);

      const clientKey = createRouteDataCacheKey(routeKey);
      const cacheKey = createFarmCacheKey(["route-data", routeKey]);
      const producer = async () => {
        const value = await options.handler(context);
        return _parseServerFnSchema(options.output, value, "output", "createServerQuery");
      };

      let data: unknown;
      let updatedAt: number;

      if (staleTime === 0) {
        data = await dedupeServerQueryRequest(cacheKey, context.request, producer);
        updatedAt = Date.now();
      } else {
        const cache = getFarmDataCache();
        data = await cache.getOrSet(cacheKey, producer, {
          tags: [createRouteDataCacheTag(routeKey)],
          revalidate: staleTime === false ? false : Math.max(1, Math.ceil(staleTime / 1000)),
        });
        updatedAt =
          (await cache.getEntryAsync(cacheKey, { allowStale: true }))?.createdAt ?? Date.now();
      }

      return createFarmServerQueryResult(data, {
        key: clientKey,
        staleTime,
        updatedAt,
      });
    },
  });

  const query = async (input?: unknown) => {
    const result = await execute(input);
    return getServerActionExecutionContext() ? result : result.data;
  };

  Object.defineProperties(query, {
    [FARM_SERVER_QUERY_SYMBOL]: {
      value: true,
      enumerable: false,
    },
    __farmServerQuery: {
      value: true,
      enumerable: false,
    },
    __farmServerQueryInput: {
      value: options.input,
      enumerable: false,
    },
    __farmServerQueryOutput: {
      value: options.output,
      enumerable: false,
    },
  });

  return query as ServerQuery<unknown, unknown>;
}

async function dedupeServerQueryRequest<TData>(
  key: string,
  request: Request | undefined,
  producer: () => Promise<TData>,
): Promise<TData> {
  let inflight: Map<string, Promise<unknown>>;
  if (request) {
    inflight = requestInflight.get(request) ?? new Map();
    requestInflight.set(request, inflight);
  } else {
    inflight = detachedInflight;
  }

  const existing = inflight.get(key) as Promise<TData> | undefined;
  if (existing) return existing;

  const promise = Promise.resolve().then(producer);
  inflight.set(key, promise);

  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function normalizeServerQueryStaleTime(value: ServerQueryStaleTime | undefined): number | false {
  if (value === false) return false;
  if (value === undefined) return 0;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError("createServerQuery staleTime must be a non-negative duration");
    }
    return value;
  }

  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) {
    throw new TypeError('createServerQuery staleTime must look like "250ms", "30s", "5m", or "1h"');
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return amount * multiplier;
}

function assertServerQueryKey(key: unknown): asserts key is RouteDataCacheKey {
  if (typeof key === "string") {
    if (key.trim().length > 0) return;
  } else if (Array.isArray(key)) {
    return;
  }

  throw new TypeError("createServerQuery key must return a non-empty string or an array");
}
