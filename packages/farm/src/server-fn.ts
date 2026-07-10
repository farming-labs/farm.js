type MaybePromise<T> = T | Promise<T>;

// Generic schema type that works with Zod v3/v4 and similar validator APIs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = {
  _input?: any;
  _output?: any;
  parse?: (data: unknown) => any;
  parseAsync?: (data: unknown) => Promise<any>;
  safeParse?: (data: unknown) => any;
  safeParseAsync?: (data: unknown) => Promise<any>;
};

type InferInput<T> = T extends { _input: infer I } ? I : unknown;
type InferOutput<T> = T extends { _output: infer O }
  ? O
  : T extends { parse: (data: unknown) => infer R }
    ? R
    : unknown;

export type ServerFnFormInput = FormData;

export type ServerFnContext<TInput> = {
  input: TInput;
  rawInput: unknown;
  formData?: FormData;
};

export type ServerFnHandler<TInput, TResult> = (
  ctx: ServerFnContext<TInput>,
) => MaybePromise<TResult>;

export type ServerFnOptions<TSchema extends AnySchema | undefined, TResult> = {
  input?: TSchema;
  handler: ServerFnHandler<TSchema extends AnySchema ? InferOutput<TSchema> : unknown, TResult>;
};

export type ServerFn<TInput, TResult> = ([unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>) & {
  readonly __farmServerFn: true;
  readonly __farmServerFnInput?: unknown;
};

export const FARM_SERVER_FN_SYMBOL = Symbol.for("farm.server-fn");

const UNSAFE_FORM_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function createServerFn<TSchema extends AnySchema, TResult>(
  options: ServerFnOptions<TSchema, TResult>,
): ServerFn<InferInput<TSchema>, Awaited<TResult>>;
export function createServerFn<TResult>(
  options: ServerFnOptions<undefined, TResult>,
): ServerFn<unknown, Awaited<TResult>>;
export function createServerFn(options: ServerFnOptions<AnySchema | undefined, unknown>) {
  if (!options || typeof options.handler !== "function") {
    throw new TypeError("createServerFn requires a handler function");
  }

  const serverFn = async (value: unknown) => {
    const formData = isFormData(value) ? value : undefined;
    const rawInput = formData ? formDataToObject(formData) : value;
    const input = await parseInput(options.input, rawInput);

    return options.handler({
      input,
      rawInput,
      formData,
    });
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
  });

  return serverFn as ServerFn<unknown, unknown>;
}

async function parseInput(schema: AnySchema | undefined, rawInput: unknown) {
  if (!schema) return rawInput;

  if (typeof schema.safeParseAsync === "function") {
    const result = await schema.safeParseAsync(rawInput);
    return unwrapSafeParseResult(result);
  }

  if (typeof schema.safeParse === "function") {
    const result = schema.safeParse(rawInput);
    return unwrapSafeParseResult(await result);
  }

  if (typeof schema.parseAsync === "function") {
    return schema.parseAsync(rawInput);
  }

  if (typeof schema.parse === "function") {
    return schema.parse(rawInput);
  }

  throw new TypeError("createServerFn input must provide parse, parseAsync, or safeParse");
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
