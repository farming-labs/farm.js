import { createEndpoint as betterCallEndpoint } from "better-call";

// Generic schema type that works with both Zod v3 and v4
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = { _output?: any; _input?: any; parse?: (data: unknown) => any };

type MaybePromise<T> = T | Promise<T>;
type Simplify<T> = { [TKey in keyof T]: T[TKey] } & {};
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TIntersection,
) => void
  ? TIntersection
  : never;

// Infer output type from schema (works with Zod v3 and v4)
type InferOutput<T> = T extends { _output: infer O }
  ? O
  : T extends { parse: (data: unknown) => infer R }
    ? R
    : unknown;

type InferHeadersOutput<T> = [T] extends [never]
  ? Record<string, string>
  : T extends AnySchema
    ? InferOutput<T>
    : Record<string, string>;

export type EndpointParamValue = string | string[];
export type EndpointParams = Record<string, EndpointParamValue>;

export type EndpointMiddlewareContext<
  TContext extends object = {},
  TBody = unknown,
  TQuery = unknown,
  THeaders = Record<string, string>,
> = {
  body: TBody;
  query: TQuery;
  headers: THeaders;
  request: Request;
  /** Context accumulated from middleware that ran earlier in the chain. */
  context: Readonly<TContext>;
  params: EndpointParams;
};

export type EndpointMiddlewareResult<TProvidedContext extends object = object> =
  | TProvidedContext
  | true
  | false
  | Response;

/** A plain async function. No wrapper or `next()` callback is required. */
export type EndpointMiddleware<
  TProvidedContext extends object = object,
  TContext extends object = {},
  TBody = unknown,
  TQuery = unknown,
  THeaders = Record<string, string>,
> = (
  ctx: EndpointMiddlewareContext<TContext, TBody, TQuery, THeaders>,
) => MaybePromise<EndpointMiddlewareResult<TProvidedContext>>;

export type AnyEndpointMiddleware = (ctx: EndpointMiddlewareContext<any, any, any, any>) => unknown;

type ValidateEndpointMiddlewares<TMiddlewares extends readonly AnyEndpointMiddleware[]> = {
  readonly [TIndex in keyof TMiddlewares]: TMiddlewares[TIndex] extends AnyEndpointMiddleware
    ? [Awaited<ReturnType<TMiddlewares[TIndex]>>] extends [EndpointMiddlewareResult<object>]
      ? TMiddlewares[TIndex]
      : never
    : never;
};

type ContextFromMiddlewareResult<TResult> =
  Exclude<TResult, Response | boolean> extends infer TContext
    ? [TContext] extends [never]
      ? {}
      : TContext extends object
        ? TContext
        : {}
    : {};

type ContextFromMiddleware<TMiddleware> = TMiddleware extends (...args: any[]) => infer TResult
  ? ContextFromMiddlewareResult<Awaited<TResult>>
  : {};

export type InferEndpointMiddlewareContext<
  TMiddlewares extends readonly ((...args: any[]) => any)[],
  TContext extends object = {},
> = TMiddlewares extends readonly [infer TMiddleware, ...infer TRest]
  ? TMiddleware extends (...args: any[]) => any
    ? TRest extends readonly ((...args: any[]) => any)[]
      ? InferEndpointMiddlewareContext<
          TRest,
          Simplify<TContext & ContextFromMiddleware<TMiddleware>>
        >
      : Simplify<TContext>
    : Simplify<TContext>
  : number extends TMiddlewares["length"]
    ? Simplify<TContext & UnionToIntersection<ContextFromMiddleware<TMiddlewares[number]>>>
    : Simplify<TContext>;

export type EndpointOptions<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TMiddlewares extends readonly AnyEndpointMiddleware[] = readonly [],
> = {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
  body?: TBody;
  query?: TQuery;
  headers?: THeaders;
  middleware?: TMiddlewares;
  /** @deprecated Use plain functions in `middleware` for Farm endpoint middleware. */
  use?: any[];
};

export type EndpointHandler<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
  TContext extends object = {},
> = (ctx: {
  body: InferOutput<TBody>;
  query: InferOutput<TQuery>;
  headers: InferHeadersOutput<THeaders>;
  request: Request;
  context: Readonly<TContext>;
  params: EndpointParams;
}) => Promise<TResponse> | TResponse;

// Type to represent an endpoint with its input/output types
export type TypedEndpoint<
  TBody = never,
  TQuery = never,
  TResponse = any,
  THeaders = Record<string, string>,
> = {
  __types: {
    body: TBody;
    query: TQuery;
    headers: THeaders;
    response: TResponse;
  };
  __path?: string;
  __method?: string;
} & ((options?: { body?: TBody; query?: TQuery }) => Promise<TResponse>);

type CreatedEndpoint<
  TBody extends AnySchema,
  TQuery extends AnySchema,
  THeaders extends AnySchema,
  TResponse,
> = TypedEndpoint<
  InferOutput<TBody>,
  InferOutput<TQuery>,
  Awaited<TResponse>,
  InferHeadersOutput<THeaders>
>;

type AnyEndpointOptions = EndpointOptions<
  AnySchema,
  AnySchema,
  AnySchema,
  readonly AnyEndpointMiddleware[]
>;
type EndpointBodyFromOptions<TOptions> = TOptions extends {
  body: infer TBody extends AnySchema;
}
  ? TBody
  : never;
type EndpointQueryFromOptions<TOptions> = TOptions extends {
  query: infer TQuery extends AnySchema;
}
  ? TQuery
  : never;
type EndpointHeadersFromOptions<TOptions> = TOptions extends {
  headers: infer THeaders extends AnySchema;
}
  ? THeaders
  : never;
type EndpointMiddlewaresFromOptions<TOptions> = TOptions extends {
  middleware: infer TMiddlewares extends readonly AnyEndpointMiddleware[];
}
  ? TMiddlewares
  : readonly [];
type MethodlessEndpointOptions = Omit<AnyEndpointOptions, "method">;
type EndpointHandlerFromOptions<TOptions, TResponse> = EndpointHandler<
  EndpointBodyFromOptions<TOptions>,
  EndpointQueryFromOptions<TOptions>,
  EndpointHeadersFromOptions<TOptions>,
  TResponse,
  InferEndpointMiddlewareContext<EndpointMiddlewaresFromOptions<TOptions>>
>;
type ValidatedEndpointHandlerFromOptions<TOptions, TResponse> = EndpointHandlerFromOptions<
  TOptions,
  TResponse
> &
  (EndpointMiddlewaresFromOptions<TOptions> extends ValidateEndpointMiddlewares<
    EndpointMiddlewaresFromOptions<TOptions>
  >
    ? unknown
    : never);
type CreatedEndpointFromOptions<TOptions, TResponse> = CreatedEndpoint<
  EndpointBodyFromOptions<TOptions>,
  EndpointQueryFromOptions<TOptions>,
  EndpointHeadersFromOptions<TOptions>,
  TResponse
>;

/**
 * Create a Farm.js API endpoint
 *
 * Supports two patterns:
 * 1. File-based routing (path auto-inferred from file location):
 *    `export const POST = createEndpoint({ method: 'POST', body: schema }, handler)`
 *    `createEndpoint({ method: 'GET', query: z.object({...}) }, handler)`
 *
 * 2. Explicit path (for routes.ts at project root):
 *    `createEndpoint('/api/hello', { method: 'GET', query: z.object({...}) }, handler)`
 */
export function createEndpoint<const TOptions extends AnyEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function createEndpoint<const TOptions extends AnyEndpointOptions, TResponse = any>(
  path: string,
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function createEndpoint<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: EndpointOptions<TBody, TQuery, THeaders, readonly []>,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function createEndpoint<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  path: string,
  options: EndpointOptions<TBody, TQuery, THeaders, readonly []>,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function createEndpoint(
  pathOrOptions: string | EndpointOptions<any, any, any, readonly AnyEndpointMiddleware[]>,
  optionsOrHandler:
    | EndpointOptions<any, any, any, readonly AnyEndpointMiddleware[]>
    | EndpointHandler<any, any, any, any, any>,
  maybeHandler?: EndpointHandler<any, any, any, any, any>,
): TypedEndpoint<any, any, any, any> {
  // Determine if first arg is path or options
  let path: string;
  let options: EndpointOptions<any, any, any, readonly AnyEndpointMiddleware[]>;
  let handler: EndpointHandler<any, any, any, any, any>;

  if (typeof pathOrOptions === "string") {
    // createEndpoint('/path', options, handler)
    path = pathOrOptions;
    options = optionsOrHandler as typeof options;
    handler = maybeHandler as typeof handler;
  } else {
    // createEndpoint(options, handler) - path will be set by API plugin from file location
    path = "";
    options = pathOrOptions;
    handler = optionsOrHandler as typeof handler;
  }

  if (typeof handler !== "function") {
    throw new TypeError("createEndpoint requires a handler function");
  }

  const middleware = normalizeEndpointMiddleware(options.middleware);
  const wrappedHandler = ((ctx: EndpointMiddlewareContext<any, any, any, any>) =>
    runEndpointMiddleware(middleware, ctx, handler)) as typeof handler;
  const { middleware: _middleware, ...betterCallOptions } = options;

  // Create the endpoint - path will be set later by API plugin if not provided
  // We use a temporary path that will be replaced when the router is created
  const endpoint = betterCallEndpoint(
    path || "/__farm_auto_path__",
    betterCallOptions as any,
    wrappedHandler as any,
  ) as any;

  // Store the path and type information on the endpoint for later access
  // Empty/undefined path means it will be inferred from file location by the API plugin
  endpoint.__path = path || undefined;
  endpoint.__method = options.method || "GET";
  endpoint.__autoPath = !path; // Flag to indicate path should be auto-inferred
  endpoint.__handler = wrappedHandler; // Used by Farm's route runtime.
  endpoint.__middleware = middleware;
  endpoint.__sourceHandler = handler;

  // Store type information for inference
  endpoint.__types = {
    body: options.body,
    query: options.query,
    headers: options.headers,
    response: null as any,
  };

  return endpoint as any;
}

const EMPTY_ENDPOINT_MIDDLEWARE = Object.freeze([]) as readonly AnyEndpointMiddleware[];
const EMPTY_ENDPOINT_CONTEXT = Object.freeze(Object.create(null)) as Readonly<
  Record<string | symbol, unknown>
>;
const UNSAFE_ENDPOINT_CONTEXT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeEndpointMiddleware(
  middleware: readonly AnyEndpointMiddleware[] | undefined,
): readonly AnyEndpointMiddleware[] {
  if (middleware === undefined) return EMPTY_ENDPOINT_MIDDLEWARE;
  if (!Array.isArray(middleware)) {
    throw new TypeError("createEndpoint middleware must be an array of functions");
  }

  const normalized = [...middleware];
  for (const entry of normalized) {
    if (typeof entry !== "function") {
      throw new TypeError("createEndpoint middleware entries must be functions");
    }
  }

  return Object.freeze(normalized);
}

async function runEndpointMiddleware(
  middleware: readonly AnyEndpointMiddleware[],
  handlerContext: EndpointMiddlewareContext<any, any, any, any>,
  handler: EndpointHandler<any, any, any, any, any>,
): Promise<unknown> {
  let context = createInitialEndpointContext(handlerContext.context);

  for (let index = 0; index < middleware.length; index++) {
    const result = await middleware[index]({ ...handlerContext, context });

    if (isEndpointResponse(result)) return result;
    if (result === false) return forbiddenEndpointResponse();
    if (result === true) continue;

    if (!isPlainEndpointContext(result)) {
      throw new TypeError(
        `Endpoint middleware ${index + 1} must return an object, true, false, or a Response`,
      );
    }

    context = mergeEndpointContext(context, result, index);
  }

  return handler({ ...handlerContext, context });
}

function createInitialEndpointContext(value: unknown) {
  if (value === undefined || value === null) return EMPTY_ENDPOINT_CONTEXT;
  if (!isPlainEndpointContext(value)) {
    throw new TypeError("Endpoint context must be a plain object");
  }

  return mergeEndpointContext(EMPTY_ENDPOINT_CONTEXT, value);
}

function mergeEndpointContext(
  current: Readonly<Record<string | symbol, unknown>>,
  added: object,
  middlewareIndex?: number,
) {
  const next = Object.assign(Object.create(null), current) as Record<string | symbol, unknown>;

  for (const key of Reflect.ownKeys(added)) {
    if (!Object.prototype.propertyIsEnumerable.call(added, key)) continue;
    if (typeof key === "string" && UNSAFE_ENDPOINT_CONTEXT_KEYS.has(key)) {
      throw new TypeError(`Endpoint middleware cannot provide the unsafe context key "${key}"`);
    }
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      const source =
        middlewareIndex === undefined
          ? "Endpoint context"
          : `Endpoint middleware ${middlewareIndex + 1}`;
      throw new TypeError(`${source} cannot replace the existing context key "${String(key)}"`);
    }
    next[key] = (added as Record<string | symbol, unknown>)[key];
  }

  return Object.freeze(next);
}

function isPlainEndpointContext(value: unknown): value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEndpointResponse(value: unknown): value is Response {
  return (
    value instanceof Response ||
    (typeof value === "object" &&
      value !== null &&
      "headers" in value &&
      "status" in value &&
      typeof (value as Response).arrayBuffer === "function")
  );
}

function forbiddenEndpointResponse() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Convenience method for GET requests
 */
export function GET<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function GET<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function GET<
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<never, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<never, TQuery, THeaders, TResponse>,
): CreatedEndpoint<never, TQuery, THeaders, TResponse>;
export function GET(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "GET" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "GET" }, args[1]);
}

/**
 * Convenience method for HEAD requests
 */
export function HEAD<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function HEAD<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function HEAD<
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<never, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<never, TQuery, THeaders, TResponse>,
): CreatedEndpoint<never, TQuery, THeaders, TResponse>;
export function HEAD(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "HEAD" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "HEAD" }, args[1]);
}

/**
 * Convenience method for POST requests
 */
export function POST<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function POST<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function POST<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function POST(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "POST" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "POST" }, args[1]);
}

/**
 * Convenience method for PUT requests
 */
export function PUT<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function PUT<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function PUT<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function PUT(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "PUT" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "PUT" }, args[1]);
}

/**
 * Convenience method for DELETE requests
 */
export function DELETE<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function DELETE<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function DELETE<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function DELETE(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "DELETE" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "DELETE" }, args[1]);
}

/**
 * Convenience method for PATCH requests
 */
export function PATCH<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function PATCH<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function PATCH<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function PATCH(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "PATCH" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "PATCH" }, args[1]);
}

/**
 * Convenience method for OPTIONS requests
 */
export function OPTIONS<T = any>(
  handler: EndpointHandler<never, never, never, T>,
): CreatedEndpoint<never, never, never, T>;
export function OPTIONS<const TOptions extends MethodlessEndpointOptions, TResponse = any>(
  options: TOptions,
  handler: ValidatedEndpointHandlerFromOptions<TOptions, TResponse>,
): CreatedEndpointFromOptions<TOptions, TResponse>;
export function OPTIONS<
  TBody extends AnySchema = never,
  TQuery extends AnySchema = never,
  THeaders extends AnySchema = never,
  TResponse = any,
>(
  options: Omit<EndpointOptions<TBody, TQuery, THeaders, readonly []>, "method">,
  handler: EndpointHandler<TBody, TQuery, THeaders, TResponse>,
): CreatedEndpoint<TBody, TQuery, THeaders, TResponse>;
export function OPTIONS(...args: any[]): any {
  if (args.length === 1) {
    return createEndpoint("", { method: "OPTIONS" }, args[0]);
  }
  return createEndpoint("", { ...args[0], method: "OPTIONS" }, args[1]);
}
