import type {
  JobsBatchTriggerRunResult,
  JobsCancelResult,
  JobsResolvedBatchItem,
  JobsResolvedLaunchOptions,
  JobsRunStatus,
  JobsRunStatusResult,
  JobsRuntimeCapabilities,
  JobsRuntimeCapability,
  JobsTaskDefinition,
} from "./index.js";
import { JobsRuntimeError } from "./errors.js";

/**
 * The version of the runtime contract this package implements. A runtime made
 * with `defineJobsRuntime()` records the version it was built against, and
 * `jobs()` refuses one built for a different version.
 */
export const JOBS_RUNTIME_CONTRACT = 1;

export type JobsRuntimeLogger = Pick<Console, "debug" | "info" | "warn" | "error">;

/** A task as a runtime sees it. `remoteId` is what `resolveRemoteId` returned. */
export interface JobsRuntimeTask {
  readonly key: string;
  readonly id: string;
  readonly remoteId: string;
  readonly definition: JobsTaskDefinition<any, any>;
}

export interface JobsRuntimeLaunch {
  handleId: string;
  /** ISO timestamp. Defaults to the time the launch returned. */
  queuedAt?: string;
}

export interface JobsRuntimeBatchLaunch {
  batchId?: string | null;
  runs: readonly {
    index: number;
    handleId: string;
    queuedAt?: string;
  }[];
}

/** What a runtime's `status` returns. Farm fills omitted fields with `null` or `[]`. */
export interface JobsRuntimeRunStatus {
  status: JobsRunStatus;
  providerRunId?: string | null;
  providerStatus?: string | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  output?: unknown;
  error?: unknown;
  tags?: readonly string[];
  raw?: unknown;
}

export type JobsRuntimeRouteVerdict = boolean | Response;

/**
 * A route the runtime itself needs, such as a tick a scheduler calls or a
 * provider webhook. It is mounted at `<basePath>/_runtime/<kind>/<path>`.
 */
export interface JobsRuntimeRoute {
  method: "GET" | "POST";
  /** Lowercase segments separated by `/`, for example `"tick"`. */
  path: string;
  /**
   * Decides whether the request may reach `handler`: `true` allows it, `false`
   * answers `401`, and a Response is sent as is. Required, because these routes
   * are called by schedulers and providers rather than by the app's users.
   */
  verify(request: Request): JobsRuntimeRouteVerdict | Promise<JobsRuntimeRouteVerdict>;
  handler(request: Request): Response | Promise<Response>;
}

/** The object a runtime's `create()` returns. */
export interface JobsRuntime {
  /** What the runtime can honor. Farm rejects any option whose capability is `false`. */
  readonly capabilities: JobsRuntimeCapabilities;
  /** Whether credentials are present, reported by `api.jobs.tasks.list()`. Defaults to `true`. */
  isConfigured?(): boolean;
  /** The provider-side name for a task id. Defaults to the id itself. */
  resolveRemoteId?(taskId: string): string;
  /** Throw to refuse a task at setup. Unsupported task defaults are already refused. */
  validateTask?(task: JobsRuntimeTask): void;
  trigger(
    task: JobsRuntimeTask,
    input: unknown,
    options: JobsResolvedLaunchOptions,
  ): Promise<JobsRuntimeLaunch>;
  /** Optional. Without it, a batch triggers each item in order. */
  batchTrigger?(
    task: JobsRuntimeTask,
    items: readonly JobsResolvedBatchItem[],
  ): Promise<JobsRuntimeBatchLaunch>;
  /** Throw `new JobsRuntimeError(message, 404)` for a run that is not this task's. */
  status(task: JobsRuntimeTask, handleId: string): Promise<JobsRuntimeRunStatus>;
  /** Required when `capabilities.cancel` is `true`. */
  cancel?(task: JobsRuntimeTask, handleId: string): Promise<void>;
  routes?: readonly JobsRuntimeRoute[];
  /** Called when the app's server starts, never during `farm build`. Start timers here. */
  start?(): void | Promise<void>;
  /** Called when the app shuts down. Stop timers and close connections here. */
  dispose?(): void | Promise<void>;
}

export interface JobsExecuteInput {
  /** The task key, as stored with the run. */
  task: string;
  input: unknown;
  run: {
    id: string;
    attempt: number;
  };
  signal?: AbortSignal;
}

/** A task error reduced to its name and message, so it can be stored and returned. */
export interface JobsSerializedError {
  name: string;
  message: string;
}

export type JobsExecuteResult =
  | { ok: true; output: unknown }
  | { ok: false; error: JobsSerializedError };

export interface JobsRuntimeContext {
  readonly kind: string;
  /** The jobs integration's route prefix, such as `/api/jobs`. */
  readonly basePath: string;
  /** The full path a runtime route with this `path` is mounted at. */
  routePath(path: string): string;
  /** The task registered under this key. Available once `jobs()` has finished setup. */
  getTask(key: string): JobsRuntimeTask | undefined;
  /**
   * Calls the task's `run` in this process. A thrown error becomes
   * `{ ok: false }`; an unknown task key throws a `JobsRuntimeError` with 404.
   */
  execute(input: JobsExecuteInput): Promise<JobsExecuteResult>;
  readonly logger: JobsRuntimeLogger;
}

/** A runtime ready to pass to `jobs({ runtime })`. */
export interface CustomJobsRuntimeDefinition<TKind extends string = string> {
  readonly kind: TKind;
  readonly contract: number;
  /**
   * Builds the runtime. It runs whenever the app loads its integrations,
   * including during `farm build`, so open connections and start timers lazily.
   */
  create(context: JobsRuntimeContext): JobsRuntime;
}

export interface DefineJobsRuntimeInput<TKind extends string> {
  /** Lowercase letters, digits, and dashes, starting with a letter. */
  kind: TKind;
  create(context: JobsRuntimeContext): JobsRuntime;
}

/** Declares a jobs runtime that `jobs({ runtime })` accepts alongside the built-in ones. */
export function defineJobsRuntime<const TKind extends string>(
  input: DefineJobsRuntimeInput<TKind>,
): CustomJobsRuntimeDefinition<TKind> {
  return {
    kind: input.kind,
    contract: JOBS_RUNTIME_CONTRACT,
    create: input.create,
  };
}

export function isCustomJobsRuntimeDefinition(
  value: unknown,
): value is CustomJobsRuntimeDefinition {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { create?: unknown }).create === "function"
  );
}

const CAPABILITY_KEYS = [
  "delay",
  "schedule",
  "debounce",
  "tags",
  "cancel",
  "batchTrigger",
  "queue",
  "retry",
  "ttl",
  "concurrencyKey",
  "idempotencyKey",
] as const satisfies readonly JobsRuntimeCapability[];

const RUN_STATUSES = new Set<JobsRunStatus>([
  "queued",
  "delayed",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
  "expired",
  "unknown",
]);

const KIND_PATTERN = /^[a-z][a-z0-9-]*$/;
const ROUTE_PATH_PATTERN = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const BUILT_IN_KINDS = new Set(["trigger", "inngest"]);

function unsupported(
  kind: string,
  capability: JobsRuntimeCapability,
  status: number,
  what: string,
): JobsRuntimeError {
  return new JobsRuntimeError(
    `The "${kind}" jobs runtime does not support ${what}; check task metadata capabilities before sending.`,
    status,
    {
      code: "JOBS_RUNTIME_CAPABILITY_UNSUPPORTED",
      runtime: kind,
      capability,
    },
  );
}

function serializeError(error: unknown): JobsSerializedError {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message };
  }
  // Never stringify an arbitrary thrown object: it can carry user data.
  return { name: "Error", message: typeof error === "string" ? error : "Task run failed." };
}

function createLogger(prefix: string): JobsRuntimeLogger {
  return {
    debug: (...args: unknown[]) => console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateDefinition(definition: CustomJobsRuntimeDefinition): void {
  const issues: string[] = [];
  const kind = (definition as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KIND_PATTERN.test(kind)) {
    issues.push(
      `\`kind\` must be lowercase letters, digits, and dashes, starting with a letter; received ${JSON.stringify(kind)}.`,
    );
  } else if (BUILT_IN_KINDS.has(kind)) {
    issues.push(
      `\`kind\` "${kind}" is reserved for the built-in ${kind}() runtime. Pick another name.`,
    );
  }
  if (definition.contract !== JOBS_RUNTIME_CONTRACT) {
    issues.push(
      `it was built for jobs runtime contract ${JSON.stringify(definition.contract)}, but this @farm.js/jobs implements contract ${JOBS_RUNTIME_CONTRACT}. Install versions of @farm.js/jobs and the runtime package that match, and create runtimes with defineJobsRuntime().`,
    );
  }
  if (issues.length > 0) {
    throw new TypeError(
      `Jobs runtime ${JSON.stringify(kind)} is invalid:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
}

function validateRuntime(kind: string, runtime: JobsRuntime): void {
  const issues: string[] = [];
  if (!runtime || typeof runtime !== "object") {
    throw new TypeError(`Jobs runtime "${kind}" create() must return an object.`);
  }
  const capabilities = runtime.capabilities as unknown as
    | Partial<Record<string, unknown>>
    | undefined;
  if (!capabilities || typeof capabilities !== "object") {
    issues.push("`capabilities` must be an object with a boolean for every capability.");
  } else {
    const missing = CAPABILITY_KEYS.filter((key) => typeof capabilities[key] !== "boolean");
    if (missing.length > 0) {
      issues.push(
        `\`capabilities\` needs a boolean for ${missing.map((key) => `\`${key}\``).join(", ")}.`,
      );
    }
  }
  for (const method of ["trigger", "status"] as const) {
    if (typeof runtime[method] !== "function") issues.push(`\`${method}\` must be a function.`);
  }
  for (const method of [
    "isConfigured",
    "resolveRemoteId",
    "validateTask",
    "batchTrigger",
    "cancel",
    "start",
    "dispose",
  ] as const) {
    if (runtime[method] !== undefined && typeof runtime[method] !== "function") {
      issues.push(`\`${method}\` must be a function when it is set.`);
    }
  }
  if (capabilities?.cancel === true && typeof runtime.cancel !== "function") {
    issues.push("`capabilities.cancel` is true, so `cancel` must be a function.");
  }
  if (runtime.routes !== undefined && !Array.isArray(runtime.routes)) {
    issues.push("`routes` must be an array when it is set.");
  }
  const seen = new Set<string>();
  for (const [index, route] of (Array.isArray(runtime.routes) ? runtime.routes : []).entries()) {
    const label = `routes[${index}]`;
    if (!route || typeof route !== "object") {
      issues.push(`\`${label}\` must be an object.`);
      continue;
    }
    if (route.method !== "GET" && route.method !== "POST") {
      issues.push(`\`${label}.method\` must be "GET" or "POST".`);
    }
    if (typeof route.path !== "string" || !ROUTE_PATH_PATTERN.test(route.path)) {
      issues.push(
        `\`${label}.path\` must be lowercase segments separated by "/", such as "tick"; received ${JSON.stringify(route.path)}.`,
      );
    }
    if (typeof route.verify !== "function") {
      issues.push(`\`${label}.verify\` must be a function that decides who may call the route.`);
    }
    if (typeof route.handler !== "function")
      issues.push(`\`${label}.handler\` must be a function.`);
    const id = `${route.method} ${route.path}`;
    if (seen.has(id)) issues.push(`\`${label}\` repeats ${id}.`);
    seen.add(id);
  }
  if (issues.length > 0) {
    throw new TypeError(
      `Jobs runtime "${kind}" is invalid:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
}

function unsupportedDefaults(task: JobsRuntimeTask, capabilities: JobsRuntimeCapabilities) {
  const defaults = task.definition.defaults;
  const fields: string[] = [];
  if (defaults?.queue && !capabilities.queue) fields.push("defaults.queue");
  if (defaults?.retry !== undefined && !capabilities.retry) fields.push("defaults.retry");
  if (defaults?.ttl !== undefined && !capabilities.ttl) fields.push("defaults.ttl");
  if (defaults?.concurrencyKey && !capabilities.concurrencyKey) {
    fields.push("defaults.concurrencyKey");
  }
  if (defaults?.idempotencyKey && !capabilities.idempotencyKey) {
    fields.push("defaults.idempotencyKey");
  }
  if (defaults?.tags && defaults.tags.length > 0 && !capabilities.tags)
    fields.push("defaults.tags");
  return fields;
}

function assertLaunchSupported(
  kind: string,
  capabilities: JobsRuntimeCapabilities,
  options: JobsResolvedLaunchOptions,
) {
  // Task defaults were checked at setup, so only per-call options can fail here.
  if (options.delayMode && !capabilities.schedule) {
    throw unsupported(kind, "schedule", 501, "one-off schedules");
  }
  if (options.delay != null && !options.delayMode && !capabilities.delay) {
    throw unsupported(kind, "delay", 400, "a launch delay");
  }
  if (options.debounce && !capabilities.debounce) {
    throw unsupported(kind, "debounce", 400, "debounce");
  }
  if (options.tags?.length && !capabilities.tags) {
    throw unsupported(kind, "tags", 400, "tags");
  }
  if (options.idempotencyKey && !capabilities.idempotencyKey) {
    throw unsupported(kind, "idempotencyKey", 400, "idempotency keys");
  }
}

function invalidResult(kind: string, what: string, data?: unknown) {
  return new JobsRuntimeError(`The "${kind}" jobs runtime ${what}.`, 502, data);
}

function normalizeLaunch(kind: string, launch: JobsRuntimeLaunch | undefined) {
  if (!launch || !isNonEmptyString(launch.handleId)) {
    throw invalidResult(kind, "did not return a run handle id");
  }
  return {
    handleId: launch.handleId,
    queuedAt: isNonEmptyString(launch.queuedAt) ? launch.queuedAt : new Date().toISOString(),
  };
}

function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export interface JobsRuntimeSetup {
  basePath: string;
  routePath(kind: string, path: string): string;
  getTask(key: string): JobsRuntimeTask | undefined;
}

export interface AdaptedJobsRuntimeRoute extends JobsRuntimeRoute {
  fullPath: string;
}

/**
 * Builds a custom runtime and wraps it in the shape the built-in runtimes
 * have, enforcing its declared capabilities in one place.
 */
export function adaptCustomRuntime(
  definition: CustomJobsRuntimeDefinition,
  setup: JobsRuntimeSetup,
) {
  validateDefinition(definition);
  const kind = definition.kind;
  const logger = createLogger(`[farm:jobs:${kind}]`);

  const context: JobsRuntimeContext = {
    kind,
    basePath: setup.basePath,
    routePath: (path) => setup.routePath(kind, path),
    getTask: (key) => setup.getTask(key),
    async execute(input) {
      const task = setup.getTask(input.task);
      if (!task) {
        throw new JobsRuntimeError(
          `Task "${input.task}" is not registered with this jobs integration.`,
          404,
        );
      }
      try {
        const output = await task.definition.run(input.input, {
          runtime: kind,
          task: { key: task.key, id: task.id },
          logger: createLogger(`[farm:jobs:${task.key}]`),
          run: { id: input.run.id, attempt: input.run.attempt },
          signal: input.signal,
        });
        return { ok: true, output };
      } catch (error) {
        return { ok: false, error: serializeError(error) };
      }
    },
    logger,
  };

  const runtime = definition.create(context);
  validateRuntime(kind, runtime);
  const capabilities: JobsRuntimeCapabilities = Object.freeze(
    Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, runtime.capabilities[key]])),
  ) as unknown as JobsRuntimeCapabilities;

  const routes: AdaptedJobsRuntimeRoute[] = (runtime.routes ?? []).map((route) => ({
    ...route,
    fullPath: setup.routePath(kind, route.path),
  }));

  let started: Promise<void> | undefined;
  let disposed: Promise<void> | undefined;

  return {
    kind,
    capabilities,
    routes,
    isConfigured() {
      return runtime.isConfigured ? runtime.isConfigured() === true : true;
    },
    resolveRemoteId(taskId: string) {
      const remoteId = runtime.resolveRemoteId ? runtime.resolveRemoteId(taskId) : taskId;
      if (!isNonEmptyString(remoteId)) {
        throw new TypeError(
          `Jobs runtime "${kind}" resolveRemoteId(${JSON.stringify(taskId)}) must return a non-empty string.`,
        );
      }
      return remoteId;
    },
    validateTask(task: JobsRuntimeTask) {
      const fields = unsupportedDefaults(task, capabilities);
      if (fields.length > 0) {
        throw new Error(
          `Task "${task.key}" sets ${fields.map((field) => `\`${field}\``).join(", ")}, which the "${kind}" jobs runtime does not support. Remove ${fields.length === 1 ? "it" : "them"} or use a runtime whose capabilities include ${fields.length === 1 ? "it" : "them"}.`,
        );
      }
      runtime.validateTask?.(task);
    },
    async trigger(task: JobsRuntimeTask, input: unknown, options: JobsResolvedLaunchOptions) {
      assertLaunchSupported(kind, capabilities, options);
      return normalizeLaunch(kind, await runtime.trigger(task, input, options));
    },
    async batchTrigger(
      task: JobsRuntimeTask,
      items: readonly JobsResolvedBatchItem[],
    ): Promise<{ batchId: string | null; runs: JobsBatchTriggerRunResult[] }> {
      if (!capabilities.batchTrigger) {
        throw unsupported(kind, "batchTrigger", 501, "batch triggers");
      }
      for (const item of items) assertLaunchSupported(kind, capabilities, item.options);

      if (runtime.batchTrigger) {
        const result = await runtime.batchTrigger(task, items);
        if (!result || !Array.isArray(result.runs) || result.runs.length === 0) {
          throw invalidResult(kind, "did not return any batch run handles");
        }
        return {
          batchId: isNonEmptyString(result.batchId) ? result.batchId : null,
          runs: result.runs.map((run) => ({
            index: run.index,
            ...normalizeLaunch(kind, run),
          })),
        };
      }

      const runs: JobsBatchTriggerRunResult[] = [];
      for (const [index, item] of items.entries()) {
        try {
          runs.push({
            index,
            ...normalizeLaunch(kind, await runtime.trigger(task, item.input, item.options)),
          });
        } catch (error) {
          // The earlier items already started, so return their handles with the failure.
          throw new JobsRuntimeError(
            `Batch item ${index} failed after ${runs.length} item${runs.length === 1 ? "" : "s"} started: ${error instanceof Error ? error.message : "unknown error"}`,
            error instanceof JobsRuntimeError ? error.status : 500,
            { code: "JOBS_BATCH_PARTIAL", runtime: kind, failedIndex: index, runs },
          );
        }
      }
      return { batchId: null, runs };
    },
    async status(
      task: JobsRuntimeTask,
      handleId: string,
    ): Promise<Omit<JobsRunStatusResult<unknown, string>, "task" | "runtime">> {
      const result = await runtime.status(task, handleId);
      if (!result || typeof result !== "object") {
        throw invalidResult(kind, "returned no status");
      }
      return {
        handleId,
        providerRunId: orNull(result.providerRunId),
        status: RUN_STATUSES.has(result.status) ? result.status : "unknown",
        providerStatus: orNull(result.providerStatus),
        queuedAt: orNull(result.queuedAt),
        startedAt: orNull(result.startedAt),
        finishedAt: orNull(result.finishedAt),
        output: orNull(result.output),
        error: orNull(result.error),
        tags: Array.isArray(result.tags)
          ? result.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        raw: orNull(result.raw),
      };
    },
    async cancel(task: JobsRuntimeTask, handleId: string): Promise<JobsCancelResult<string>> {
      if (!capabilities.cancel || !runtime.cancel) {
        throw unsupported(kind, "cancel", 501, "cancel");
      }
      await runtime.cancel(task, handleId);
      return { handleId, task: task.key, runtime: kind, canceled: true };
    },
    start() {
      started ??= Promise.resolve().then(() => runtime.start?.());
      return started;
    },
    dispose() {
      disposed ??= Promise.resolve().then(() => runtime.dispose?.());
      return disposed;
    },
  };
}
