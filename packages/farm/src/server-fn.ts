import { getServerActionExecutionContext, getServerActionSignal } from "./server-action-security";

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

export type ServerFnContext<TInput> = {
  input: TInput;
  rawInput: unknown;
  formData?: FormData;
  /** The action request when invoked across the network. Undefined for direct server calls. */
  request?: Request;
  /** Aborts when the underlying action request is cancelled. */
  signal: AbortSignal;
};

export type ServerFnHandler<TInput, TResult> = (
  ctx: ServerFnContext<TInput>,
) => MaybePromise<TResult>;

export type ServerFnOptions<TSchema extends ServerFnSchema | undefined, TResult> = {
  input?: TSchema;
  output?: undefined;
  handler: ServerFnHandler<
    TSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TSchema> : unknown,
    TResult
  >;
};

export type ServerFnOutputOptions<
  TInputSchema extends ServerFnSchema | undefined,
  TOutputSchema extends ServerFnSchema,
> = {
  input?: TInputSchema;
  output: TOutputSchema;
  handler: ServerFnHandler<
    TInputSchema extends ServerFnSchema ? InferServerFnSchemaOutput<TInputSchema> : unknown,
    unknown
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

export function createServerFn<
  TInputSchema extends ServerFnSchema,
  TOutputSchema extends ServerFnSchema,
>(
  options: ServerFnOutputOptions<TInputSchema, TOutputSchema>,
): ServerFn<
  InferServerFnSchemaInput<TInputSchema>,
  Awaited<InferServerFnSchemaOutput<TOutputSchema>>
>;
export function createServerFn<TOutputSchema extends ServerFnSchema>(
  options: ServerFnOutputOptions<undefined, TOutputSchema>,
): ServerFn<unknown, Awaited<InferServerFnSchemaOutput<TOutputSchema>>>;
export function createServerFn<TSchema extends ServerFnSchema, TResult>(
  options: ServerFnOptions<TSchema, TResult>,
): ServerFn<InferServerFnSchemaInput<TSchema>, Awaited<TResult>>;
export function createServerFn<TResult>(
  options: ServerFnOptions<undefined, TResult>,
): ServerFn<unknown, Awaited<TResult>>;
export function createServerFn(options: {
  input?: ServerFnSchema;
  output?: ServerFnSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: ServerFnHandler<any, any>;
}) {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerFn requires a handler function");
  }

  const serverFn = async (value: unknown) => {
    const formData = isFormData(value) ? value : undefined;
    const rawInput = formData ? formDataToObject(formData) : value;
    const input = await parseSchema(options.input, rawInput, "input");
    const executionContext = getServerActionExecutionContext();

    const result = await options.handler({
      input,
      rawInput,
      formData,
      request: executionContext?.request,
      signal: getServerActionSignal(),
    });

    return parseSchema(options.output, result, "output");
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
  });

  return serverFn as ServerFn<unknown, unknown>;
}

async function parseSchema(
  schema: ServerFnSchema | undefined,
  value: unknown,
  contract: "input" | "output",
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

  throw new TypeError(`createServerFn ${contract} must provide parse, parseAsync, or safeParse`);
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
