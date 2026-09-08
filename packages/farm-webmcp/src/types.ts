export type MaybePromise<T> = T | Promise<T>;

export type WebMCPJSONPrimitive = boolean | number | string | null;
export type WebMCPJSONValue =
  | WebMCPJSONPrimitive
  | WebMCPJSONValue[]
  | { [key: string]: WebMCPJSONValue };

/** A JSON Schema object sent to the browser agent with a tool definition. */
export type WebMCPInputSchema = Readonly<Record<string, unknown>>;

export interface WebMCPToolAnnotations {
  /** The tool does not change application or external state. */
  readOnlyHint?: boolean;
  /** A tool result can contain content supplied by an untrusted party. */
  untrustedContentHint?: boolean;
  /** The tool can perform a significant or difficult-to-reverse action. */
  consequentialHint?: boolean;
}

export interface WebMCPToolExecutionContext {
  /** Aborted when the browser agent cancels this invocation. */
  signal: AbortSignal;
}

export interface WebMCPSafeParseSuccess<T> {
  success: true;
  data: T;
}

export interface WebMCPSafeParseFailure {
  success: false;
  error: unknown;
}

export type WebMCPSafeParseResult<T> = WebMCPSafeParseSuccess<T> | WebMCPSafeParseFailure;

/** Structural subset of Standard Schema used by Zod, Valibot, ArkType, and others. */
export interface WebMCPStandardSchema<TOutput = unknown> {
  readonly "~standard": {
    readonly version: number;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => MaybePromise<
      | { readonly value: TOutput; readonly issues?: undefined }
      | { readonly issues: readonly unknown[] }
    >;
    readonly types?: {
      readonly input: unknown;
      readonly output: TOutput;
    };
  };
}

export type WebMCPValidator<TOutput = unknown> =
  | WebMCPStandardSchema<TOutput>
  | { safeParseAsync(value: unknown): MaybePromise<WebMCPSafeParseResult<TOutput>> }
  | { safeParse(value: unknown): WebMCPSafeParseResult<TOutput> }
  | { parseAsync(value: unknown): MaybePromise<TOutput> }
  | { parse(value: unknown): TOutput }
  | ((value: unknown) => MaybePromise<TOutput>);

type StandardSchemaOutput<TValidator> = TValidator extends {
  readonly "~standard": { readonly types?: infer TTypes };
}
  ? NonNullable<TTypes> extends { readonly output: infer TOutput }
    ? TOutput
    : never
  : never;

/** Infer the value returned by a supported validation schema. */
export type InferWebMCPValidatorOutput<TValidator> = [StandardSchemaOutput<TValidator>] extends [
  never,
]
  ? TValidator extends { readonly _output: infer TOutput }
    ? TOutput
    : TValidator extends { parseAsync(value: unknown): MaybePromise<infer TOutput> }
      ? TOutput
      : TValidator extends { parse(value: unknown): infer TOutput }
        ? TOutput
        : TValidator extends {
              safeParseAsync(value: unknown): MaybePromise<WebMCPSafeParseResult<infer TOutput>>;
            }
          ? TOutput
          : TValidator extends {
                safeParse(value: unknown): WebMCPSafeParseResult<infer TOutput>;
              }
            ? TOutput
            : TValidator extends (value: unknown) => MaybePromise<infer TOutput>
              ? TOutput
              : unknown
  : StandardSchemaOutput<TValidator>;

export interface WebMCPToolDefinition<
  TInput extends object = Record<string, unknown>,
  TResult = WebMCPJSONValue,
> {
  /** Stable agent-facing name. Uses ASCII letters, digits, `_`, `-`, and `.`. */
  name: string;
  /** Optional human-readable label for browser UI. */
  title?: string;
  /** Explain what the tool does and when an agent should use it. */
  description: string;
  /** JSON Schema describing the input object presented to the agent. */
  inputSchema: WebMCPInputSchema;
  /** Optional runtime validation. This does not replace server authorization. */
  validate?: WebMCPValidator<TInput>;
  annotations?: WebMCPToolAnnotations;
  /** The runtime rejects results that are not JSON-safe. */
  execute(input: TInput, context: WebMCPToolExecutionContext): MaybePromise<TResult>;
}

export interface WebMCPToolMetadata {
  name: string;
  title?: string;
  description: string;
  inputSchema: WebMCPInputSchema;
  annotations?: Readonly<WebMCPToolAnnotations>;
}

export interface FarmWebMCPRuntime {
  /** Whether this document provides the current WebMCP API. */
  readonly supported: boolean;
  /** Current explicitly registered Farm tools, with execution functions omitted. */
  getTools(): readonly WebMCPToolMetadata[];
  /** Reconcile Farm's tool registry with `document.modelContext`. */
  sync(): Promise<void>;
  /** Unregister native tools and stop observing Farm registrations. */
  close(): void;
}
