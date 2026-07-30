import { getServerActionExecutionContext, getServerActionSignal } from "./server-action-security";
import { _resolveCurrentRequest } from "./server/request-bridge";
import { applyFarmCacheInvalidationTargets, type FarmCacheInvalidationTarget } from "./cache";

type MaybePromise<T> = T | Promise<T>;

// Generic schema type that works with Zod v3/v4 and similar validator APIs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServerFnSchema = {
  _input?: any;
  _output?: any;
  parse?: (data: unknown) => any;
  parseAsync?: (data: unknown) => Promise<any>;
  safeParse?: (data: unknown) => any;
  safeParseAsync?: (data: unknown) => Promise<any>;
};

export type InferServerFnSchemaInput<T> = T extends { _input: infer I } ? I : unknown;
export type InferServerFnSchemaOutput<T> = T extends { _output: infer O }
  ? O
  : T extends { parse: (data: unknown) => infer R }
    ? R
    : unknown;

export type ServerFnFormInput = FormData;

type Simplify<T> = { [TKey in keyof T]: T[TKey] } & {};
type AssignContext<TCurrent extends object, TNext extends object> = Simplify<
  Omit<TCurrent, keyof TNext> & TNext
>;
type MiddlewareContext<TMiddleware> =
  TMiddleware extends ServerFnMiddleware<infer TContext> ? TContext : {};

export type ServerFnMiddlewareContext<
  TMiddlewares extends readonly AnyServerFnMiddleware[],
  TContext extends object = {},
> = TMiddlewares extends readonly [infer TMiddleware, ...infer TRest]
  ? TMiddleware extends AnyServerFnMiddleware
    ? TRest extends readonly AnyServerFnMiddleware[]
      ? ServerFnMiddlewareContext<TRest, AssignContext<TContext, MiddlewareContext<TMiddleware>>>
      : TContext
    : TContext
  : number extends TMiddlewares["length"]
    ? Simplify<TContext & MiddlewareContext<TMiddlewares[number]>>
    : Simplify<TContext>;

declare const SERVER_FN_MIDDLEWARE_CONTEXT: unique symbol;

export type ServerFnMiddlewareContinuation<TContext extends object = {}> = {
  readonly [SERVER_FN_MIDDLEWARE_CONTEXT]: TContext;
};

export type ServerFnMiddlewareNext = <TContext extends object = {}>(options?: {
  context?: TContext;
}) => Promise<ServerFnMiddlewareContinuation<TContext>>;

export type ServerFnContext<TInput, TContext extends object = {}> = {
  input: TInput;
  rawInput: unknown;
  formData?: FormData;
  /** The action request when invoked across the network. Undefined for direct server calls. */
  request?: Request;
  /** Aborts when the underlying action request is cancelled. */
  signal: AbortSignal;
  /** Context produced by this server function's middleware chain. */
  context: Readonly<TContext>;
};

export type ServerFnHandler<TInput, TResult, TContext extends object = {}> = (
  ctx: ServerFnContext<TInput, TContext>,
) => MaybePromise<TResult>;

export type ServerFnInvalidationContext<
  TInput,
  TResult,
  TContext extends object = {},
> = ServerFnContext<TInput, TContext> & {
  /** Parsed value returned by the successful server function. */
  result: TResult;
};

export type ServerFnInvalidations<TInput, TResult, TContext extends object = {}> =
  | readonly FarmCacheInvalidationTarget[]
  | ((
      context: ServerFnInvalidationContext<TInput, TResult, TContext>,
    ) => readonly FarmCacheInvalidationTarget[] | Promise<readonly FarmCacheInvalidationTarget[]>);

export type ServerFnMiddlewareHandlerContext<TContext extends object = {}> = ServerFnContext<
  unknown,
  TContext
> & {
  next: ServerFnMiddlewareNext;
};

export type ServerFnMiddlewareHandler<
  TContext extends object = {},
  TProvidedContext extends object = {},
> = (
  ctx: ServerFnMiddlewareHandlerContext<TContext>,
) => MaybePromise<ServerFnMiddlewareContinuation<TProvidedContext>>;

export type ServerFnMiddleware<TContext extends object = {}> = {
  readonly __farmServerFnMiddleware: true;
  readonly __farmServerFnMiddlewareContext?: TContext;
  readonly middleware: readonly AnyServerFnMiddleware[];
  readonly handler: ServerFnMiddlewareHandler<any, any>;
};

export type AnyServerFnMiddleware = ServerFnMiddleware<any>;

export type ServerFnMiddlewareOptions<
  TMiddlewares extends readonly AnyServerFnMiddleware[],
  TProvidedContext extends object,
> = {
  middleware?: TMiddlewares;
  handler: ServerFnMiddlewareHandler<ServerFnMiddlewareContext<TMiddlewares>, TProvidedContext>;
};

export type ServerFnOptions<
  TSchema extends ServerFnSchema | undefined,
  TResult,
  TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
> = {
  input?: TSchema;
  output?: undefined;
  middleware?: TMiddlewares;
  invalidates?: ServerFnInvalidations<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    Awaited<TResult>,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  handler: ServerFnHandler<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    TResult,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
};

export type ServerFnOutputOptions<
  TInputSchema extends ServerFnSchema | undefined,
  TOutputSchema extends ServerFnSchema,
  TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
> = {
  input?: TInputSchema;
  output: TOutputSchema;
  middleware?: TMiddlewares;
  invalidates?: ServerFnInvalidations<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    Awaited<InferServerFnSchemaOutput<TOutputSchema>>,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  handler: ServerFnHandler<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    unknown,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
};

export type ServerFn<TInput, TResult> = ([unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>) & {
  readonly __farmServerFn: true;
  readonly __farmServerFnInput?: unknown;
  readonly __farmServerFnOutput?: unknown;
};

export const FARM_SERVER_FN_SYMBOL = Symbol.for("farm.server-fn");

const UNSAFE_FORM_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function createServerMiddleware<
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
  TProvidedContext extends object = {},
>(
  options: ServerFnMiddlewareOptions<TMiddlewares, TProvidedContext>,
): ServerFnMiddleware<AssignContext<ServerFnMiddlewareContext<TMiddlewares>, TProvidedContext>>;
export function createServerMiddleware(options: {
  middleware?: readonly AnyServerFnMiddleware[];
  handler: ServerFnMiddlewareHandler<any, any>;
}): ServerFnMiddleware<any> {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerMiddleware requires a handler function");
  }

  const middleware = Object.freeze([...(options.middleware ?? [])]);
  for (const entry of middleware) {
    assertServerFnMiddleware(entry);
  }

  return Object.freeze({
    __farmServerFnMiddleware: true as const,
    middleware,
    handler: options.handler,
  });
}

export function createServerFn<
  TInputSchema extends ServerFnSchema,
  TOutputSchema extends ServerFnSchema,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerFnOutputOptions<TInputSchema, TOutputSchema, TMiddlewares>,
): ServerFn<
  InferServerFnSchemaInput<TInputSchema>,
  Awaited<InferServerFnSchemaOutput<TOutputSchema>>
>;
export function createServerFn<
  TOutputSchema extends ServerFnSchema,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerFnOutputOptions<undefined, TOutputSchema, TMiddlewares>,
): ServerFn<unknown, Awaited<InferServerFnSchemaOutput<TOutputSchema>>>;
export function createServerFn<
  TSchema extends ServerFnSchema,
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(
  options: ServerFnOptions<TSchema, TResult, TMiddlewares>,
): ServerFn<InferServerFnSchemaInput<TSchema>, Awaited<TResult>>;
export function createServerFn<
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
>(options: ServerFnOptions<undefined, TResult, TMiddlewares>): ServerFn<unknown, Awaited<TResult>>;
export function createServerFn(options: {
  input?: ServerFnSchema;
  output?: ServerFnSchema;
  middleware?: readonly AnyServerFnMiddleware[];
  invalidates?: ServerFnInvalidations<any, any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ServerFnHandler<any, any, any>;
}) {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerFn requires a handler function");
  }

  const middleware = resolveServerFnMiddleware(options.middleware);
  const serverFn = async (value: unknown) => {
    const formData = isFormData(value) ? value : undefined;
    const rawInput = formData ? formDataToObject(formData) : value;
    const input = await _parseServerFnSchema(options.input, rawInput, "input");
    const executionContext = getServerActionExecutionContext();
    const request = executionContext?.request ?? _resolveCurrentRequest();
    const signal = executionContext?.signal ?? request?.signal ?? getServerActionSignal();
    const handlerContext = {
      input,
      rawInput,
      formData,
      request,
      signal,
    };
    let resolvedContext: Readonly<object> = Object.freeze(Object.create(null));
    const result = await runServerFnMiddleware(middleware, handlerContext, async (context) => {
      resolvedContext = context.context;
      return options.handler(context);
    });
    const parsedResult = await _parseServerFnSchema(options.output, result, "output");

    if (options.invalidates) {
      const declaration =
        typeof options.invalidates === "function"
          ? await options.invalidates({
              ...handlerContext,
              context: resolvedContext,
              result: parsedResult,
            })
          : options.invalidates;
      await applyFarmCacheInvalidationTargets(declaration);
    }

    return parsedResult;
  };

  Object.defineProperties(serverFn, {
    [FARM_SERVER_FN_SYMBOL]: {
      value: true,
      enumerable: false,
    },
    __farmServerFn: {
      value: true,
      enumerable: false,
    },
    __farmServerFnInput: {
      value: options.input,
      enumerable: false,
    },
    __farmServerFnOutput: {
      value: options.output,
      enumerable: false,
    },
    __farmServerFnMiddleware: {
      value: middleware,
      enumerable: false,
    },
    __farmServerFnInvalidates: {
      value: options.invalidates,
      enumerable: false,
    },
  });

  return serverFn as ServerFn<unknown, unknown>;
}

type ServerFnBaseContext = Omit<ServerFnContext<unknown, {}>, "context">;

async function runServerFnMiddleware(
  middleware: readonly AnyServerFnMiddleware[],
  handlerContext: ServerFnBaseContext,
  handler: ServerFnHandler<any, any, any>,
) {
  const dispatch = async (index: number, context: Readonly<object>): Promise<unknown> => {
    const current = middleware[index];
    if (!current) {
      return handler({ ...handlerContext, context });
    }

    let nextCalled = false;
    const result = await current.handler({
      ...handlerContext,
      context,
      next: async (nextOptions) => {
        if (nextCalled) {
          throw new Error("Server function middleware next() can only be called once");
        }
        nextCalled = true;

        return dispatch(index + 1, mergeServerFnContext(context, nextOptions?.context)) as Promise<
          ServerFnMiddlewareContinuation<any>
        >;
      },
    });

    if (!nextCalled) {
      throw new Error("Server function middleware must call next()");
    }

    return result;
  };

  return dispatch(0, Object.freeze(Object.create(null)));
}

function resolveServerFnMiddleware(
  middleware: readonly AnyServerFnMiddleware[] | undefined,
): readonly AnyServerFnMiddleware[] {
  const resolved: AnyServerFnMiddleware[] = [];
  const seen = new Set<AnyServerFnMiddleware>();
  const visiting = new Set<AnyServerFnMiddleware>();

  const visit = (entry: AnyServerFnMiddleware) => {
    assertServerFnMiddleware(entry);
    if (seen.has(entry)) return;
    if (visiting.has(entry)) {
      throw new Error("Server function middleware dependencies cannot contain a cycle");
    }

    visiting.add(entry);
    for (const dependency of entry.middleware) {
      visit(dependency);
    }
    visiting.delete(entry);
    seen.add(entry);
    resolved.push(entry);
  };

  for (const entry of middleware ?? []) {
    visit(entry);
  }

  return Object.freeze(resolved);
}

function assertServerFnMiddleware(value: unknown): asserts value is AnyServerFnMiddleware {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { __farmServerFnMiddleware?: unknown }).__farmServerFnMiddleware !== true ||
    typeof (value as { handler?: unknown }).handler !== "function" ||
    !Array.isArray((value as { middleware?: unknown }).middleware)
  ) {
    throw new TypeError("createServerFn middleware must be created with createServerMiddleware");
  }
}

function mergeServerFnContext(current: Readonly<object>, added: object | undefined) {
  if (
    added !== undefined &&
    (added === null || typeof added !== "object" || Array.isArray(added))
  ) {
    throw new TypeError("Server function middleware context must be an object");
  }

  return Object.freeze(Object.assign(Object.create(null), current, added));
}

export async function _parseServerFnSchema(
  schema: ServerFnSchema | undefined,
  value: unknown,
  contract: "input" | "output",
  owner = "createServerFn",
) {
  if (!schema) return value;

  if (typeof schema.safeParseAsync === "function") {
    const result = await schema.safeParseAsync(value);
    return unwrapSafeParseResult(result);
  }

  if (typeof schema.safeParse === "function") {
    const result = schema.safeParse(value);
    return unwrapSafeParseResult(await result);
  }

  if (typeof schema.parseAsync === "function") {
    return schema.parseAsync(value);
  }

  if (typeof schema.parse === "function") {
    return schema.parse(value);
  }

  throw new TypeError(`${owner} ${contract} must provide parse, parseAsync, or safeParse`);
}

function unwrapSafeParseResult(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success: boolean }).success === false
  ) {
    throw (result as { error?: unknown }).error;
  }

  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success: boolean }).success === true
  ) {
    return (result as unknown as { data: unknown }).data;
  }

  return result;
}

function formDataToObject(formData: FormData) {
  const output: Record<string, FormDataEntryValue | FormDataEntryValue[]> = Object.create(null);

  for (const [key, value] of formData.entries()) {
    if (!isSafeFormKey(key)) continue;

    const existing = output[key];
    if (existing === undefined) {
      output[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      output[key] = [existing, value];
    }
  }

  return output;
}

function isSafeFormKey(key: string) {
  return !key.startsWith("$ACTION_") && !UNSAFE_FORM_KEYS.has(key);
}

function isFormData(value: unknown): value is FormData {
  if (!value || typeof value !== "object") return false;

  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return true;
  }

  return (
    Object.prototype.toString.call(value) === "[object FormData]" &&
    typeof (value as { entries?: unknown }).entries === "function"
  );
}
