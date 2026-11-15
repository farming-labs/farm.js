import type { JobsResolvedLaunchOptions, JobsRunStatus, JobsRuntimeCapabilities } from "./index.js";
import { JobsRuntimeError } from "./errors.js";
import {
  defineJobsRuntime,
  type JobsRuntime,
  type JobsRuntimeContext,
  type JobsRuntimeTask,
  type JobsSerializedError,
} from "./runtime.js";
import { parseDurationMs, resolveScheduledTimestamp } from "./time.js";

/**
 * The key-value methods `local()` stores runs with. A Farm storage namespace
 * (`getStorage("jobs")`) or any unstorage instance has them.
 */
export interface JobsKeyValueStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: any): unknown;
  removeItem(key: string): unknown;
  getKeys(base?: string): string[] | Promise<string[]>;
  getMount?(key?: string): { driver?: { name?: string } } | undefined;
}

export interface LocalJobsRuntimeOptions {
  /**
   * Where runs are kept: a Farm storage namespace name, or a storage instance.
   * A namespace backed by the in-memory driver is refused in production.
   * @default "jobs"
   */
  storage?: string | JobsKeyValueStorage;
  /**
   * How often this process looks for runs that are due, or `false` to rely on
   * the tick route alone. Serverless functions do not stay alive between
   * requests, so schedule the tick route with `cron` there.
   * @default 1000
   */
  pollIntervalMs?: number | false;
  /**
   * How long one attempt holds its run. When it ends without a result, the
   * process is assumed to have died and the run is attempted again.
   * @default 300000
   */
  leaseMs?: number;
  /**
   * The wait before the next attempt after attempt `n` failed.
   * @default 1000 * 2 ** (n - 1), at most 60000
   */
  retryDelayMs?: number | ((attempt: number) => number);
  /**
   * How long a finished run stays readable through `status` before it is removed.
   * @default 604800000 (7 days)
   */
  retentionMs?: number;
  /**
   * Most runs one tick starts. Runs in a tick start one after another.
   * @default 25
   */
  tickLimit?: number;
}

/** What one pass over the due runs did. The tick route answers with it. */
export interface LocalJobsTickResult {
  started: number;
  completed: number;
  failed: number;
  retried: number;
  expired: number;
  removed: number;
}

type LocalRunState =
  | "queued"
  | "delayed"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "expired";

interface LocalRunRecord {
  v: 1;
  id: string;
  task: string;
  taskId: string;
  input: unknown;
  state: LocalRunState;
  attempt: number;
  maxAttempts: number;
  queuedAt: string;
  runAt: number;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: number | null;
  leaseId: string | null;
  dueKey: string | null;
  idempotencyKey: string | null;
  output: unknown;
  error: JobsSerializedError | null;
  tags: string[];
}

const LOCAL_CAPABILITIES: JobsRuntimeCapabilities = {
  delay: true,
  schedule: true,
  debounce: false,
  tags: true,
  cancel: true,
  batchTrigger: true,
  queue: false,
  retry: true,
  ttl: true,
  concurrencyKey: false,
  idempotencyKey: true,
};

const LOCAL_SCHEDULE_RUNTIME = { kind: "local", label: "Local jobs" } as const;
const DEFAULT_ATTEMPTS = 3;
const TERMINAL_STATES = new Set<LocalRunState>(["completed", "failed", "canceled", "expired"]);
const RUN_ID_PATTERN = /^run_[a-f0-9]{32}$/;
const TIME_WIDTH = 15;

function readNodeEnv(): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.NODE_ENV;
}

/**
 * Whether this is a deployed server. Farm's Node server sets NODE_ENV to
 * production; a Cloudflare worker leaves it unset and carries its bindings on
 * `globalThis.__env__`, as core's own deployed-runtime check reads them.
 */
function isDeployedRuntime(): boolean {
  if (readNodeEnv() === "production") return true;
  const bindings = (globalThis as { __env__?: unknown }).__env__;
  return Boolean(bindings) && typeof bindings === "object";
}

function randomHex() {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

async function sha256Hex(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function padTime(ms: number) {
  return String(Math.max(0, Math.floor(ms))).padStart(TIME_WIDTH, "0");
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** `due:<ms>:<id>` and `gc:<ms>:<id>` index keys sort by time as strings. */
function indexKey(prefix: "due" | "gc", ms: number, id: string) {
  return `${prefix}:${padTime(ms)}:${id}`;
}

function parseIndexKey(key: string) {
  const match = /^(?:due|gc):(\d+):(run_[a-f0-9]{32})$/.exec(key);
  return match ? { at: Number(match[1]), id: match[2]! } : undefined;
}

function defaultRetryDelay(attempt: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

/** Trigger.dev reads a numeric `ttl` as seconds, so `local()` does too. */
function resolveTtlMs(ttl: string | number): number {
  const ms = typeof ttl === "number" ? ttl * 1_000 : parseDurationMs(ttl.trim());
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    throw new JobsRuntimeError(
      "Local jobs ttl must be a positive number of seconds or a duration ending in ms, s, m, h, or d.",
      400,
      { code: "JOBS_INVALID_TTL", runtime: "local", value: ttl },
    );
  }
  return ms;
}

function toStatus(state: LocalRunState): JobsRunStatus {
  return state;
}

function isStorage(value: unknown): value is JobsKeyValueStorage {
  if (!value || typeof value !== "object") return false;
  const storage = value as Record<string, unknown>;
  return ["getItem", "setItem", "removeItem", "getKeys"].every(
    (method) => typeof storage[method] === "function",
  );
}

function validateOptions(options: LocalJobsRuntimeOptions) {
  const issues: string[] = [];
  const positive = (name: keyof LocalJobsRuntimeOptions, value: unknown, integer = false) => {
    if (value === undefined) return;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (integer && !Number.isInteger(value))
    ) {
      issues.push(
        `\`${name}\` must be a positive ${integer ? "integer" : "number"}; received ${JSON.stringify(value)}.`,
      );
    }
  };
  if (options.pollIntervalMs !== false) positive("pollIntervalMs", options.pollIntervalMs);
  positive("leaseMs", options.leaseMs);
  positive("retentionMs", options.retentionMs);
  positive("tickLimit", options.tickLimit, true);
  const retry = options.retryDelayMs;
  if (
    retry !== undefined &&
    typeof retry !== "function" &&
    (typeof retry !== "number" || !Number.isFinite(retry) || retry < 0)
  ) {
    issues.push(
      `\`retryDelayMs\` must be zero or more milliseconds, or a function of the attempt number; received ${JSON.stringify(retry)}.`,
    );
  }
  const storage = options.storage;
  if (
    storage !== undefined &&
    !(typeof storage === "string" && storage.trim().length > 0) &&
    !isStorage(storage)
  ) {
    issues.push(
      "`storage` must be a storage namespace name or an object with getItem, setItem, removeItem, and getKeys.",
    );
  }
  if (issues.length > 0) {
    throw new TypeError(`local() options are invalid:\n${issues.map((i) => `- ${i}`).join("\n")}`);
  }
}

/**
 * Runs tasks in the app itself: a run is stored, its `run` callback is called
 * after the response that started it, and failed attempts are retried. Use it
 * in development, in tests, and for apps that run as one long-lived process.
 */
export function local(options: LocalJobsRuntimeOptions = {}) {
  validateOptions(options);
  return defineJobsRuntime({
    kind: "local",
    create: (context) => createLocalRuntime(context, options),
  });
}

function createLocalRuntime(
  context: JobsRuntimeContext,
  options: LocalJobsRuntimeOptions,
): JobsRuntime {
  const pollIntervalMs =
    options.pollIntervalMs === false ? false : (options.pollIntervalMs ?? 1_000);
  const leaseMs = options.leaseMs ?? 300_000;
  const retentionMs = options.retentionMs ?? 604_800_000;
  const tickLimit = options.tickLimit ?? 25;
  const retryDelay = (attempt: number) => {
    const value =
      typeof options.retryDelayMs === "function"
        ? options.retryDelayMs(attempt)
        : (options.retryDelayMs ?? defaultRetryDelay(attempt));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const tickPath = context.routePath("tick");

  const locks = new Map<string, Promise<unknown>>();
  const inFlight = new Map<string, AbortController>();
  let poller: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  let tickChain: Promise<unknown> = Promise.resolve();
  let warnedNoStart = false;
  let lastPollError: string | undefined;

  /** Serializes work on one key in this process. Storage has no compare-and-swap. */
  function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    locks.set(key, settled);
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key);
    });
    return next;
  }

  let storageModule: Promise<typeof import("@farm.js/core/storage")> | undefined;

  async function store(): Promise<JobsKeyValueStorage> {
    if (options.storage && typeof options.storage === "object") return options.storage;
    storageModule ??= import("@farm.js/core/storage");
    const { getStorage } = await storageModule;
    const namespace = (options.storage as string | undefined) ?? "jobs";
    const storage = getStorage(namespace) as unknown as JobsKeyValueStorage;
    if (isDeployedRuntime() && storage.getMount?.("")?.driver?.name === "memory") {
      throw new JobsRuntimeError(
        `local() keeps runs in the "${namespace}" storage namespace, which uses the in-memory driver in this production build, so a restart or a second instance loses them. Configure a persistent driver with \`storage\` in farm.config.ts, or pass local({ storage }) a persistent storage instance.`,
        500,
        { code: "JOBS_LOCAL_STORAGE_NOT_PERSISTENT", runtime: "local" },
      );
    }
    return storage;
  }

  async function readRun(storage: JobsKeyValueStorage, id: string) {
    const value = (await storage.getItem(`runs:${id}`)) as LocalRunRecord | null | undefined;
    return value && typeof value === "object" && value.v === 1 && value.id === id
      ? value
      : undefined;
  }

  async function writeRun(storage: JobsKeyValueStorage, record: LocalRunRecord) {
    await storage.setItem(`runs:${record.id}`, record);
  }

  async function moveIndex(
    storage: JobsKeyValueStorage,
    record: LocalRunRecord,
    nextDueKey: string | null,
  ) {
    if (nextDueKey) await storage.setItem(nextDueKey, record.id);
    if (record.dueKey && record.dueKey !== nextDueKey) await storage.removeItem(record.dueKey);
  }

  async function finish(
    storage: JobsKeyValueStorage,
    record: LocalRunRecord,
    state: LocalRunState,
    now: number,
    patch: Partial<LocalRunRecord> = {},
  ) {
    const finished: LocalRunRecord = {
      ...record,
      ...patch,
      state,
      finishedAt: iso(now),
      leaseId: null,
      dueKey: null,
    };
    await storage.setItem(indexKey("gc", now + retentionMs, record.id), record.id);
    await writeRun(storage, finished);
    await moveIndex(storage, record, null);
    return finished;
  }

  function ensurePolling() {
    if (poller || disposed || pollIntervalMs === false || typeof setInterval !== "function") return;
    poller = setInterval(() => {
      void enqueueTick().then(
        () => {
          lastPollError = undefined;
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          // Report a failing poll once, not on every interval.
          if (message !== lastPollError)
            context.logger.error("Polling for due runs failed:", message);
          lastPollError = message;
        },
      );
    }, pollIntervalMs);
    (poller as { unref?: () => void }).unref?.();
  }

  async function startAfterResponse(id: string) {
    let scheduled = false;
    try {
      const { after } = await import("@farm.js/core/after");
      after(async () => {
        await claimAndRun(id).catch(reportBackgroundError);
      });
      scheduled = true;
    } catch {
      // Not inside a request, for example a script. Polling or the tick route starts the run.
    }
    if (!scheduled && pollIntervalMs === false && !warnedNoStart) {
      warnedNoStart = true;
      context.logger.warn(
        `Run ${id} was started outside a request and polling is off, so it starts on the next call to ${tickPath}.`,
      );
    }
  }

  function reportBackgroundError(error: unknown) {
    context.logger.error(
      "A run failed to start:",
      error instanceof Error ? error.message : String(error),
    );
  }

  type RunOutcome = "completed" | "failed" | "retried" | "expired" | "skipped";

  interface RunAttempt {
    /** Whether an attempt called the task's `run`. */
    started: boolean;
    outcome: RunOutcome;
  }

  type Claim =
    | { kind: "done"; attempt: RunAttempt }
    | { kind: "claimed"; storage: JobsKeyValueStorage; record: LocalRunRecord };

  /** Takes the lease on run `id` when it is due. Runs inside the run's lock. */
  async function claim(id: string, indexEntry: string | undefined): Promise<Claim> {
    const skipped: Claim = { kind: "done", attempt: { started: false, outcome: "skipped" } };
    if (disposed) return skipped;
    const storage = await store();
    const record = await readRun(storage, id);
    const now = Date.now();
    if (!record) {
      if (indexEntry) await storage.removeItem(indexEntry);
      return skipped;
    }
    if (indexEntry && record.dueKey !== indexEntry) {
      // A stale index entry left by a write that was interrupted.
      await storage.removeItem(indexEntry);
      return skipped;
    }
    if (TERMINAL_STATES.has(record.state) || record.runAt > now || inFlight.has(id)) {
      return skipped;
    }
    if (record.expiresAt != null && record.attempt === 0 && now > record.expiresAt) {
      await finish(storage, record, "expired", now);
      return { kind: "done", attempt: { started: false, outcome: "expired" } };
    }
    if (record.state === "running" && record.attempt >= record.maxAttempts) {
      // The last attempt's lease ran out without a result.
      await finish(storage, record, "failed", now, {
        error: {
          name: "JobsLeaseExpired",
          message: `Attempt ${record.attempt} did not finish within leaseMs (${leaseMs} ms). The process may have stopped, or the task needs a longer leaseMs.`,
        },
      });
      return { kind: "done", attempt: { started: false, outcome: "failed" } };
    }

    const leaseId = randomHex();
    const leaseUntil = now + leaseMs;
    const leaseKey = indexKey("due", leaseUntil, id);
    const claimed: LocalRunRecord = {
      ...record,
      state: "running",
      attempt: record.attempt + 1,
      startedAt: record.startedAt ?? iso(now),
      runAt: leaseUntil,
      leaseId,
      dueKey: leaseKey,
    };
    await writeRun(storage, claimed);
    await moveIndex(storage, record, leaseKey);
    // Another instance may have claimed it between our read and write. The last
    // writer keeps the lease; this check makes the loser back off.
    if ((await readRun(storage, id))?.leaseId !== leaseId) return skipped;
    return { kind: "claimed", storage, record: claimed };
  }

  /** Claims run `id`, calls its task outside the lock so cancel stays prompt, and records the result. */
  async function claimAndRun(id: string, indexEntry?: string): Promise<RunAttempt> {
    const claimed = await withLock(`run:${id}`, () => claim(id, indexEntry));
    if (claimed.kind === "done") return claimed.attempt;
    const { storage, record } = claimed;

    const controller = new AbortController();
    inFlight.set(id, controller);
    const timer = setTimeout(
      () => controller.abort(new Error(`The attempt outlived leaseMs (${leaseMs} ms).`)),
      leaseMs,
    );
    (timer as { unref?: () => void }).unref?.();

    let result: Awaited<ReturnType<JobsRuntimeContext["execute"]>>;
    let retryable = true;
    try {
      result = await context.execute({
        task: record.task,
        input: record.input,
        run: { id, attempt: record.attempt },
        signal: controller.signal,
      });
      if (result.ok) {
        try {
          JSON.stringify(result.output);
        } catch (error) {
          retryable = false;
          result = {
            ok: false,
            error: {
              name: "JobsOutputNotSerializable",
              message: `The task returned output that cannot be stored as JSON: ${error instanceof Error ? error.message : String(error)}`,
            },
          };
        }
      }
    } catch (error) {
      // The task is no longer registered, for example after a deploy removed it.
      retryable = false;
      result = {
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    } finally {
      clearTimeout(timer);
      inFlight.delete(id);
    }

    const outcome = await withLock(`run:${id}`, async (): Promise<RunOutcome> => {
      const finishedAt = Date.now();
      const current = await readRun(storage, id);
      // Canceled, or reclaimed after the lease ended: the newer state wins.
      if (!current || current.leaseId !== record.leaseId) return "skipped";

      if (result.ok) {
        await finish(storage, current, "completed", finishedAt, {
          output: result.output ?? null,
          error: null,
        });
        return "completed";
      }
      if (retryable && current.attempt < current.maxAttempts) {
        const runAt = finishedAt + retryDelay(current.attempt);
        const dueKey = indexKey("due", runAt, id);
        const next: LocalRunRecord = {
          ...current,
          state: runAt > finishedAt ? "delayed" : "queued",
          runAt,
          leaseId: null,
          dueKey,
          error: result.error,
        };
        await writeRun(storage, next);
        await moveIndex(storage, current, dueKey);
        return "retried";
      }
      await finish(storage, current, "failed", finishedAt, { error: result.error });
      return "failed";
    });
    return { started: true, outcome };
  }

  async function removeExpiredRecord(storage: JobsKeyValueStorage, id: string, gcKey: string) {
    const record = await readRun(storage, id);
    await storage.removeItem(gcKey);
    if (!record || !TERMINAL_STATES.has(record.state)) return false;
    // finishedAt + retentionMs is when the record is due for removal.
    const finishedAt = record.finishedAt ? Date.parse(record.finishedAt) : 0;
    if (finishedAt + retentionMs > Date.now()) return false;
    if (record.idempotencyKey) {
      const pointer = `idem:${record.idempotencyKey}`;
      if ((await storage.getItem(pointer)) === id) await storage.removeItem(pointer);
    }
    await storage.removeItem(`runs:${id}`);
    return true;
  }

  async function tick(): Promise<LocalJobsTickResult> {
    const result: LocalJobsTickResult = {
      started: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      expired: 0,
      removed: 0,
    };
    if (disposed) return result;
    const storage = await store();
    const now = Date.now();

    const due = (await storage.getKeys("due"))
      .map((key) => ({ key, parsed: parseIndexKey(key) }))
      .filter((entry) => entry.parsed && entry.parsed.at <= now)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, tickLimit);
    for (const entry of due) {
      const id = entry.parsed!.id;
      const attempt = await claimAndRun(id, entry.key);
      if (attempt.started) result.started += 1;
      if (attempt.outcome !== "skipped") result[attempt.outcome] += 1;
    }

    const collectable = (await storage.getKeys("gc"))
      .map((key) => ({ key, parsed: parseIndexKey(key) }))
      .filter((entry) => entry.parsed && entry.parsed.at <= now);
    for (const entry of collectable) {
      const id = entry.parsed!.id;
      if (await withLock(`run:${id}`, () => removeExpiredRecord(storage, id, entry.key))) {
        result.removed += 1;
      }
    }
    return result;
  }

  /** Ticks never overlap in one process, whether the poller or the route started them. */
  function enqueueTick(): Promise<LocalJobsTickResult> {
    const next = tickChain.then(tick, tick);
    tickChain = next.catch(() => undefined);
    return next;
  }

  function notFound(task: JobsRuntimeTask, handleId: string) {
    return new JobsRuntimeError(`Run ${handleId} was not found for task "${task.key}".`, 404);
  }

  async function readTaskRun(task: JobsRuntimeTask, handleId: string) {
    if (!RUN_ID_PATTERN.test(handleId)) throw notFound(task, handleId);
    const record = await readRun(await store(), handleId);
    if (!record || record.task !== task.key) throw notFound(task, handleId);
    return record;
  }

  async function launch(
    task: JobsRuntimeTask,
    input: unknown,
    launchOptions: JobsResolvedLaunchOptions,
  ) {
    const storage = await store();
    const now = Date.now();
    const runAt =
      launchOptions.delay == null
        ? now
        : (resolveScheduledTimestamp(launchOptions, now, LOCAL_SCHEDULE_RUNTIME) ?? now);
    const id = `run_${randomHex()}`;
    const dueKey = indexKey("due", runAt, id);
    const record: LocalRunRecord = {
      v: 1,
      id,
      task: task.key,
      taskId: task.id,
      input,
      state: runAt > now ? "delayed" : "queued",
      attempt: 0,
      maxAttempts: launchOptions.retryAttempts ?? DEFAULT_ATTEMPTS,
      queuedAt: iso(now),
      runAt,
      startedAt: null,
      finishedAt: null,
      expiresAt: launchOptions.ttl == null ? null : runAt + resolveTtlMs(launchOptions.ttl),
      leaseId: null,
      dueKey,
      idempotencyKey: null,
      output: null,
      error: null,
      tags: launchOptions.tags ? [...launchOptions.tags] : [],
    };
    return { storage, record, dueKey, immediate: runAt <= now };
  }

  async function trigger(
    task: JobsRuntimeTask,
    input: unknown,
    launchOptions: JobsResolvedLaunchOptions,
  ) {
    ensurePolling();
    const create = async () => {
      const prepared = await launch(task, input, launchOptions);
      const { storage, record } = prepared;
      if (launchOptions.idempotencyKey) {
        const hashed = await sha256Hex(`${task.id}\n${launchOptions.idempotencyKey}`);
        const pointer = `idem:${hashed}`;
        const existingId = await storage.getItem(pointer);
        if (typeof existingId === "string") {
          const existing = await readRun(storage, existingId);
          if (existing && existing.task === task.key) {
            return { handleId: existing.id, queuedAt: existing.queuedAt, immediate: false };
          }
        }
        record.idempotencyKey = hashed;
        await writeRun(storage, record);
        await storage.setItem(prepared.dueKey, record.id);
        await storage.setItem(pointer, record.id);
      } else {
        await writeRun(storage, record);
        await storage.setItem(prepared.dueKey, record.id);
      }
      return { handleId: record.id, queuedAt: record.queuedAt, immediate: prepared.immediate };
    };

    const launched = launchOptions.idempotencyKey
      ? await withLock(`idem:${task.id}\n${launchOptions.idempotencyKey}`, create)
      : await create();
    if (launched.immediate) await startAfterResponse(launched.handleId);
    return { handleId: launched.handleId, queuedAt: launched.queuedAt };
  }

  return {
    capabilities: LOCAL_CAPABILITIES,
    trigger,
    async status(task, handleId) {
      ensurePolling();
      const record = await readTaskRun(task, handleId);
      return {
        status: toStatus(record.state),
        providerRunId: record.id,
        providerStatus: record.state,
        queuedAt: record.queuedAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        output: record.output,
        error: record.error,
        tags: record.tags,
        raw: {
          attempt: record.attempt,
          maxAttempts: record.maxAttempts,
          nextAttemptAt: TERMINAL_STATES.has(record.state) ? null : iso(record.runAt),
        },
      };
    },
    async cancel(task, handleId) {
      await readTaskRun(task, handleId);
      await withLock(`run:${handleId}`, async () => {
        const storage = await store();
        const record = await readRun(storage, handleId);
        if (!record) throw notFound(task, handleId);
        if (TERMINAL_STATES.has(record.state)) {
          throw new JobsRuntimeError(
            `Run ${handleId} already finished as "${record.state}".`,
            409,
            { code: "JOBS_RUN_FINISHED", runtime: "local", status: record.state },
          );
        }
        await finish(storage, record, "canceled", Date.now());
      });
      inFlight.get(handleId)?.abort(new Error("The run was canceled."));
    },
    routes: [
      {
        method: "GET",
        path: "tick",
        async verify(request) {
          const { authorizeCronRequest } = await import("@farm.js/core/cron");
          return authorizeCronRequest(request);
        },
        async handler() {
          return Response.json(await enqueueTick());
        },
      },
    ],
    start() {
      ensurePolling();
    },
    dispose() {
      disposed = true;
      if (poller) clearInterval(poller);
      poller = undefined;
    },
  };
}
