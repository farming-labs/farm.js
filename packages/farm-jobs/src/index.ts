import {
  defineIntegration,
  defineIntegrationAPI,
  integrationRoute,
  type FarmIntegrationLogger,
} from "@farm.js/core";
import { api } from "@farm.js/core/client";
import type { FarmIntegrationAPIOperation } from "@farm.js/core/client";
import { integrationConfig } from "@farm.js/integration-utils";

export type JobsRuntimeKind = "trigger" | "inngest";

export type JobsRunStatus =
  | "queued"
  | "delayed"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "canceled"
  | "expired"
  | "unknown";

export interface JobsRuntimeCapabilities {
  readonly delay: boolean;
  readonly schedule: boolean;
  readonly debounce: boolean;
  readonly tags: boolean;
  readonly cancel: boolean;
  readonly batchTrigger: boolean;
  readonly queue: boolean;
  readonly retry: boolean;
  readonly ttl: boolean;
  readonly concurrencyKey: boolean;
  readonly idempotencyKey: boolean;
}

export interface JobsTaskQueueDefinition {
  name: string;
  concurrencyLimit?: number;
}

export interface JobsTaskRetryDefinition {
  attempts?: number;
}

export interface JobsTaskScheduleDefinition {
  cron: string;
  timezone?: string;
}

export type JobsTaskSchedule = string | JobsTaskScheduleDefinition;

export interface JobsTaskContext {
  runtime: JobsRuntimeKind;
  task: {
    key: string;
    id: string;
  };
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
}

export interface JobsTaskDefaults<TInput> {
  queue?: string | JobsTaskQueueDefinition;
  retry?: false | JobsTaskRetryDefinition;
  ttl?: string | number;
  concurrencyKey?: string | ((input: TInput) => string);
  idempotencyKey?: string | ((input: TInput) => string);
  tags?: readonly string[];
}

export interface JobsTaskInput<TInput, TOutput> {
  id?: string;
  description?: string;
  schedule?: JobsTaskSchedule;
  defaults?: JobsTaskDefaults<TInput>;
  run(input: TInput, context: JobsTaskContext): Promise<TOutput> | TOutput;
}

export interface JobsTaskDefinition<TInput, TOutput> extends JobsTaskInput<TInput, TOutput> {
  readonly kind: "farm-jobs-task";
}

export type JobsTaskMap = Record<string, JobsTaskDefinition<any, any>>;

export type InferJobsTaskInput<TTask> =
  TTask extends JobsTaskDefinition<infer TInput, any> ? TInput : never;

export type InferJobsTaskOutput<TTask> =
  TTask extends JobsTaskDefinition<any, infer TOutput> ? TOutput : never;

export type JobsTriggerBody<TInput> = [TInput] extends [void]
  ? {
      $options?: JobsTriggerOptions;
    }
  :
      | (TInput extends object
          ? TInput & {
              $options?: JobsTriggerOptions;
            }
          : {
              value: TInput;
              $options?: JobsTriggerOptions;
            })
      | JobsLegacyTriggerBody<TInput>;

export type JobsBatchTriggerItem<TInput> = [TInput] extends [void]
  ? {
      $options?: JobsTriggerOptions;
    }
  : JobsTriggerBody<TInput>;

export interface JobsBatchTriggerBody<TInput> {
  items: JobsBatchTriggerItem<TInput>[];
}

export interface JobsScheduleOptions {
  debounce?: JobsDebounceOptions;
  idempotencyKey?: string;
  tags?: readonly string[];
}

export interface JobsScheduleConfig extends JobsScheduleOptions {
  at?: string | Date;
  after?: string | number;
}

export type JobsScheduleBody<TInput> = [TInput] extends [void]
  ? {
      $schedule: JobsScheduleConfig;
    }
  :
      | (TInput extends object
          ? TInput & {
              $schedule: JobsScheduleConfig;
            }
          : {
              value: TInput;
              $schedule: JobsScheduleConfig;
            })
      | JobsLegacyScheduleBody<TInput>;

export type JobsLegacyTriggerBody<TInput> = [TInput] extends [void]
  ? {
      input?: undefined;
      options?: JobsTriggerOptions;
    }
  : {
      input: TInput;
      options?: JobsTriggerOptions;
    };

export type JobsLegacyScheduleBody<TInput> = [TInput] extends [void]
  ? {
      input?: undefined;
      at?: string | Date;
      after?: string | number;
      options?: JobsScheduleOptions;
    }
  : {
      input: TInput;
      at?: string | Date;
      after?: string | number;
      options?: JobsScheduleOptions;
    };

export interface JobsDebounceOptions {
  key: string;
  delay: string | number | Date;
}

export interface JobsTriggerOptions {
  delay?: string | number | Date;
  debounce?: JobsDebounceOptions;
  idempotencyKey?: string;
  tags?: readonly string[];
}

export interface JobsTriggerResult {
  handleId: string;
  task: string;
  runtime: JobsRuntimeKind;
  queuedAt: string;
  providerTaskId: string;
}

export interface JobsScheduleResult extends JobsTriggerResult {
  scheduledFor: string | number;
}

export interface JobsBatchTriggerRunResult {
  index: number;
  handleId: string;
  queuedAt: string;
}

export interface JobsBatchTriggerResult {
  batchId: string | null;
  task: string;
  runtime: JobsRuntimeKind;
  providerTaskId: string;
  runs: JobsBatchTriggerRunResult[];
}

export interface JobsStatusQuery {
  handleId: string;
}

export interface JobsCancelBody {
  handleId: string;
}

export interface JobsRunStatusResult<TOutput = unknown> {
  handleId: string;
  providerRunId: string | null;
  task: string;
  runtime: JobsRuntimeKind;
  status: JobsRunStatus;
  providerStatus: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  output: TOutput | null;
  error: unknown;
  tags: string[];
  raw: unknown;
}

export interface JobsCancelResult {
  handleId: string;
  task: string;
  runtime: JobsRuntimeKind;
  canceled: true;
}

export interface JobsTaskMetadata {
  key: string;
  id: string;
  remoteId: string;
  description: string | null;
  schedule: JobsTaskSchedule | null;
  runtime: JobsRuntimeKind;
  configured: boolean;
  capabilities: JobsRuntimeCapabilities;
  paths: {
    trigger: string;
    schedule: string;
    batchTrigger: string;
    status: string;
    cancel: string;
  };
  defaults: {
    queue: JobsTaskQueueDefinition | null;
    retryAttempts: number | null;
    ttl: string | number | null;
    tags: string[];
    hasConcurrencyKey: boolean;
    hasIdempotencyKey: boolean;
  };
}

export interface TriggerJobsRuntimeConfig {
  projectRef?: string;
  apiKey?: string;
  webhookSecret?: string;
  apiBaseUrl?: string;
}

export interface InngestJobsRuntimeConfig {
  appId?: string;
  eventKey?: string;
  signingKey?: string;
  eventBaseUrl?: string;
  apiBaseUrl?: string;
  eventNamePrefix?: string;
}

export interface TriggerJobsRuntimeDefinition {
  kind: "trigger";
  config: TriggerJobsRuntimeConfig;
}

export interface InngestJobsRuntimeDefinition {
  kind: "inngest";
  config: InngestJobsRuntimeConfig;
}

export type JobsRuntimeDefinition = TriggerJobsRuntimeDefinition | InngestJobsRuntimeDefinition;

interface ResolvedTriggerJobsConfig {
  kind: "trigger";
  projectRef: string;
  apiKey: string;
  webhookSecret: string;
  apiBaseUrl: string;
}

interface ResolvedInngestJobsConfig {
  kind: "inngest";
  appId: string;
  eventKey: string;
  signingKey: string;
  eventBaseUrl: string;
  apiBaseUrl: string;
  eventNamePrefix: string;
}

type ResolvedJobsConfig = ResolvedTriggerJobsConfig | ResolvedInngestJobsConfig;

export interface JobsIntegrationInputBase<TTasks extends JobsTaskMap> {
  basePath?: string;
  tasks: TTasks;
  log?: FarmIntegrationLogger;
}

type JobsIntegrationRuntimeInput<TTasks extends JobsTaskMap> = JobsIntegrationInputBase<TTasks> & {
  runtime: JobsRuntimeDefinition;
  trigger?: never;
  inngest?: never;
};

type JobsIntegrationLegacyInput<TTasks extends JobsTaskMap> =
  | (JobsIntegrationInputBase<TTasks> & {
      trigger: TriggerJobsRuntimeConfig;
      inngest?: never;
      runtime?: never;
    })
  | (JobsIntegrationInputBase<TTasks> & {
      inngest: InngestJobsRuntimeConfig;
      trigger?: never;
      runtime?: never;
    });

export type JobsIntegrationInput<TTasks extends JobsTaskMap> =
  | JobsIntegrationRuntimeInput<TTasks>
  | JobsIntegrationLegacyInput<TTasks>;

type JobsAPI<TTasks extends JobsTaskMap> = {
  [TKey in keyof TTasks & string]: {
    trigger: FarmIntegrationAPIOperation<
      JobsTriggerBody<InferJobsTaskInput<TTasks[TKey]>>,
      never,
      JobsTriggerResult,
      false,
      "POST"
    >;
    schedule: FarmIntegrationAPIOperation<
      JobsScheduleBody<InferJobsTaskInput<TTasks[TKey]>>,
      never,
      JobsScheduleResult,
      false,
      "POST"
    >;
    batchTrigger: FarmIntegrationAPIOperation<
      JobsBatchTriggerBody<InferJobsTaskInput<TTasks[TKey]>>,
      never,
      JobsBatchTriggerResult,
      false,
      "POST"
    >;
    status: FarmIntegrationAPIOperation<
      never,
      JobsStatusQuery,
      JobsRunStatusResult<InferJobsTaskOutput<TTasks[TKey]>>,
      false,
      "GET"
    >;
    cancel: FarmIntegrationAPIOperation<JobsCancelBody, never, JobsCancelResult, false, "POST">;
  };
} & {
  tasks: {
    list: FarmIntegrationAPIOperation<never, never, JobsTaskMetadata[], false, "GET">;
  };
};

type JobsResolvedLaunchOptions = {
  queue?: JobsTaskQueueDefinition;
  retryAttempts?: number;
  ttl?: string | number;
  concurrencyKey?: string;
  idempotencyKey?: string;
  tags?: string[];
  delay?: string | number;
  debounce?: {
    key: string;
    delay: string | number;
  };
};

type JobsResolvedBatchItem = {
  input: unknown;
  options: JobsResolvedLaunchOptions;
};

type JobsNormalizedTask = {
  key: string;
  id: string;
  pathSegment: string;
  remoteId: string;
  definition: JobsTaskDefinition<any, any>;
  metadata: JobsTaskMetadata;
};

type JobsRuntimeStatusResult = Omit<JobsRunStatusResult<unknown>, "task" | "runtime">;

type JobsRuntimeAdapter = {
  kind: JobsRuntimeKind;
  capabilities: JobsRuntimeCapabilities;
  isConfigured(): boolean;
  resolveRemoteId(taskId: string): string;
  validateTask(task: JobsNormalizedTask): void;
  trigger(
    task: JobsNormalizedTask,
    input: unknown,
    options: JobsResolvedLaunchOptions,
  ): Promise<{
    handleId: string;
    queuedAt: string;
  }>;
  batchTrigger(
    task: JobsNormalizedTask,
    items: readonly JobsResolvedBatchItem[],
  ): Promise<{
    batchId: string | null;
    runs: JobsBatchTriggerRunResult[];
  }>;
  status(task: JobsNormalizedTask, handleId: string): Promise<JobsRuntimeStatusResult>;
  cancel(task: JobsNormalizedTask, handleId: string): Promise<JobsCancelResult>;
};

const TRIGGER_CAPABILITIES: JobsRuntimeCapabilities = {
  delay: true,
  schedule: true,
  debounce: true,
  tags: true,
  cancel: true,
  batchTrigger: true,
  queue: true,
  retry: true,
  ttl: true,
  concurrencyKey: true,
  idempotencyKey: true,
};

const INNGEST_CAPABILITIES: JobsRuntimeCapabilities = {
  delay: false,
  schedule: false,
  debounce: false,
  tags: false,
  cancel: false,
  batchTrigger: true,
  queue: false,
  retry: false,
  ttl: false,
  concurrencyKey: false,
  idempotencyKey: true,
};

class JobsRuntimeError extends Error {
  readonly status: number;
  readonly data?: unknown;

  constructor(message: string, status = 500, data?: unknown) {
    super(message);
    this.name = "JobsRuntimeError";
    this.status = status;
    this.data = data;
  }
}

export function task<TInput, TOutput>(
  input: JobsTaskInput<TInput, TOutput>,
): JobsTaskDefinition<TInput, TOutput> {
  return {
    kind: "farm-jobs-task",
    ...input,
  };
}

export function defineTasks<const TTasks extends JobsTaskMap>(tasks: TTasks): TTasks {
  return tasks;
}

export function trigger(config: TriggerJobsRuntimeConfig): TriggerJobsRuntimeDefinition {
  return {
    kind: "trigger",
    config,
  };
}

export function inngest(config: InngestJobsRuntimeConfig): InngestJobsRuntimeDefinition {
  return {
    kind: "inngest",
    config,
  };
}

function normalizeBasePath(input: string | undefined) {
  const value = (input || "/api/jobs").trim() || "/api/jobs";
  const withLeadingSlash = value.startsWith("/") ? value : `/${value}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, "");
  return normalized || "/api/jobs";
}

function joinPath(...parts: string[]) {
  const [head, ...tail] = parts.filter(Boolean);
  if (!head) {
    return "/";
  }

  const base = head.replace(/\/+$/g, "");
  const suffix = tail
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");

  return suffix ? `${base}/${suffix}` : base;
}

function toKebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function readJsonBody(value: unknown) {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stripReservedKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keys.includes(key)) {
      clone[key] = entry;
    }
  }
  return clone;
}

function isLegacyTriggerBody(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  return (
    (hasOwn(value, "input") || hasOwn(value, "options")) &&
    keys.every((key) => key === "input" || key === "options")
  );
}

function isLegacyScheduleBody(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  return (
    (hasOwn(value, "input") ||
      hasOwn(value, "options") ||
      hasOwn(value, "at") ||
      hasOwn(value, "after")) &&
    keys.every((key) => key === "input" || key === "options" || key === "at" || key === "after")
  );
}

function readInlinePayload(value: Record<string, unknown>, reservedKeys: readonly string[]) {
  const payload = stripReservedKeys(value, reservedKeys);
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return undefined;
  }
  // Scalar task inputs are declared as { value: TInput } in the typed body;
  // unwrap that encoding so run() receives the scalar itself, matching the
  // legacy { input } form. Object inputs spread inline and keep their shape.
  if (keys.length === 1 && keys[0] === "value") {
    return payload.value;
  }
  return payload;
}

async function parseRequestBody(request: Request) {
  try {
    const body = await request.json();
    return readJsonBody(body);
  } catch {
    return undefined;
  }
}

function normalizeQueue(queue: JobsTaskDefaults<any>["queue"]) {
  if (!queue) {
    return undefined;
  }

  return typeof queue === "string" ? { name: queue } : queue;
}

function evaluateComputedValue<TInput>(
  input: string | ((payload: TInput) => string) | undefined,
  payload: TInput,
) {
  if (typeof input === "function") {
    return input(payload);
  }

  return input;
}

function dedupeTags(values: readonly string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function resolveRetryAttempts(retry: false | JobsTaskRetryDefinition | undefined) {
  if (retry === false) {
    return 1;
  }

  return retry?.attempts;
}

function normalizeDelayValue(
  value: string | number | Date | undefined,
  fieldName: string,
): string | number | undefined {
  if (value == null) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new JobsRuntimeError(`${fieldName} must not be empty.`, 400);
    }
    return trimmed;
  }

  throw new JobsRuntimeError(`${fieldName} must be a string, number, or Date.`, 400);
}

function resolveDebounceOptions(input: JobsDebounceOptions | undefined) {
  if (!input) {
    return undefined;
  }

  const key = input.key.trim();
  if (!key) {
    throw new JobsRuntimeError("debounce.key is required.", 400);
  }

  const delay = normalizeDelayValue(input.delay, "debounce.delay");
  if (delay == null) {
    throw new JobsRuntimeError("debounce.delay is required.", 400);
  }

  return {
    key,
    delay,
  };
}

function resolveLaunchOptions(
  task: JobsNormalizedTask,
  payload: unknown,
  options: JobsTriggerOptions | undefined,
): JobsResolvedLaunchOptions {
  const defaults = task.definition.defaults;
  const resolvedTags = dedupeTags([...(defaults?.tags || []), ...(options?.tags || [])]);

  return {
    queue: normalizeQueue(defaults?.queue),
    retryAttempts: resolveRetryAttempts(defaults?.retry),
    ttl: defaults?.ttl,
    concurrencyKey: evaluateComputedValue(
      defaults?.concurrencyKey as string | ((value: unknown) => string) | undefined,
      payload,
    ),
    idempotencyKey:
      options?.idempotencyKey ||
      evaluateComputedValue(
        defaults?.idempotencyKey as string | ((value: unknown) => string) | undefined,
        payload,
      ),
    tags: resolvedTags.length > 0 ? resolvedTags : undefined,
    delay: normalizeDelayValue(options?.delay, "delay"),
    debounce: resolveDebounceOptions(options?.debounce),
  };
}

function resolveScheduleLaunchOptions(
  task: JobsNormalizedTask,
  payload: unknown,
  body: {
    at?: string | Date;
    after?: string | number;
    options?: JobsScheduleOptions;
  },
) {
  const hasAt = body.at != null;
  const hasAfter = body.after != null;

  if (hasAt === hasAfter) {
    throw new JobsRuntimeError("Schedule requests must include exactly one of at or after.", 400);
  }

  const scheduledFor = hasAt
    ? normalizeDelayValue(body.at, "at")
    : normalizeDelayValue(body.after, "after");

  if (scheduledFor == null) {
    throw new JobsRuntimeError("Schedule requests must include exactly one of at or after.", 400);
  }

  return {
    scheduledFor,
    launch: resolveLaunchOptions(task, payload, {
      delay: scheduledFor,
      debounce: body.options?.debounce,
      idempotencyKey: body.options?.idempotencyKey,
      tags: body.options?.tags,
    }),
  };
}

function buildTriggerProviderOptions(options: JobsResolvedLaunchOptions) {
  const providerOptions: Record<string, unknown> = {};

  if (options.idempotencyKey) {
    providerOptions.idempotencyKey = options.idempotencyKey;
  }
  if (options.concurrencyKey) {
    providerOptions.concurrencyKey = options.concurrencyKey;
  }
  if (options.queue) {
    providerOptions.queue = options.queue;
  }
  if (options.retryAttempts != null) {
    providerOptions.maxAttempts = options.retryAttempts;
  }
  if (options.ttl != null) {
    providerOptions.ttl = options.ttl;
  }
  if (options.tags?.length) {
    providerOptions.tags = options.tags;
  }
  if (options.delay != null) {
    providerOptions.delay = options.delay;
  }
  if (options.debounce) {
    providerOptions.debounce = options.debounce;
  }

  return providerOptions;
}

function createMetadata(task: JobsNormalizedTask, runtime: JobsRuntimeAdapter) {
  const queue = normalizeQueue(task.definition.defaults?.queue) || null;
  return {
    key: task.key,
    id: task.id,
    remoteId: task.remoteId,
    description: task.definition.description || null,
    schedule: task.definition.schedule || null,
    runtime: runtime.kind,
    configured: runtime.isConfigured(),
    capabilities: runtime.capabilities,
    paths: {
      trigger: joinPath(task.metadata.paths.trigger),
      schedule: joinPath(task.metadata.paths.schedule),
      batchTrigger: joinPath(task.metadata.paths.batchTrigger),
      status: joinPath(task.metadata.paths.status),
      cancel: joinPath(task.metadata.paths.cancel),
    },
    defaults: {
      queue,
      retryAttempts: resolveRetryAttempts(task.definition.defaults?.retry) ?? null,
      ttl: task.definition.defaults?.ttl ?? null,
      tags: [...(task.definition.defaults?.tags || [])],
      hasConcurrencyKey: !!task.definition.defaults?.concurrencyKey,
      hasIdempotencyKey: !!task.definition.defaults?.idempotencyKey,
    },
  } satisfies JobsTaskMetadata;
}

function normalizeStatus(status: string | null | undefined) {
  const value = (status || "").trim().toUpperCase();
  switch (value) {
    case "PENDING_VERSION":
    case "QUEUED":
    case "DEQUEUED":
      return "queued" satisfies JobsRunStatus;
    case "DELAYED":
      return "delayed" satisfies JobsRunStatus;
    case "EXECUTING":
    case "RUNNING":
      return "running" satisfies JobsRunStatus;
    case "WAITING":
      return "waiting" satisfies JobsRunStatus;
    case "COMPLETED":
      return "completed" satisfies JobsRunStatus;
    case "FAILED":
    case "TIMED_OUT":
    case "CRASHED":
    case "SYSTEM_FAILURE":
      return "failed" satisfies JobsRunStatus;
    case "CANCELED":
    case "CANCELLED":
      return "canceled" satisfies JobsRunStatus;
    case "EXPIRED":
      return "expired" satisfies JobsRunStatus;
    default:
      return "unknown" satisfies JobsRunStatus;
  }
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function requestJSON(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const data = await parseJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : typeof data === "object" && data
          ? String(
              (data as { error?: string; message?: string }).error ||
                (data as { error?: string; message?: string }).message ||
                response.statusText ||
                "Jobs provider request failed.",
            )
          : response.statusText || "Jobs provider request failed.";
    throw new JobsRuntimeError(message, response.status, data);
  }

  return data;
}

function createTriggerRuntime(config: TriggerJobsRuntimeConfig): JobsRuntimeAdapter {
  function resolve() {
    return {
      projectRef: config.projectRef ?? process.env.TRIGGER_PROJECT_REF ?? "",
      apiKey: config.apiKey ?? process.env.TRIGGER_SECRET_KEY ?? "",
      webhookSecret: config.webhookSecret ?? process.env.TRIGGER_WEBHOOK_SECRET ?? "",
      apiBaseUrl: (config.apiBaseUrl ?? "https://api.trigger.dev").replace(/\/+$/g, ""),
    };
  }

  return {
    kind: "trigger",
    capabilities: TRIGGER_CAPABILITIES,
    isConfigured() {
      return resolve().apiKey.length > 0;
    },
    resolveRemoteId(taskId: string) {
      return taskId;
    },
    validateTask() {},
    async trigger(task, input, options) {
      const resolved = resolve();
      if (!resolved.apiKey) {
        throw new JobsRuntimeError(
          "Trigger runtime requires TRIGGER_SECRET_KEY or trigger.apiKey.",
          500,
        );
      }

      const payload: Record<string, unknown> = {};
      if (input !== undefined) {
        payload.payload = input;
      }
      payload.context = {
        source: "farmjs/jobs",
        task: task.key,
        projectRef: resolved.projectRef || undefined,
      };

      const providerOptions = buildTriggerProviderOptions(options);
      if (Object.keys(providerOptions).length > 0) {
        payload.options = providerOptions;
      }

      const data = await requestJSON(
        `${resolved.apiBaseUrl}/api/v1/tasks/${encodeURIComponent(task.remoteId)}/trigger`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${resolved.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      const handleId =
        typeof data === "object" && data ? String((data as { id?: string }).id || "") : "";

      if (!handleId) {
        throw new JobsRuntimeError("Trigger runtime did not return a run id.", 502, data);
      }

      return {
        handleId,
        queuedAt: new Date().toISOString(),
      };
    },
    async batchTrigger(task, items) {
      const resolved = resolve();
      if (!resolved.apiKey) {
        throw new JobsRuntimeError(
          "Trigger runtime requires TRIGGER_SECRET_KEY or trigger.apiKey.",
          500,
        );
      }

      const body = {
        items: items.map((item) => {
          const entry: Record<string, unknown> = {
            options: buildTriggerProviderOptions(item.options),
          };

          if (item.input !== undefined) {
            entry.payload = item.input;
          }

          if (Object.keys(entry.options as Record<string, unknown>).length === 0) {
            delete entry.options;
          }

          return entry;
        }),
      };

      const data = await requestJSON(
        `${resolved.apiBaseUrl}/api/v1/tasks/${encodeURIComponent(task.remoteId)}/batch`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${resolved.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const runs =
        typeof data === "object" && data && Array.isArray((data as { runs?: unknown[] }).runs)
          ? (data as { runs: unknown[] }).runs
          : [];
      const queuedAt = new Date().toISOString();
      const normalizedRuns = runs
        .map((run, index) => ({
          index,
          handleId: typeof run === "string" ? run : "",
          queuedAt,
        }))
        .filter((run) => run.handleId);

      if (normalizedRuns.length === 0) {
        throw new JobsRuntimeError("Trigger runtime did not return any batch run ids.", 502, data);
      }

      return {
        batchId:
          typeof data === "object" &&
          data &&
          typeof (data as { batchId?: unknown }).batchId === "string"
            ? ((data as { batchId: string }).batchId ?? null)
            : null,
        runs: normalizedRuns,
      };
    },
    async status(task, handleId) {
      const resolved = resolve();
      if (!resolved.apiKey) {
        throw new JobsRuntimeError(
          "Trigger runtime requires TRIGGER_SECRET_KEY or trigger.apiKey.",
          500,
        );
      }

      const data = await requestJSON(
        `${resolved.apiBaseUrl}/api/v3/runs/${encodeURIComponent(handleId)}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${resolved.apiKey}`,
            accept: "application/json",
          },
        },
      );

      const run = typeof data === "object" && data ? (data as Record<string, unknown>) : {};
      return {
        handleId,
        providerRunId: typeof run.id === "string" ? run.id : handleId,
        status: normalizeStatus(typeof run.status === "string" ? run.status : null),
        providerStatus: typeof run.status === "string" ? run.status : null,
        queuedAt: typeof run.createdAt === "string" ? run.createdAt : null,
        startedAt: typeof run.startedAt === "string" ? run.startedAt : null,
        finishedAt: typeof run.finishedAt === "string" ? run.finishedAt : null,
        output: (run.output as unknown) ?? null,
        error: (run.error as unknown) ?? null,
        tags: Array.isArray(run.tags)
          ? run.tags.filter((value): value is string => typeof value === "string")
          : [],
        raw: data,
      };
    },
    async cancel(task, handleId) {
      const resolved = resolve();
      if (!resolved.apiKey) {
        throw new JobsRuntimeError(
          "Trigger runtime requires TRIGGER_SECRET_KEY or trigger.apiKey.",
          500,
        );
      }

      await requestJSON(
        `${resolved.apiBaseUrl}/api/v2/runs/${encodeURIComponent(handleId)}/cancel`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${resolved.apiKey}`,
            accept: "application/json",
          },
        },
      );

      return {
        handleId,
        task: task.key,
        runtime: "trigger" as const,
        canceled: true as const,
      };
    },
  };
}

function createInngestRuntime(config: InngestJobsRuntimeConfig): JobsRuntimeAdapter {
  function resolve() {
    return {
      appId: config.appId ?? process.env.INNGEST_APP_ID ?? "",
      eventKey: config.eventKey ?? process.env.INNGEST_EVENT_KEY ?? "",
      signingKey: config.signingKey ?? process.env.INNGEST_SIGNING_KEY ?? "",
      eventBaseUrl: (config.eventBaseUrl ?? "https://inn.gs").replace(/\/+$/g, ""),
      apiBaseUrl: (config.apiBaseUrl ?? "https://api.inngest.com").replace(/\/+$/g, ""),
      eventNamePrefix: config.eventNamePrefix ?? "farm",
    };
  }

  return {
    kind: "inngest",
    capabilities: INNGEST_CAPABILITIES,
    isConfigured() {
      const resolved = resolve();
      return resolved.eventKey.length > 0 && resolved.signingKey.length > 0;
    },
    resolveRemoteId(taskId: string) {
      const resolved = resolve();
      return `${resolved.eventNamePrefix}/${taskId}`;
    },
    validateTask(task) {
      const defaults = task.definition.defaults;
      if (
        defaults?.queue ||
        defaults?.retry !== undefined ||
        defaults?.ttl !== undefined ||
        defaults?.concurrencyKey ||
        (defaults?.tags && defaults.tags.length > 0)
      ) {
        throw new JobsRuntimeError(
          `Task "${task.key}" uses Trigger-style launch defaults that are not supported by the Inngest runtime.`,
          400,
        );
      }
    },
    async trigger(task, input, options) {
      const resolved = resolve();
      if (!resolved.eventKey) {
        throw new JobsRuntimeError(
          "Inngest runtime requires INNGEST_EVENT_KEY or inngest.eventKey.",
          500,
        );
      }

      if (options.delay != null || (options.tags && options.tags.length > 0) || options.debounce) {
        throw new JobsRuntimeError(
          "Inngest runtime does not support delay, debounce, or tags through this integration yet.",
          400,
        );
      }

      const body: Record<string, unknown> = {
        name: task.remoteId,
        data: input ?? {},
      };

      if (options.idempotencyKey) {
        body.id = options.idempotencyKey;
      }

      const data = await requestJSON(
        `${resolved.eventBaseUrl}/e/${encodeURIComponent(resolved.eventKey)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const ids =
        typeof data === "object" && data && Array.isArray((data as { ids?: unknown[] }).ids)
          ? (data as { ids: unknown[] }).ids
          : [];
      const handleId = typeof ids[0] === "string" ? ids[0] : "";
      if (!handleId) {
        throw new JobsRuntimeError("Inngest runtime did not return an event id.", 502, data);
      }

      return {
        handleId,
        queuedAt: new Date().toISOString(),
      };
    },
    async batchTrigger(task, items) {
      const resolved = resolve();
      if (!resolved.eventKey) {
        throw new JobsRuntimeError(
          "Inngest runtime requires INNGEST_EVENT_KEY or inngest.eventKey.",
          500,
        );
      }

      const body = items.map((item) => {
        if (
          item.options.delay != null ||
          (item.options.tags && item.options.tags.length > 0) ||
          item.options.debounce
        ) {
          throw new JobsRuntimeError(
            "Inngest runtime does not support delay, debounce, or tags through this integration yet.",
            400,
          );
        }

        const event: Record<string, unknown> = {
          name: task.remoteId,
          data: item.input ?? {},
        };

        if (item.options.idempotencyKey) {
          event.id = item.options.idempotencyKey;
        }

        return event;
      });

      const data = await requestJSON(
        `${resolved.eventBaseUrl}/e/${encodeURIComponent(resolved.eventKey)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const ids =
        typeof data === "object" && data && Array.isArray((data as { ids?: unknown[] }).ids)
          ? (data as { ids: unknown[] }).ids
          : [];
      const queuedAt = new Date().toISOString();
      const normalizedRuns = ids
        .map((id, index) => ({
          index,
          handleId: typeof id === "string" ? id : "",
          queuedAt,
        }))
        .filter((run) => run.handleId);

      if (normalizedRuns.length === 0) {
        throw new JobsRuntimeError("Inngest runtime did not return any event ids.", 502, data);
      }

      return {
        batchId: null,
        runs: normalizedRuns,
      };
    },
    async status(task, handleId) {
      const resolved = resolve();
      if (!resolved.signingKey) {
        throw new JobsRuntimeError(
          "Inngest runtime requires INNGEST_SIGNING_KEY or inngest.signingKey.",
          500,
        );
      }

      const data = await requestJSON(
        `${resolved.apiBaseUrl}/v1/events/${encodeURIComponent(handleId)}/runs`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${resolved.signingKey}`,
            accept: "application/json",
          },
        },
      );

      const records =
        typeof data === "object" && data && Array.isArray((data as { data?: unknown[] }).data)
          ? (data as { data: unknown[] }).data
          : [];
      const run = records.find((entry) => typeof entry === "object" && entry !== null) as
        | Record<string, unknown>
        | undefined;

      if (!run) {
        return {
          handleId,
          providerRunId: null,
          status: "queued" satisfies JobsRunStatus,
          providerStatus: "EVENT_ACCEPTED",
          queuedAt: null,
          startedAt: null,
          finishedAt: null,
          output: null,
          error: null,
          tags: [],
          raw: data,
        };
      }

      return {
        handleId,
        providerRunId: typeof run.run_id === "string" ? run.run_id : null,
        status: normalizeStatus(typeof run.status === "string" ? run.status : null),
        providerStatus: typeof run.status === "string" ? run.status : null,
        queuedAt: typeof run.run_started_at === "string" ? run.run_started_at : null,
        startedAt: typeof run.run_started_at === "string" ? run.run_started_at : null,
        finishedAt: typeof run.ended_at === "string" ? run.ended_at : null,
        output: (run.output as unknown) ?? null,
        error: (run.error as unknown) ?? null,
        tags: [],
        raw: data,
      };
    },
    async cancel(task, handleId) {
      throw new JobsRuntimeError(
        `Task "${task.key}" is using the Inngest runtime, which does not expose cancel support through this integration yet.`,
        501,
      );
    },
  };
}

function resolveRuntimeDefinition<TTasks extends JobsTaskMap>(
  input: JobsIntegrationInput<TTasks>,
): JobsRuntimeDefinition {
  if ("runtime" in input && input.runtime) {
    return input.runtime;
  }

  if ("trigger" in input) {
    return trigger(input.trigger as TriggerJobsRuntimeConfig);
  }

  return inngest(input.inngest as InngestJobsRuntimeConfig);
}

function createRuntime(runtime: JobsRuntimeDefinition) {
  if (runtime.kind === "trigger") {
    return createTriggerRuntime(runtime.config);
  }

  return createInngestRuntime(runtime.config);
}

function resolveJobsIntegrationConfig(runtime: JobsRuntimeDefinition) {
  if (runtime.kind === "trigger") {
    const resolved = {
      kind: "trigger" as const,
      projectRef: runtime.config.projectRef ?? process.env.TRIGGER_PROJECT_REF ?? "",
      apiKey: runtime.config.apiKey ?? process.env.TRIGGER_SECRET_KEY ?? "",
      webhookSecret: runtime.config.webhookSecret ?? process.env.TRIGGER_WEBHOOK_SECRET ?? "",
      apiBaseUrl: (runtime.config.apiBaseUrl ?? "https://api.trigger.dev").replace(/\/+$/g, ""),
    };

    return integrationConfig<ResolvedTriggerJobsConfig>({
      label: "Trigger jobs runtime",
      env: {
        projectRef: "TRIGGER_PROJECT_REF",
        apiKey: "TRIGGER_SECRET_KEY",
        webhookSecret: "TRIGGER_WEBHOOK_SECRET",
      },
      input: resolved,
    });
  }

  const resolved = {
    kind: "inngest" as const,
    appId: runtime.config.appId ?? process.env.INNGEST_APP_ID ?? "",
    eventKey: runtime.config.eventKey ?? process.env.INNGEST_EVENT_KEY ?? "",
    signingKey: runtime.config.signingKey ?? process.env.INNGEST_SIGNING_KEY ?? "",
    eventBaseUrl: (runtime.config.eventBaseUrl ?? "https://inn.gs").replace(/\/+$/g, ""),
    apiBaseUrl: (runtime.config.apiBaseUrl ?? "https://api.inngest.com").replace(/\/+$/g, ""),
    eventNamePrefix: runtime.config.eventNamePrefix ?? "farm",
  };

  return integrationConfig<ResolvedInngestJobsConfig>({
    label: "Inngest jobs runtime",
    env: {
      appId: "INNGEST_APP_ID",
      eventKey: "INNGEST_EVENT_KEY",
      signingKey: "INNGEST_SIGNING_KEY",
    },
    input: resolved,
  });
}

function createJobsApi<TTasks extends JobsTaskMap>(
  tasks: readonly JobsNormalizedTask[],
  tasksPath: string,
) {
  const definition: Record<string, unknown> = {
    tasks: {
      list: api.get<JobsTaskMetadata[]>(tasksPath, {
        responseFormat: "json",
      }),
    },
  };

  for (const task of tasks) {
    definition[task.key] = {
      trigger: api.post<
        JobsTriggerBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
        JobsTriggerResult
      >(task.metadata.paths.trigger, {
        responseFormat: "json",
      }),
      schedule: api.post<
        JobsScheduleBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
        JobsScheduleResult
      >(task.metadata.paths.schedule, {
        responseFormat: "json",
      }),
      batchTrigger: api.post<
        JobsBatchTriggerBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
        JobsBatchTriggerResult
      >(task.metadata.paths.batchTrigger, {
        responseFormat: "json",
      }),
      status: api.get<
        JobsStatusQuery,
        JobsRunStatusResult<InferJobsTaskOutput<TTasks[typeof task.key & keyof TTasks]>>
      >(task.metadata.paths.status, {
        responseFormat: "json",
      }),
      cancel: api.post<JobsCancelBody, JobsCancelResult>(task.metadata.paths.cancel, {
        responseFormat: "json",
      }),
    };
  }

  return defineIntegrationAPI(definition as any) as unknown as JobsAPI<TTasks>;
}

function normalizeTasks<TTasks extends JobsTaskMap>(
  tasks: TTasks,
  basePath: string,
  runtime: JobsRuntimeAdapter,
) {
  const taskList: JobsNormalizedTask[] = [];
  const seenIds = new Set<string>();
  const seenSegments = new Set<string>();

  for (const [key, definition] of Object.entries(tasks)) {
    if (key === "tasks") {
      throw new Error('Jobs integration reserves the "tasks" key for metadata APIs.');
    }

    if (!definition || definition.kind !== "farm-jobs-task") {
      throw new Error(`Jobs integration entry "${key}" must be created with task(...).`);
    }

    const pathSegment = toKebabCase(key);
    if (!pathSegment) {
      throw new Error(`Jobs integration entry "${key}" could not be converted into a route path.`);
    }
    if (seenSegments.has(pathSegment)) {
      throw new Error(`Jobs integration path "${pathSegment}" is duplicated.`);
    }
    seenSegments.add(pathSegment);

    const id = definition.id?.trim() || pathSegment;
    if (seenIds.has(id)) {
      throw new Error(`Jobs integration id "${id}" is duplicated.`);
    }
    seenIds.add(id);

    const metadata: JobsTaskMetadata = {
      key,
      id,
      remoteId: runtime.resolveRemoteId(id),
      description: definition.description || null,
      schedule: definition.schedule || null,
      runtime: runtime.kind,
      configured: runtime.isConfigured(),
      capabilities: runtime.capabilities,
      paths: {
        trigger: joinPath(basePath, pathSegment, "trigger"),
        schedule: joinPath(basePath, pathSegment, "schedule"),
        batchTrigger: joinPath(basePath, pathSegment, "batch-trigger"),
        status: joinPath(basePath, pathSegment, "status"),
        cancel: joinPath(basePath, pathSegment, "cancel"),
      },
      defaults: {
        queue: normalizeQueue(definition.defaults?.queue) || null,
        retryAttempts: resolveRetryAttempts(definition.defaults?.retry) ?? null,
        ttl: definition.defaults?.ttl ?? null,
        tags: [...(definition.defaults?.tags || [])],
        hasConcurrencyKey: !!definition.defaults?.concurrencyKey,
        hasIdempotencyKey: !!definition.defaults?.idempotencyKey,
      },
    };

    const task: JobsNormalizedTask = {
      key,
      id,
      pathSegment,
      remoteId: runtime.resolveRemoteId(id),
      definition,
      metadata,
    };
    runtime.validateTask(task);
    taskList.push({
      ...task,
      metadata: createMetadata(task, runtime),
    });
  }

  return taskList;
}

function errorResponse(error: unknown) {
  if (error instanceof JobsRuntimeError) {
    return Response.json(
      {
        error: error.message,
        details: error.data ?? null,
      },
      {
        status: error.status,
      },
    );
  }

  return Response.json(
    {
      error: error instanceof Error ? error.message : "Jobs integration request failed.",
    },
    {
      status: 500,
    },
  );
}

function normalizeTriggerInput(body: Record<string, unknown> | undefined) {
  const value = body || {};
  if (isLegacyTriggerBody(value)) {
    return {
      input: value.input,
      options: value.options as JobsTriggerOptions | undefined,
    };
  }

  return {
    input: readInlinePayload(value, ["$options"]),
    options: value.$options as JobsTriggerOptions | undefined,
  };
}

function normalizeScheduleInput(body: Record<string, unknown> | undefined) {
  const value = body || {};
  if (isLegacyScheduleBody(value)) {
    return {
      input: value.input,
      at: value.at as string | Date | undefined,
      after: value.after as string | number | undefined,
      options: value.options as JobsScheduleOptions | undefined,
    };
  }

  const schedule =
    value.$schedule && typeof value.$schedule === "object"
      ? (value.$schedule as JobsScheduleConfig)
      : undefined;

  return {
    input: readInlinePayload(value, ["$schedule"]),
    at: schedule?.at,
    after: schedule?.after,
    options: schedule,
  };
}

function normalizeBatchTriggerInput<TTask extends JobsTaskDefinition<any, any>>(
  body: Record<string, unknown> | undefined,
) {
  return (body || {}) as unknown as JobsBatchTriggerBody<InferJobsTaskInput<TTask>>;
}

function normalizeBatchTriggerItem(item: unknown) {
  return normalizeTriggerInput(
    item && typeof item === "object" ? (item as Record<string, unknown>) : undefined,
  );
}

function normalizeCancelInput(body: Record<string, unknown> | undefined) {
  return (body || {}) as unknown as JobsCancelBody;
}

export function jobs<const TTasks extends JobsTaskMap>(input: JobsIntegrationInput<TTasks>) {
  const basePath = normalizeBasePath(input.basePath);
  const tasksPath = joinPath(basePath, "tasks");
  const runtimeDefinition = resolveRuntimeDefinition(input);
  const runtime = createRuntime(runtimeDefinition);
  const normalizedTasks = normalizeTasks(input.tasks, basePath, runtime);

  return defineIntegration({
    category: "automation",
    type: "jobs",
    instance: {
      runtime: runtime.kind,
      configured: runtime.isConfigured(),
      tasks: normalizedTasks.map((task) => task.metadata),
    },
    config: resolveJobsIntegrationConfig(runtimeDefinition),
    api: createJobsApi<TTasks>(normalizedTasks, tasksPath),
    log: input.log,
    routes: [
      integrationRoute.get<typeof tasksPath, JobsTaskMetadata[]>(tasksPath, {
        responseFormat: "json",
        handler() {
          return Response.json(normalizedTasks.map((task) => task.metadata));
        },
      }),
      ...normalizedTasks.flatMap((task) => [
        integrationRoute.post<
          typeof task.metadata.paths.trigger,
          JobsTriggerBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
          JobsTriggerResult
        >(task.metadata.paths.trigger, {
          responseFormat: "json",
          async handler(request) {
            try {
              const body = normalizeTriggerInput(await parseRequestBody(request));
              const launch = resolveLaunchOptions(task, body.input, body.options);
              const triggered = await runtime.trigger(task, body.input, launch);
              return Response.json({
                handleId: triggered.handleId,
                task: task.key,
                runtime: runtime.kind,
                queuedAt: triggered.queuedAt,
                providerTaskId: task.remoteId,
              } satisfies JobsTriggerResult);
            } catch (error) {
              return errorResponse(error);
            }
          },
        }),
        integrationRoute.post<
          typeof task.metadata.paths.batchTrigger,
          JobsBatchTriggerBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
          JobsBatchTriggerResult
        >(task.metadata.paths.batchTrigger, {
          responseFormat: "json",
          async handler(request) {
            try {
              const body = normalizeBatchTriggerInput<TTasks[typeof task.key & keyof TTasks]>(
                await parseRequestBody(request),
              );
              const items = Array.isArray(body.items) ? body.items : [];
              if (items.length === 0) {
                return Response.json(
                  {
                    error: "items must contain at least one trigger payload.",
                  },
                  {
                    status: 400,
                  },
                );
              }

              const batchItems = items.map((item) => {
                const normalizedItem = normalizeBatchTriggerItem(item);
                return {
                  input: normalizedItem?.input,
                  options: resolveLaunchOptions(
                    task,
                    normalizedItem?.input,
                    normalizedItem?.options,
                  ),
                } satisfies JobsResolvedBatchItem;
              });
              const triggered = await runtime.batchTrigger(task, batchItems);
              return Response.json({
                batchId: triggered.batchId,
                task: task.key,
                runtime: runtime.kind,
                providerTaskId: task.remoteId,
                runs: triggered.runs,
              } satisfies JobsBatchTriggerResult);
            } catch (error) {
              return errorResponse(error);
            }
          },
        }),
        integrationRoute.post<
          typeof task.metadata.paths.schedule,
          JobsScheduleBody<InferJobsTaskInput<TTasks[typeof task.key & keyof TTasks]>>,
          JobsScheduleResult
        >(task.metadata.paths.schedule, {
          responseFormat: "json",
          async handler(request) {
            try {
              const body = normalizeScheduleInput(await parseRequestBody(request));
              const { scheduledFor, launch } = resolveScheduleLaunchOptions(task, body.input, body);
              const triggered = await runtime.trigger(task, body.input, launch);
              return Response.json({
                handleId: triggered.handleId,
                task: task.key,
                runtime: runtime.kind,
                queuedAt: triggered.queuedAt,
                providerTaskId: task.remoteId,
                scheduledFor,
              } satisfies JobsScheduleResult);
            } catch (error) {
              return errorResponse(error);
            }
          },
        }),
        integrationRoute.get<
          typeof task.metadata.paths.status,
          JobsRunStatusResult<InferJobsTaskOutput<TTasks[typeof task.key & keyof TTasks]>>,
          JobsStatusQuery
        >(task.metadata.paths.status, {
          responseFormat: "json",
          async handler(request) {
            try {
              const handleId = new URL(request.url).searchParams.get("handleId") || "";
              if (!handleId) {
                return Response.json(
                  {
                    error: "handleId is required.",
                  },
                  {
                    status: 400,
                  },
                );
              }

              const status = await runtime.status(task, handleId);
              return Response.json({
                ...status,
                output:
                  (status.output as InferJobsTaskOutput<
                    TTasks[typeof task.key & keyof TTasks]
                  > | null) ?? null,
                task: task.key,
                runtime: runtime.kind,
              } satisfies JobsRunStatusResult<
                InferJobsTaskOutput<TTasks[typeof task.key & keyof TTasks]>
              >);
            } catch (error) {
              return errorResponse(error);
            }
          },
        }),
        integrationRoute.post<typeof task.metadata.paths.cancel, JobsCancelBody, JobsCancelResult>(
          task.metadata.paths.cancel,
          {
            responseFormat: "json",
            async handler(request) {
              try {
                const body = normalizeCancelInput(await parseRequestBody(request));
                const handleId = typeof body.handleId === "string" ? body.handleId : "";
                if (!handleId) {
                  return Response.json(
                    {
                      error: "handleId is required.",
                    },
                    {
                      status: 400,
                    },
                  );
                }

                const canceled = await runtime.cancel(task, handleId);
                return Response.json(canceled);
              } catch (error) {
                return errorResponse(error);
              }
            },
          },
        ),
      ]),
    ],
  });
}
