"use client";

import type {
  FarmWebMCPRuntime,
  InferWebMCPValidatorOutput,
  WebMCPInputSchema,
  WebMCPJSONValue,
  WebMCPSafeParseResult,
  WebMCPStandardSchema,
  WebMCPToolAnnotations,
  WebMCPToolDefinition,
  WebMCPToolMetadata,
  WebMCPValidator,
} from "./types.js";

export type {
  FarmWebMCPRuntime,
  InferWebMCPValidatorOutput,
  WebMCPInputSchema,
  WebMCPJSONPrimitive,
  WebMCPJSONValue,
  WebMCPSafeParseFailure,
  WebMCPSafeParseResult,
  WebMCPSafeParseSuccess,
  WebMCPStandardSchema,
  WebMCPToolAnnotations,
  WebMCPToolDefinition,
  WebMCPToolExecutionContext,
  WebMCPToolMetadata,
  WebMCPValidator,
} from "./types.js";

export type WebMCPUnsupportedBehavior = "ignore" | "warn" | "error";

export interface StartWebMCPRuntimeOptions {
  unsupported?: WebMCPUnsupportedBehavior;
  /** Expose `window.__FARM_WEBMCP__` and log registration failures. */
  debug?: boolean;
}

interface NativeWebMCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: WebMCPInputSchema;
  annotations?: Readonly<WebMCPToolAnnotations>;
  execute(
    input: object,
    options: { signal: AbortSignal },
  ): WebMCPJSONValue | Promise<WebMCPJSONValue>;
}

interface ModelContextLike {
  registerTool(
    tool: NativeWebMCPTool,
    options?: { signal?: AbortSignal },
  ): Promise<undefined> | undefined;
}

interface DocumentWithModelContext extends Document {
  readonly modelContext?: ModelContextLike;
}

interface RegisteredFarmTool {
  id: number;
  tool: WebMCPToolDefinition<object, WebMCPJSONValue>;
}

interface ActiveNativeTool {
  id: number;
  controller: AbortController;
}

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const registrations = new Map<number, RegisteredFarmTool>();
const registryListeners = new Set<() => void>();
let nextRegistrationId = 1;
let activeRuntime: FarmWebMCPRuntime | undefined;

declare global {
  interface Window {
    /** Development inspector enabled by `webmcp({ debug: true })`. */
    __FARM_WEBMCP__?: FarmWebMCPRuntime;
  }
}

/** An actionable validation failure returned to the invoking browser agent. */
export class WebMCPInputError extends TypeError {
  readonly toolName: string;
  readonly issues: unknown;

  constructor(toolName: string, issues: unknown) {
    super(`Invalid input for WebMCP tool "${toolName}": ${formatIssues(issues)}`);
    this.name = "WebMCPInputError";
    this.toolName = toolName;
    this.issues = issues;
  }
}

export function defineWebMCPTool<TValidator extends WebMCPValidator, TResult = WebMCPJSONValue>(
  definition: Omit<
    WebMCPToolDefinition<Extract<InferWebMCPValidatorOutput<TValidator>, object>, TResult>,
    "validate"
  > & { validate: TValidator },
): WebMCPToolDefinition<Extract<InferWebMCPValidatorOutput<TValidator>, object>, TResult>;
export function defineWebMCPTool<
  TInput extends object = Record<string, unknown>,
  TResult = WebMCPJSONValue,
>(definition: WebMCPToolDefinition<TInput, TResult>): WebMCPToolDefinition<TInput, TResult>;
export function defineWebMCPTool(
  definition: WebMCPToolDefinition<object, WebMCPJSONValue>,
): WebMCPToolDefinition<object, WebMCPJSONValue> {
  return normalizeToolDefinition(definition);
}

/**
 * Make one explicit tool available to the active WebMCP runtime.
 * Call the returned function when the tool is no longer valid for the page.
 */
export function registerWebMCPTool<TInput extends object, TResult>(
  definition: WebMCPToolDefinition<TInput, TResult>,
): () => void {
  const normalized = normalizeToolDefinition(
    definition as WebMCPToolDefinition<object, WebMCPJSONValue>,
  );
  return registerNormalizedTool(normalized);
}

/** Validate and register several tools, then return one cleanup function. */
export function registerWebMCPTools(
  definitions: readonly WebMCPToolDefinition<any, any>[],
): () => void {
  const normalized = definitions.map((definition) =>
    normalizeToolDefinition(definition as WebMCPToolDefinition<object, WebMCPJSONValue>),
  );
  const cleanups = normalized.map(registerNormalizedTool);
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    for (let index = cleanups.length - 1; index >= 0; index--) cleanups[index]();
  };
}

/**
 * Start the browser adapter used by the Farm plugin. Applications normally use
 * `webmcp()` in `farm.config.ts` instead of calling this directly.
 */
export async function startWebMCPRuntime(
  options: StartWebMCPRuntimeOptions = {},
): Promise<FarmWebMCPRuntime> {
  activeRuntime?.close();

  const currentDocument =
    typeof document === "undefined" ? undefined : (document as DocumentWithModelContext);
  const modelContext = currentDocument?.modelContext;
  const behavior = options.unsupported ?? "ignore";

  if (!modelContext) {
    const message =
      "[farm:webmcp] This browser does not expose document.modelContext. " +
      "The registered tools will remain inactive.";
    if (behavior === "error") throw new Error(message);
    if (behavior === "warn") console.warn(message);

    const unsupportedRuntime = createUnsupportedRuntime();
    activeRuntime = unsupportedRuntime;
    exposeDebugRuntime(unsupportedRuntime, options.debug === true);
    return unsupportedRuntime;
  }
  const supportedModelContext = modelContext;

  const nativeTools = new Map<string, ActiveNativeTool>();
  let closed = false;
  let syncQueue = Promise.resolve();
  let unsubscribe = () => {};

  const runtime: FarmWebMCPRuntime = {
    supported: true,
    getTools: currentToolMetadata,
    sync() {
      const run = syncQueue.then(reconcile, reconcile);
      syncQueue = run.catch(() => {});
      return run;
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const active of nativeTools.values()) active.controller.abort();
      nativeTools.clear();
      clearDebugRuntime(runtime);
      if (activeRuntime === runtime) activeRuntime = undefined;
    },
  };

  async function reconcile(): Promise<void> {
    if (closed) return;
    const desired = currentToolsByName();

    for (const [name, active] of nativeTools) {
      if (desired.get(name)?.id === active.id) continue;
      active.controller.abort();
      nativeTools.delete(name);
    }

    const failures: unknown[] = [];
    for (const [name, registration] of desired) {
      if (closed || nativeTools.has(name)) continue;

      const controller = new AbortController();
      nativeTools.set(name, { id: registration.id, controller });
      try {
        await supportedModelContext.registerTool(
          toNativeTool(registration.tool, options.debug === true),
          { signal: controller.signal },
        );
      } catch (error) {
        if (nativeTools.get(name)?.id === registration.id) nativeTools.delete(name);
        controller.abort();
        if (!closed) {
          failures.push(error);
          reportError(`Could not register WebMCP tool "${name}"`, error, true);
        }
      }
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, "Could not register one or more WebMCP tools");
    }
  }

  unsubscribe = subscribeToRegistry(() => {
    void runtime.sync().catch(() => {});
  });
  activeRuntime = runtime;
  exposeDebugRuntime(runtime, options.debug === true);
  try {
    await runtime.sync();
    return runtime;
  } catch (error) {
    runtime.close();
    throw error;
  }
}

function createUnsupportedRuntime(): FarmWebMCPRuntime {
  let closed = false;
  const runtime: FarmWebMCPRuntime = {
    supported: false,
    getTools: currentToolMetadata,
    async sync() {},
    close() {
      if (closed) return;
      closed = true;
      clearDebugRuntime(runtime);
      if (activeRuntime === runtime) activeRuntime = undefined;
    },
  };
  return runtime;
}

function registerNormalizedTool(tool: WebMCPToolDefinition<object, WebMCPJSONValue>): () => void {
  const id = nextRegistrationId++;
  registrations.set(id, { id, tool });
  notifyRegistryListeners();
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    registrations.delete(id);
    notifyRegistryListeners();
  };
}

function currentToolsByName(): Map<string, RegisteredFarmTool> {
  const current = new Map<string, RegisteredFarmTool>();
  for (const registration of registrations.values())
    current.set(registration.tool.name, registration);
  return current;
}

function currentToolMetadata(): readonly WebMCPToolMetadata[] {
  return [...currentToolsByName().values()].map(({ tool }) => ({
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  }));
}

function subscribeToRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

function notifyRegistryListeners(): void {
  for (const listener of registryListeners) listener();
}

function toNativeTool(
  tool: WebMCPToolDefinition<object, WebMCPJSONValue>,
  debug: boolean,
): NativeWebMCPTool {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
    async execute(input, { signal }) {
      try {
        const parsed = tool.validate
          ? await validateInput(tool.name, tool.validate, input)
          : assertInputObject(tool.name, input);
        const result = await tool.execute(parsed, { signal });
        assertJSONValue(result, `Result from WebMCP tool "${tool.name}"`);
        return result;
      } catch (error) {
        reportError(`WebMCP tool "${tool.name}" failed`, error, debug);
        throw error;
      }
    },
  };
}

async function validateInput(
  toolName: string,
  validator: WebMCPValidator<object>,
  input: unknown,
): Promise<object> {
  try {
    let result: unknown;
    if (hasStandardSchema(validator)) {
      const validated = await validator["~standard"].validate(input);
      if (validated.issues !== undefined) throw new WebMCPInputError(toolName, validated.issues);
      result = validated.value;
    } else if (hasMethod(validator, "safeParseAsync")) {
      result = unwrapSafeParse(toolName, await validator.safeParseAsync(input));
    } else if (hasMethod(validator, "safeParse")) {
      result = unwrapSafeParse(toolName, validator.safeParse(input));
    } else if (hasMethod(validator, "parseAsync")) {
      result = await validator.parseAsync(input);
    } else if (hasMethod(validator, "parse")) {
      result = validator.parse(input);
    } else if (typeof validator === "function") {
      result = await validator(input);
    } else {
      throw new TypeError("Unsupported validator");
    }
    return assertInputObject(toolName, result);
  } catch (error) {
    if (error instanceof WebMCPInputError) throw error;
    throw new WebMCPInputError(toolName, extractIssues(error));
  }
}

function unwrapSafeParse<T>(toolName: string, result: WebMCPSafeParseResult<T>): T {
  if (result.success) return result.data;
  throw new WebMCPInputError(toolName, extractIssues(result.error));
}

function hasStandardSchema(value: unknown): value is WebMCPStandardSchema<object> {
  if (!value || typeof value !== "object" || !("~standard" in value)) return false;
  const standard = (value as { "~standard"?: unknown })["~standard"];
  return Boolean(
    standard &&
    typeof standard === "object" &&
    "validate" in standard &&
    typeof (standard as { validate?: unknown }).validate === "function",
  );
}

function hasMethod<TName extends string>(
  value: unknown,
  name: TName,
): value is Record<TName, (...args: any[]) => any> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    name in value &&
    typeof (value as Record<string, unknown>)[name] === "function",
  );
}

function assertInputObject(toolName: string, value: unknown): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebMCPInputError(toolName, "the validated input must be an object");
  }
  return value;
}

function normalizeToolDefinition(
  definition: WebMCPToolDefinition<object, WebMCPJSONValue>,
): WebMCPToolDefinition<object, WebMCPJSONValue> {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("A WebMCP tool definition must be an object");
  }
  if (!TOOL_NAME_PATTERN.test(definition.name)) {
    throw new TypeError(
      "A WebMCP tool name must be 1 to 128 ASCII letters, digits, `_`, `-`, or `.`",
    );
  }
  if (typeof definition.description !== "string" || !definition.description.trim()) {
    throw new TypeError(`WebMCP tool "${definition.name}" needs a description`);
  }
  if (
    definition.title !== undefined &&
    (typeof definition.title !== "string" || !definition.title.trim())
  ) {
    throw new TypeError(`WebMCP tool "${definition.name}" title must be a non-empty string`);
  }
  if (typeof definition.execute !== "function") {
    throw new TypeError(`WebMCP tool "${definition.name}" needs an execute function`);
  }
  if (
    !definition.inputSchema ||
    typeof definition.inputSchema !== "object" ||
    Array.isArray(definition.inputSchema)
  ) {
    throw new TypeError(`WebMCP tool "${definition.name}" inputSchema must be a JSON object`);
  }
  assertJSONValue(definition.inputSchema, `WebMCP tool "${definition.name}" inputSchema`);
  assertValidator(definition.name, definition.validate);
  const annotations = normalizeAnnotations(definition.name, definition.annotations);

  return Object.freeze({
    name: definition.name,
    ...(definition.title === undefined ? {} : { title: definition.title }),
    description: definition.description,
    inputSchema: cloneJSON(definition.inputSchema),
    ...(definition.validate === undefined ? {} : { validate: definition.validate }),
    ...(annotations === undefined ? {} : { annotations }),
    execute: definition.execute,
  });
}

function assertValidator(name: string, validator: unknown): void {
  if (validator === undefined || typeof validator === "function") return;
  if (
    hasStandardSchema(validator) ||
    hasMethod(validator, "safeParseAsync") ||
    hasMethod(validator, "safeParse") ||
    hasMethod(validator, "parseAsync") ||
    hasMethod(validator, "parse")
  ) {
    return;
  }
  throw new TypeError(`WebMCP tool "${name}" validate must be a supported schema or function`);
}

function normalizeAnnotations(
  name: string,
  annotations: WebMCPToolAnnotations | undefined,
): Readonly<WebMCPToolAnnotations> | undefined {
  if (annotations === undefined) return undefined;
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    throw new TypeError(`WebMCP tool "${name}" annotations must be an object`);
  }

  const allowed = new Set(["readOnlyHint", "untrustedContentHint", "consequentialHint"]);
  for (const [key, value] of Object.entries(annotations)) {
    if (!allowed.has(key)) {
      throw new TypeError(`WebMCP tool "${name}" has an unknown annotation "${key}"`);
    }
    if (typeof value !== "boolean") {
      throw new TypeError(`WebMCP tool "${name}" annotation "${key}" must be boolean`);
    }
  }
  return Object.freeze({ ...annotations });
}

function assertJSONValue(value: unknown, location: string, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${location} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError(`${location} must be JSON-serializable`);
  }
  if (seen.has(value)) throw new TypeError(`${location} contains a circular reference`);
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) throw new TypeError(`${location} contains a sparse array`);
      assertJSONValue(value[index], location, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${location} must contain only plain JSON objects`);
    }
    for (const entry of Object.values(value)) assertJSONValue(entry, location, seen);
  }
  seen.delete(value);
}

function cloneJSON<T>(value: T): T {
  return freezeJSON(JSON.parse(JSON.stringify(value))) as T;
}

function freezeJSON(value: unknown): unknown {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}

function extractIssues(error: unknown): unknown {
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: unknown }).issues;
  }
  return error;
}

function formatIssues(issues: unknown): string {
  if (Array.isArray(issues)) {
    const messages = issues.slice(0, 5).map((issue) => {
      if (!issue || typeof issue !== "object") return String(issue);
      const record = issue as { message?: unknown; path?: unknown };
      const path =
        Array.isArray(record.path) && record.path.length ? `${record.path.join(".")}: ` : "";
      return `${path}${typeof record.message === "string" ? record.message : "invalid value"}`;
    });
    return messages.join("; ") || "input did not match the validation schema";
  }
  if (issues instanceof Error) return issues.message;
  if (typeof issues === "string") return issues;
  return "input did not match the validation schema";
}

function exposeDebugRuntime(runtime: FarmWebMCPRuntime, enabled: boolean): void {
  if (enabled && typeof window !== "undefined") window.__FARM_WEBMCP__ = runtime;
}

function clearDebugRuntime(runtime: FarmWebMCPRuntime): void {
  if (typeof window !== "undefined" && window.__FARM_WEBMCP__ === runtime) {
    delete window.__FARM_WEBMCP__;
  }
}

function reportError(message: string, error: unknown, debug: boolean): void {
  if (debug) console.error(`[farm:webmcp] ${message}`, error);
}
