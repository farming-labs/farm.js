import {
  getServerActionExecutionContext,
  getServerActionSignal,
  runWithServerActionRequest,
} from "./server-action-security";
import { _resolveCurrentRequestForApp } from "./server/request-bridge";
import { applyFarmCacheInvalidationTargets, type FarmCacheInvalidationTarget } from "./cache";
import { ServerActionError, ServerFnFailure, isServerFnFailure } from "./server-fn-error";
import { getFarmRedirectError } from "./navigation-errors";
import type { EndpointMCPMetadata } from "./api/endpoint";

export {
  FARM_SERVER_FN_FAILURE_SYMBOL,
  ServerActionError,
  ServerFnFailure,
  createServerFnTransportError,
  isServerFnFailure,
} from "./server-fn-error";
export type { SerializedServerFnFailure } from "./server-fn-error";

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

export type ServerFnErrorSchema = ServerFnSchema &
  ({ parse: (data: unknown) => unknown } | { safeParse: (data: unknown) => unknown });

export type ServerFnErrorDefinition<
  TSchema extends ServerFnErrorSchema = ServerFnErrorSchema,
  TStatus extends number = number,
> = {
  status: TStatus;
  /** Schema for the public error payload exposed to callers. */
  data: TSchema;
  /** Public message safe to expose to callers. */
  message?: string;
};

export type ServerFnErrorDefinitions = Record<
  string,
  ServerFnErrorDefinition<ServerFnErrorSchema, number>
>;

export type ServerFnDeclaredError<TErrors extends ServerFnErrorDefinitions> = {
  [TCode in keyof TErrors]: ServerFnFailure<
    TCode & string,
    InferServerFnSchemaOutput<TErrors[TCode]["data"]>,
    TErrors[TCode]["status"]
  >;
}[keyof TErrors];

export type ServerFnError<TErrors extends ServerFnErrorDefinitions> = keyof TErrors extends never
  ? Error
  : ServerActionError | ServerFnDeclaredError<TErrors>;

export type ServerFnErrorHandler<TErrors extends ServerFnErrorDefinitions> = <
  TCode extends keyof TErrors & string,
>(
  code: TCode,
  data: InferServerFnSchemaInput<TErrors[TCode]["data"]>,
) => never;

export type ServerFnFormInput = FormData;

/** MCP tool metadata for a server function or query. Server functions have no path to derive a name from. */
export type ServerFnMCPMetadata = EndpointMCPMetadata & { name: string };

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

export type ServerFnHandlerContext<
  TInput,
  TContext extends object = {},
  TErrors extends ServerFnErrorDefinitions = {},
> = ServerFnContext<TInput, TContext> & {
  /** Return a declared, validated error from this server function. */
  error: ServerFnErrorHandler<TErrors>;
};

export type ServerFnHandler<
  TInput,
  TResult,
  TContext extends object = {},
  TErrors extends ServerFnErrorDefinitions = {},
> = (ctx: ServerFnHandlerContext<TInput, TContext, TErrors>) => MaybePromise<TResult>;

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
  TErrors extends ServerFnErrorDefinitions = {},
> = {
  input?: TSchema;
  output?: undefined;
  middleware?: TMiddlewares;
  errors?: TErrors;
  /** Expose this function as an MCP tool when it is listed in `mcp.tools`. `name` is required. */
  mcp?: ServerFnMCPMetadata;
  invalidates?: ServerFnInvalidations<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    Awaited<TResult>,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  handler: ServerFnHandler<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    TResult,
    ServerFnMiddlewareContext<TMiddlewares>,
    TErrors
  >;
};

export type ServerFnOutputOptions<
  TInputSchema extends ServerFnSchema | undefined,
  TOutputSchema extends ServerFnSchema,
  TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
  TErrors extends ServerFnErrorDefinitions = {},
> = {
  input?: TInputSchema;
  output: TOutputSchema;
  middleware?: TMiddlewares;
  errors?: TErrors;
  /** Expose this function as an MCP tool when it is listed in `mcp.tools`. `name` is required. */
  mcp?: ServerFnMCPMetadata;
  invalidates?: ServerFnInvalidations<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    Awaited<InferServerFnSchemaOutput<TOutputSchema>>,
    ServerFnMiddlewareContext<TMiddlewares>
  >;
  handler: ServerFnHandler<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    unknown,
    ServerFnMiddlewareContext<TMiddlewares>,
    TErrors
  >;
};

export type ServerFn<TInput, TResult, TError extends Error = Error> = ([unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>) & {
  readonly __farmServerFn: true;
  readonly __farmServerFnInput?: unknown;
  readonly __farmServerFnOutput?: unknown;
  readonly __farmServerFnError: TError;
};

export type InferServerFnError<TServerFn> =
  TServerFn extends ServerFn<any, any, infer TError> ? TError : Error;

export const FARM_SERVER_FN_SYMBOL = Symbol.for("farm.server-fn");

const FARM_SERVER_FUNCTION_DESCRIPTOR = Symbol.for("farm.server-function.descriptor");

/** @internal What a non-browser caller, such as an MCP tool, needs to know about a server function. */
export interface ServerFunctionDescriptor {
  /** Queries only read data; actions may change it. */
  readonly kind: "action" | "query";
  readonly input: ServerFnSchema | undefined;
  readonly output: ServerFnSchema | undefined;
  readonly mcp: Readonly<ServerFnMCPMetadata> | undefined;
}

interface ServerFunctionRunner extends ServerFunctionDescriptor {
  /** Runs the full pipeline and labels input validation failures with ServerFnInputError. */
  readonly run: (input: unknown) => Promise<unknown>;
}

/** Raised by the internal runner when the caller's input fails the function's input schema. */
class ServerFnInputError extends Error {
  constructor(readonly cause: unknown) {
    super("Server function input is invalid");
  }
}

/** @internal Shared by createServerFn and createServerQuery. */
export function createServerFunctionDescriptor(
  kind: ServerFunctionDescriptor["kind"],
  options: { input?: ServerFnSchema; output?: ServerFnSchema; mcp?: ServerFnMCPMetadata },
  run: ServerFunctionRunner["run"],
): ServerFunctionRunner {
  return Object.freeze({
    kind,
    input: options.input,
    output: options.output,
    mcp: options.mcp === undefined ? undefined : Object.freeze({ ...options.mcp }),
    run,
  });
}

/** @internal Attaches the descriptor that `_describeServerFunction` reads. */
export function _attachServerFunctionDescriptor(target: object, descriptor: ServerFunctionRunner) {
  Object.defineProperty(target, FARM_SERVER_FUNCTION_DESCRIPTOR, {
    value: descriptor,
    enumerable: false,
  });
}

function getServerFunctionRunner(value: unknown): ServerFunctionRunner | undefined {
  if (typeof value !== "function") return undefined;
  return (value as { [FARM_SERVER_FUNCTION_DESCRIPTOR]?: ServerFunctionRunner })[
    FARM_SERVER_FUNCTION_DESCRIPTOR
  ];
}

/** @internal Runs a server function's pipeline with input failures labelled, for createServerQuery. */
export function _runServerFunctionForCaller(value: unknown, input: unknown): Promise<unknown> {
  const runner = getServerFunctionRunner(value);
  if (!runner) throw new TypeError("Expected a function created with createServerFn");
  return runner.run(input);
}

/**
 * @internal Describes a createServerFn or createServerQuery function, or returns undefined for
 * anything else. Exposes schemas and metadata, never the handler.
 */
export function _describeServerFunction(value: unknown): ServerFunctionDescriptor | undefined {
  const runner = getServerFunctionRunner(value);
  if (!runner) return undefined;
  const { kind, input, output, mcp } = runner;
  return Object.freeze({ kind, input, output, mcp });
}

/** @internal How a server function call ended, for callers that are not the browser action transport. */
export type ServerFunctionInvocation =
  | { readonly ok: true; readonly data: unknown }
  /** The caller's input failed the input schema. The validator's error describes the caller's own data. */
  | { readonly ok: false; readonly reason: "input"; readonly error: unknown }
  /** A failure declared in `errors`, public by design. */
  | { readonly ok: false; readonly reason: "failure"; readonly failure: ServerFnFailure }
  | {
      readonly ok: false;
      readonly reason: "redirect";
      readonly url: string;
      readonly status: number;
    }
  /** Anything else. Can contain private data, so callers must not expose it. */
  | { readonly ok: false; readonly reason: "error"; readonly error: unknown };

/**
 * @internal Runs a server function or query on behalf of a non-browser caller, such as an MCP
 * tool call. Runs the same pipeline as a browser action (input schema, middleware, handler,
 * output schema, invalidations) with `request` as the action request, so middleware reads the
 * caller's headers. A query resolves to its data rather than the client cache envelope.
 */
export async function _invokeServerFunction(
  value: unknown,
  input: unknown,
  request: Request,
): Promise<ServerFunctionInvocation> {
  const runner = getServerFunctionRunner(value);
  if (!runner) {
    throw new TypeError("Expected a function created with createServerFn or createServerQuery");
  }
  try {
    const data = await runWithServerActionRequest(request, () => runner.run(input));
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ServerFnInputError) {
      return { ok: false, reason: "input", error: error.cause };
    }
    if (isServerFnFailure(error)) return { ok: false, reason: "failure", failure: error };
    const redirect = getFarmRedirectError(error);
    if (redirect) {
      return { ok: false, reason: "redirect", url: redirect.url, status: redirect.status };
    }
    return { ok: false, reason: "error", error };
  }
}

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
  const TErrors extends ServerFnErrorDefinitions = {},
>(
  options: ServerFnOutputOptions<TInputSchema, TOutputSchema, TMiddlewares, TErrors>,
): ServerFn<
  InferServerFnSchemaInput<TInputSchema>,
  Awaited<InferServerFnSchemaOutput<TOutputSchema>>,
  ServerFnError<TErrors>
>;
export function createServerFn<
  TOutputSchema extends ServerFnSchema,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
  const TErrors extends ServerFnErrorDefinitions = {},
>(
  options: ServerFnOutputOptions<undefined, TOutputSchema, TMiddlewares, TErrors>,
): ServerFn<unknown, Awaited<InferServerFnSchemaOutput<TOutputSchema>>, ServerFnError<TErrors>>;
export function createServerFn<
  TSchema extends ServerFnSchema,
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
  const TErrors extends ServerFnErrorDefinitions = {},
>(
  options: ServerFnOptions<TSchema, TResult, TMiddlewares, TErrors>,
): ServerFn<InferServerFnSchemaInput<TSchema>, Awaited<TResult>, ServerFnError<TErrors>>;
export function createServerFn<
  TResult,
  const TMiddlewares extends readonly AnyServerFnMiddleware[] = readonly [],
  const TErrors extends ServerFnErrorDefinitions = {},
>(
  options: ServerFnOptions<undefined, TResult, TMiddlewares, TErrors>,
): ServerFn<unknown, Awaited<TResult>, ServerFnError<TErrors>>;
export function createServerFn(options: {
  input?: ServerFnSchema;
  output?: ServerFnSchema;
  middleware?: readonly AnyServerFnMiddleware[];
  errors?: ServerFnErrorDefinitions;
  invalidates?: ServerFnInvalidations<any, any, any>;
  mcp?: ServerFnMCPMetadata;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ServerFnHandler<any, any, any, any>;
}) {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerFn requires a handler function");
  }

  const middleware = resolveServerFnMiddleware(options.middleware);
  const errors = normalizeServerFnErrors(options.errors);
  const error = createServerFnErrorHandler(errors);
  const run = async (value: unknown, labelInputErrors: boolean) => {
    const formData = isFormData(value) ? value : undefined;
    const rawInput = formData ? formDataToObject(formData) : value;
    let input: unknown;
    try {
      input = await _parseServerFnSchema(options.input, rawInput, "input");
    } catch (cause) {
      // Only a validation result describes the caller's input. Anything else thrown while
      // parsing, such as an exception inside a refinement or transform, is an application error.
      throw labelInputErrors && isSchemaValidationFailure(cause)
        ? new ServerFnInputError(cause)
        : cause;
    }
    const executionContext = getServerActionExecutionContext();
    const request = executionContext?.request ?? _resolveCurrentRequestForApp();
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
      return options.handler({ ...context, error });
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
  const serverFn = (value: unknown) => run(value, false);

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
    __farmServerFnError: {
      value: undefined,
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

  _attachServerFunctionDescriptor(
    serverFn,
    createServerFunctionDescriptor("action", options, (value) => run(value, true)),
  );

  return serverFn as ServerFn<unknown, unknown, Error>;
}

type ServerFnBaseContext = Omit<ServerFnContext<unknown, {}>, "context">;

async function runServerFnMiddleware(
  middleware: readonly AnyServerFnMiddleware[],
  handlerContext: ServerFnBaseContext,
  handler: (context: ServerFnContext<any, any>) => MaybePromise<unknown>,
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

function normalizeServerFnErrors(
  definitions: ServerFnErrorDefinitions | undefined,
): Readonly<ServerFnErrorDefinitions> {
  if (definitions === undefined) return Object.freeze({});
  if (!isPlainServerFnObject(definitions)) {
    throw new TypeError("createServerFn errors must be an object");
  }

  const normalized: ServerFnErrorDefinitions = Object.create(null);
  for (const [code, definition] of Object.entries(definitions)) {
    if (!code.trim()) {
      throw new TypeError("Server function error codes cannot be empty");
    }
    if (!definition || typeof definition !== "object") {
      throw new TypeError(`Server function error "${code}" must be an object`);
    }
    if (
      !Number.isInteger(definition.status) ||
      definition.status < 400 ||
      definition.status > 599
    ) {
      throw new TypeError(
        `Server function error "${code}" status must be an integer between 400 and 599`,
      );
    }
    if (
      !definition.data ||
      (typeof definition.data.parse !== "function" &&
        typeof definition.data.safeParse !== "function")
    ) {
      throw new TypeError(
        `Server function error "${code}" data must provide synchronous parse() or safeParse()`,
      );
    }
    if (definition.message !== undefined && typeof definition.message !== "string") {
      throw new TypeError(`Server function error "${code}" message must be a string`);
    }

    normalized[code] = Object.freeze({ ...definition });
  }

  return Object.freeze(normalized);
}

function createServerFnErrorHandler(
  definitions: Readonly<ServerFnErrorDefinitions>,
): ServerFnErrorHandler<ServerFnErrorDefinitions> {
  return ((code: string, data: unknown): never => {
    const definition = definitions[code];
    if (!definition) {
      throw new TypeError(`Server function error "${code}" is not declared`);
    }

    const parsed = parseServerFnFailureData(code, definition.data, data);
    throw new ServerFnFailure(code, parsed, {
      status: definition.status,
      message: definition.message ?? "Server function failed",
    });
  }) as ServerFnErrorHandler<ServerFnErrorDefinitions>;
}

function parseServerFnFailureData(code: string, schema: ServerFnSchema, value: unknown) {
  if (typeof schema.safeParse === "function") {
    const result = schema.safeParse(value);
    if (isPromiseLike(result)) {
      throw new TypeError(`Server function error "${code}" data schema must parse synchronously`);
    }
    return unwrapSafeParseResult(result);
  }

  const result = schema.parse!(value);
  if (isPromiseLike(result)) {
    throw new TypeError(`Server function error "${code}" data schema must parse synchronously`);
  }
  return result;
}

function isPlainServerFnObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof (value as PromiseLike<unknown>).then === "function",
  );
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

// Errors a safeParse result reported as a validation failure, as opposed to exceptions it threw.
const schemaValidationFailures = new WeakSet<object>();

function isSchemaValidationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (
    schemaValidationFailures.has(error) || Array.isArray((error as { issues?: unknown }).issues)
  );
}

function unwrapSafeParseResult(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success: boolean }).success === false
  ) {
    const error = (result as { error?: unknown }).error;
    if (error && typeof error === "object") schemaValidationFailures.add(error);
    throw error;
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
