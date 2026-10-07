/**
 * Typed, validated plugin options.
 *
 * A plugin factory takes one options object. Describing it with a Standard
 * Schema (Zod, Valibot, ArkType, ...) gives the call site its input type for
 * autocomplete, gives the plugin the parsed type with defaults applied, and
 * rejects bad options while the config loads instead of deep inside a hook.
 */

type MaybePromise<T> = T | Promise<T>;

type FarmPluginOptionsIssuePathSegment = PropertyKey | { readonly key: PropertyKey };

export interface FarmPluginOptionsIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<FarmPluginOptionsIssuePathSegment> | undefined;
}

type FarmPluginOptionsResult<TOutput> =
  | { readonly value: TOutput; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<FarmPluginOptionsIssue> };

/** The part of the Standard Schema interface plugin options need. */
export interface FarmPluginOptionsSchema<TInput = unknown, TOutput = TInput> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => MaybePromise<FarmPluginOptionsResult<TOutput>>;
    readonly types?: { readonly input: TInput; readonly output: TOutput } | undefined;
  };
}

/** What the app passes to the plugin factory. */
export type InferPluginOptionsInput<TSchema> =
  TSchema extends FarmPluginOptionsSchema<infer TInput, any> ? TInput : never;

/** What the plugin receives, after parsing and defaults. */
export type InferPluginOptionsOutput<TSchema> =
  TSchema extends FarmPluginOptionsSchema<any, infer TOutput> ? TOutput : never;

/**
 * The factory a plugin exports. Options can be left out when every option is
 * optional, so `plugin()` and `plugin({})` mean the same thing.
 */
export type FarmPluginFactory<TInput, TPlugin> = {} extends TInput
  ? (options?: TInput) => TPlugin
  : (options: TInput) => TPlugin;

/** Thrown when an app passes options its plugin's schema rejects. */
export class FarmPluginOptionsError extends TypeError {
  readonly issues: ReadonlyArray<FarmPluginOptionsIssue>;

  constructor(issues: ReadonlyArray<FarmPluginOptionsIssue>) {
    const lines = issues.map((issue) => {
      const path = formatIssuePath(issue.path);
      return `  - ${path ? `${path}: ` : ""}${issue.message}`;
    });
    super(`Invalid plugin options:\n${lines.join("\n")}`);
    this.name = "FarmPluginOptionsError";
    this.issues = issues;
  }
}

function formatIssuePath(path: FarmPluginOptionsIssue["path"]): string {
  if (!path?.length) return "";
  return path
    .map((segment) => {
      const key = typeof segment === "object" && segment !== null ? segment.key : segment;
      return typeof key === "symbol" ? key.toString() : String(key);
    })
    .join(".");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/** True for a Standard Schema: an object exposing `~standard.validate`. */
export function isPluginOptionsSchema(value: unknown): value is FarmPluginOptionsSchema {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const standard = (value as { "~standard"?: { validate?: unknown } })["~standard"];
  return typeof standard?.validate === "function";
}

/**
 * Validate options against their schema. Plugins are created while the config
 * loads, which is synchronous, so an asynchronous schema is rejected rather
 * than silently skipped. Missing options are validated as `{}`.
 */
export function parsePluginOptions<TSchema extends FarmPluginOptionsSchema<any, any>>(
  schema: TSchema,
  options: unknown,
): InferPluginOptionsOutput<TSchema> {
  const standard = schema?.["~standard"];
  if (!standard || typeof standard.validate !== "function") {
    throw new TypeError(
      "A plugin's `options` needs a Standard Schema, such as a Zod, Valibot, or ArkType schema.",
    );
  }

  const result = standard.validate(options === undefined ? {} : options);
  if (isPromiseLike(result)) {
    throw new TypeError(
      "Plugin option schemas must validate synchronously: plugins are created while the config loads. Remove asynchronous refinements or transforms from the schema.",
    );
  }
  if (result.issues) throw new FarmPluginOptionsError(result.issues);
  return result.value as InferPluginOptionsOutput<TSchema>;
}
