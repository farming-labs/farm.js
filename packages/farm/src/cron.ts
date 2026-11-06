import type { TypedEndpoint } from "./api/endpoint";
import { farmSecretsMatch } from "./secret-compare";
import { toPosixPath } from "./utils";
import {
  getFarmRuntimeBindings,
  readFarmEnvironmentValue as readEnvironmentValue,
} from "./utils/runtime-env";

export type FarmCronSchedule = string | string[];

/** Who fires the schedules: the deployment target's own scheduler, or Farm.js Infra. */
export type FarmCronScheduler = "host" | "farmjs";

/** A JSON value, as route-level cron `input` must survive the build manifest unchanged. */
export type FarmCronInputValue =
  | string
  | number
  | boolean
  | null
  | FarmCronInputValue[]
  | { [key: string]: FarmCronInputValue };

/**
 * What a cron-guarded endpoint handler reads as `context.cron`. Only the endpoint form receives
 * it; a plain `(request) => ...` handler reads the `x-farm-cron-name` and
 * `x-farm-cron-scheduled-at` headers itself.
 */
export interface FarmCronContext {
  /** Job name from the `x-farm-cron-name` header; a direct platform call sends none. */
  name?: string;
  /** When the scheduler meant to fire, from `x-farm-cron-scheduled-at` (a millisecond epoch). */
  scheduledAt?: Date;
  /** The literal `input` from the route options; `undefined` when the options set none. */
  input: FarmCronInputValue | undefined;
  /** Aborts when the handler outlives the route's `timeoutMs`. */
  signal: AbortSignal;
}

export interface FarmCronJobConfig {
  /** Portable five-field cron expression, or a list of expressions. */
  schedule: FarmCronSchedule;
  /** Farm API route invoked with GET when the schedule fires. */
  path: string;
  /** Human-readable purpose shown by local tooling and deployment manifests. */
  description?: string;
  /** Disable this schedule without removing its configuration. */
  enabled?: boolean;
}

export interface FarmCronConfig {
  /**
   * Who runs the schedules. `farmjs` writes a manifest for `farm cron sync` after deployment;
   * `host` emits the deployment target's scheduler output. Credentials never select Infra.
   * @default "host"
   * @example { infra: "farmjs" }
   */
  infra: FarmCronScheduler;
  /** Named jobs, merged with route-local `cronRoute()` schedules. */
  jobs?: Record<string, FarmCronJobConfig>;
}

export type FarmCronUserConfig = Record<string, FarmCronJobConfig> | FarmCronConfig;

export interface FarmCronJob {
  name: string;
  schedule: string[];
  path: string;
  description?: string;
  /** Literal `input` from route-level options; config entries never carry one. */
  input?: FarmCronInputValue;
  /** Route-level `timeoutMs`, carried to the manifest so external schedulers can honor it. */
  timeoutMs?: number;
}

export interface FarmCronResolvedConfig {
  infra?: FarmCronScheduler;
  enabled: boolean;
  secretEnv: typeof DEFAULT_FARM_CRON_SECRET_ENV;
  jobs: FarmCronJob[];
}

export interface PreparedFarmCron {
  jobs: FarmCronJob[];
  tasks: Record<string, { handler: string; description: string }>;
  scheduledTasks: Record<string, string | string[]>;
  manifestPath?: string;
  /** Who fires the jobs: the host's schedulers, or Farm.js Infra (then the host outputs stay empty). */
  scheduler: FarmCronScheduler;
}

export interface FarmCronRouteOptions {
  /** Environment variable containing the bearer token. */
  secretEnv?: string;
  /** Inline token, primarily useful in tests. Environment variables are preferred. */
  secret?: string;
  /** Allow a production route without a secret. Defaults to false. */
  allowUnsecured?: boolean;
  /**
   * Schedule this route beside its code: one portable five-field UTC cron expression, or a list.
   * A route with a `schedule` is a cron job, equivalent to a `cron` config entry. The build reads
   * `schedule`, `name`, `description`, `input`, `timeoutMs`, and `enabled` statically from the
   * route file, so they must be written as literals in the `cronRoute()` call.
   */
  schedule?: FarmCronSchedule;
  /** Job name. Defaults to the route path without the leading `/api/`. */
  name?: string;
  /** Human-readable purpose shown by CLI output and the build manifest. */
  description?: string;
  /** JSON literal handed to the handler as `context.cron.input` (endpoint form only). */
  input?: FarmCronInputValue;
  /**
   * Milliseconds the handler may run. When it has not finished, `context.cron.signal` aborts and
   * the route answers 504; a handler that finishes first keeps its own result.
   */
  timeoutMs?: number;
  /**
   * `"skip"` answers 409 `{ skipped: true }` while a run of the same job is still going, without
   * running the handler. Per-process only in v1: replicas and serverless instances do not share
   * the in-flight set, so it is not a distributed lock.
   */
  overlap?: "skip";
  /**
   * `false` keeps the route callable with the same auth but removes it from scheduling outputs,
   * like a disabled `cron` config entry.
   */
  enabled?: boolean;
}

export interface FarmCronCloudflareConfig {
  deployConfig: true;
  wrangler: {
    triggers: {
      crons: string[];
    };
  };
}

export const DEFAULT_FARM_CRON_SECRET_ENV = "CRON_SECRET";
export const FARM_CRON_MANIFEST = "cron-manifest.json";

const CRON_FIELD_RANGES = [
  [0, 59, "minute"],
  [0, 23, "hour"],
  [1, 31, "day of month"],
  [1, 12, "month"],
  [0, 6, "day of week"],
] as const;

export function resolveCronConfig(
  cron: FarmCronResolvedConfig | FarmCronUserConfig | false | undefined,
): FarmCronResolvedConfig {
  if (isResolvedCronConfig(cron)) return cron;
  if (!cron) {
    return {
      enabled: false,
      secretEnv: DEFAULT_FARM_CRON_SECRET_ENV,
      jobs: [],
    };
  }

  if (typeof cron !== "object" || Array.isArray(cron)) {
    throw new TypeError("`cron` must be a job map, { infra, jobs }, or false.");
  }
  let infra: FarmCronScheduler | undefined;
  let entries: Record<string, FarmCronJobConfig>;
  // An object under `infra` is a job named "infra" in the flat job map, which stays valid.
  if ("infra" in cron && (typeof cron.infra !== "object" || cron.infra === null)) {
    if (cron.infra !== "host" && cron.infra !== "farmjs") {
      throw new TypeError(
        `\`cron.infra\` must be "host" or "farmjs", received ${JSON.stringify(cron.infra)}.`,
      );
    }
    infra = cron.infra;
    if (Object.keys(cron).some((key) => key !== "infra" && key !== "jobs")) {
      throw new TypeError("When `cron.infra` is set, place named jobs inside `cron.jobs`.");
    }
    const configured =
      (cron as FarmCronConfig).jobs === undefined ? {} : (cron as FarmCronConfig).jobs;
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
      throw new TypeError("`cron.jobs` must be a map of job names to configurations.");
    }
    entries = configured;
  } else {
    entries = cron as Record<string, FarmCronJobConfig>;
  }

  const jobs: FarmCronJob[] = [];
  for (const [name, job] of Object.entries(entries)) {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      throw new TypeError(`Farm cron ${JSON.stringify(name)} must be a configuration object.`);
    }
    if (job.enabled === false) continue;
    jobs.push(normalizeCronJob(name, job));
  }

  return {
    ...(infra ? { infra } : {}),
    enabled: jobs.length > 0,
    secretEnv: DEFAULT_FARM_CRON_SECRET_ENV,
    jobs,
  };
}

export async function prepareFarmCronForNitro(config: {
  root?: string;
  distDir?: string;
  cron?: FarmCronResolvedConfig | FarmCronUserConfig | false;
}): Promise<PreparedFarmCron> {
  const cron = isResolvedCronConfig(config.cron) ? config.cron : resolveCronConfig(config.cron);
  const root = config.root || process.cwd();
  const distDir = config.distDir || ".farm";
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const manifestPath = path.join(root, distDir, FARM_CRON_MANIFEST);
  const generatedDir = path.join(root, distDir, ".nitro", "farm-cron");
  const scheduler = cron.infra ?? "host";
  // Infra calls the canonical route path, like Vercel crons and Nitro tasks: the server answers
  // it whatever `basePath` or `api.basePath` add, and the signature covers that pathname.
  const manifest = createFarmCronManifest(cron, scheduler);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rm(generatedDir, { recursive: true, force: true });

  // Synchronizing is a post-deployment CLI action. A build cannot know whether its artifact
  // will become live, and must never replace the deployed application's schedules.
  if (!cron.enabled || scheduler === "farmjs") {
    return {
      jobs: cron.enabled ? cron.jobs : [],
      tasks: {},
      scheduledTasks: {},
      manifestPath,
      scheduler,
    };
  }

  await fs.mkdir(generatedDir, { recursive: true });

  const tasks: PreparedFarmCron["tasks"] = {};
  const wrapperNames = resolveCronWrapperFileNames(cron.jobs.map((job) => job.name));
  for (const job of cron.jobs) {
    const taskName = getFarmCronTaskName(job.name);
    const wrapperPath = toPosixPath(path.join(generatedDir, `${wrapperNames.get(job.name)}.mjs`));
    await fs.writeFile(wrapperPath, createNitroCronTaskWrapper(job, cron.secretEnv), "utf8");
    tasks[taskName] = {
      handler: wrapperPath,
      description: job.description || `Farm cron ${job.name}`,
    };
  }

  return {
    jobs: cron.jobs,
    tasks,
    scheduledTasks: createCronScheduledTasks(cron.jobs),
    manifestPath,
    scheduler: "host",
  };
}

export function createFarmCronManifest(
  cron: FarmCronResolvedConfig,
  scheduler: FarmCronScheduler = cron.infra ?? "host",
) {
  return {
    schemaVersion: 1,
    scheduler,
    secretEnv: cron.secretEnv,
    jobs: (cron.enabled ? cron.jobs : []).map((job) => ({
      name: job.name,
      schedule: job.schedule,
      path: job.path,
      description: job.description || null,
      ...(job.timeoutMs !== undefined ? { timeoutMs: job.timeoutMs } : {}),
      ...(job.input !== undefined ? { input: job.input } : {}),
    })),
  };
}

export function createFarmCronVercelCrons(
  jobs: FarmCronJob[],
): Array<{ path: string; schedule: string }> {
  return jobs.flatMap((job) =>
    job.schedule.map((schedule) => ({
      path: job.path,
      schedule,
    })),
  );
}

export function applyFarmCronVercelCrons(
  vercelConfig: Record<string, any>,
  jobs: FarmCronJob[],
): Record<string, any> {
  const existingCrons = Array.isArray(vercelConfig.crons) ? vercelConfig.crons : [];
  const seen = new Set(existingCrons.map((cron) => `${cron.path}:${cron.schedule}`));
  const crons = [...existingCrons];

  for (const cron of createFarmCronVercelCrons(jobs)) {
    const key = `${cron.path}:${cron.schedule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    crons.push(cron);
  }

  return crons.length > 0 ? { ...vercelConfig, crons } : vercelConfig;
}

export function createFarmCronCloudflareTriggers(jobs: FarmCronJob[]): string[] {
  return [...new Set(jobs.flatMap((job) => job.schedule))];
}

export function createFarmCronCloudflareConfig(
  jobs: FarmCronJob[],
): FarmCronCloudflareConfig | undefined {
  const crons = createFarmCronCloudflareTriggers(jobs);
  if (crons.length === 0) return undefined;

  return {
    deployConfig: true,
    wrangler: {
      triggers: { crons },
    },
  };
}

export function mergeScheduledTasks(
  ...maps: Array<Record<string, string | string[]> | undefined>
): Record<string, string | string[]> {
  const merged = new Map<string, string[]>();

  for (const map of maps) {
    for (const [schedule, taskNames] of Object.entries(map || {})) {
      const current = merged.get(schedule) || [];
      for (const taskName of Array.isArray(taskNames) ? taskNames : [taskNames]) {
        if (!current.includes(taskName)) current.push(taskName);
      }
      merged.set(schedule, current);
    }
  }

  return Object.fromEntries(
    [...merged].map(([schedule, taskNames]) => [
      schedule,
      taskNames.length === 1 ? taskNames[0] : taskNames,
    ]),
  );
}

/**
 * Whether the process explicitly declares a development or test environment.
 *
 * An absent NODE_ENV is not a development signal. Plenty of container images and
 * serverless runtimes leave it unset, so treating "not production" as
 * development leaves an unsecured cron route open wherever the variable simply
 * was never set. Matches the fail-closed gate the auth0 and workos integrations
 * use for their development secrets.
 */
function isExplicitDevelopmentEnv(): boolean {
  const nodeEnv = readEnvironmentValue("NODE_ENV");
  return nodeEnv === "development" || nodeEnv === "test";
}

export function isCronRequestAuthorized(
  request: Request,
  options: FarmCronRouteOptions = {},
): boolean {
  const secretEnv = options.secretEnv || DEFAULT_FARM_CRON_SECRET_ENV;
  const secret = options.secret || readEnvironmentValue(secretEnv);
  if (!secret) {
    return (
      options.allowUnsecured === true || (!getFarmRuntimeBindings() && isExplicitDevelopmentEnv())
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = /^Bearer (.*)$/i.exec(authorization)?.[1] || "";
  const headerSecret = request.headers.get("x-farm-cron-secret") || "";
  // Both are checked so a caller may use either header; neither short-circuits
  // on the first differing character.
  return farmSecretsMatch(bearer, secret) || farmSecretsMatch(headerSecret, secret);
}

/** A `createEndpoint()` result: Farm's route runtime calls `__handler` with the parsed context. */
type FarmCronEndpoint = TypedEndpoint<any, any, any, any, any, any, any, any>;

/**
 * Jobs with a run still going in this process, keyed by job name, or by route identity when the
 * options set no name. Per-process by design (v1): a distributed lock belongs to the application.
 */
const inFlightCronRuns = new Set<unknown>();

interface FarmCronRunControls {
  timeoutMs: number | undefined;
  /** `undefined` means overlapping runs are allowed. */
  overlapKey: unknown;
}

function resolveCronRunControls(options: FarmCronRouteOptions): FarmCronRunControls {
  if (
    options.timeoutMs !== undefined &&
    (typeof options.timeoutMs !== "number" ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0)
  ) {
    throw new TypeError(
      `Farm cron \`timeoutMs\` must be a positive number of milliseconds; received ${JSON.stringify(options.timeoutMs)}. Remove the option or set a positive number.`,
    );
  }
  if (options.overlap !== undefined && options.overlap !== "skip") {
    throw new TypeError(
      `Farm cron \`overlap\` only supports "skip"; received ${JSON.stringify(options.overlap)}. Remove the option to allow overlapping runs.`,
    );
  }
  return {
    timeoutMs: options.timeoutMs,
    // A fresh object is this route's identity, so unnamed routes never skip each other.
    overlapKey: options.overlap === "skip" ? (options.name ?? {}) : undefined,
  };
}

function cronSkippedResponse(): Response {
  return Response.json({ skipped: true }, { status: 409 });
}

function cronTimeoutResponse(timeoutMs: number): Response {
  return Response.json(
    {
      error: `The cron handler did not finish within its \`timeoutMs\` of ${timeoutMs} milliseconds. Raise \`timeoutMs\` or make the handler finish sooner.`,
    },
    { status: 504 },
  );
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * Run one cron invocation under the route's `overlap` and `timeoutMs` controls. The in-flight
 * mark is held until the handler itself settles, not until the timeout answers, so a timed-out
 * run still counts as going for `overlap: "skip"`. The timer is cleared as soon as the handler
 * settles.
 */
function runCronRouteControlled<T>(
  controls: FarmCronRunControls,
  controller: AbortController | undefined,
  run: () => unknown,
  onSkip: () => T,
  onTimeout: () => T,
): unknown {
  const { overlapKey, timeoutMs } = controls;
  if (overlapKey !== undefined) {
    if (inFlightCronRuns.has(overlapKey)) return onSkip();
    inFlightCronRuns.add(overlapKey);
  }
  const release = () => {
    if (overlapKey !== undefined) inFlightCronRuns.delete(overlapKey);
  };

  let outcome: unknown;
  try {
    outcome = run();
  } catch (error) {
    release();
    throw error;
  }
  if (!isThenable(outcome)) {
    release();
    return outcome;
  }

  const pending = Promise.resolve(outcome);
  if (timeoutMs === undefined) return pending.finally(release);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort(
        new Error(
          `The cron handler did not finish within its \`timeoutMs\` of ${timeoutMs} milliseconds.`,
        ),
      );
      resolve(onTimeout());
    }, timeoutMs);
    // After a timeout already resolved, these settle calls are no-ops; they still clear the
    // timer and release the in-flight mark the moment the abandoned handler settles.
    pending.then(
      (value) => {
        clearTimeout(timer);
        release();
        resolve(value as T);
      },
      (error) => {
        clearTimeout(timer);
        release();
        reject(error);
      },
    );
  });
}

function createFarmCronRequestContext(
  request: Request,
  options: FarmCronRouteOptions,
  signal: AbortSignal,
): FarmCronContext {
  const name = request.headers.get("x-farm-cron-name") || undefined;
  const scheduledAtHeader = request.headers.get("x-farm-cron-scheduled-at")?.trim() || "";
  const scheduledAtMs = /^\d+$/.test(scheduledAtHeader) ? Number(scheduledAtHeader) : Number.NaN;
  // A header that is not a safe millisecond epoch reads as absent, never as an Invalid Date.
  const scheduledAt = Number.isSafeInteger(scheduledAtMs) ? new Date(scheduledAtMs) : undefined;
  return {
    ...(name !== undefined ? { name } : {}),
    ...(scheduledAt !== undefined ? { scheduledAt } : {}),
    input: options.input,
    signal,
  };
}

/**
 * Guards an API route so only the scheduler can call it: a `createEndpoint()` result, which keeps its
 * validation, types and metadata, or a plain handler that receives the `Request`.
 *
 * Options may also carry the job's `schedule` and its scheduling fields beside the code; the
 * build reads them statically, so they must be literals in the call. `timeoutMs` and
 * `overlap: "skip"` guard both forms at runtime; `context.cron` is endpoint-form only, a plain
 * handler reads the cron headers from its `Request` itself.
 */
/** Header carrying Farm.js Infra's signature on a scheduled call. */
export const FARM_CRON_SIGNATURE_HEADER = "farmjs-signature";
const CRON_SIGNATURE_VERSION = "farmjs-cron-v1";
const CRON_SIGNATURE_WINDOW_SECONDS = 300;
const CRON_SIGNATURE_PATTERN = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

function toHex(buffer: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * @internal Exported for tests. `v1` of a scheduled call's `farmjs-signature`: HMAC-SHA256 keyed
 * with the hex SHA-256 of `FARMJS_API_KEY` (as text), over `farmjs-cron-v1\n<t>\nGET <pathname>`.
 * Web Crypto only, so the same code runs on Workers.
 */
export async function farmCronSignature(
  apiKey: string,
  t: number,
  pathname: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(apiKey));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(toHex(digest)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${CRON_SIGNATURE_VERSION}\n${t}\nGET ${pathname}`),
  );
  return toHex(mac);
}

/**
 * Whether a scheduler may run this cron request: the configured secret
 * (`isCronRequestAuthorized`), or Farm.js Infra's `farmjs-signature`, verified with the
 * `FARMJS_API_KEY` the runtime already has. No key in the runtime means signatures never verify.
 */
export async function authorizeCronRequest(
  request: Request,
  options: FarmCronRouteOptions = {},
  now = Date.now(),
): Promise<boolean> {
  if (isCronRequestAuthorized(request, options)) return true;
  const header = request.headers.get(FARM_CRON_SIGNATURE_HEADER);
  if (!header) return false;
  // Infra signs GET only; a Request-like object without a method or URL cannot be verified.
  if (typeof request.method !== "string" || request.method.toUpperCase() !== "GET") return false;
  if (typeof request.url !== "string") return false;
  const parsed = CRON_SIGNATURE_PATTERN.exec(header.trim());
  if (!parsed) return false;
  const t = Number(parsed[1]);
  if (Math.abs(now / 1000 - t) > CRON_SIGNATURE_WINDOW_SECONDS) return false;
  const apiKey = readEnvironmentValue("FARMJS_API_KEY");
  if (!apiKey) return false;
  let pathname: string;
  try {
    const url = new URL(request.url);
    // Infra never schedules query input, and its v1 signature covers only the pathname.
    if (url.search) return false;
    pathname = url.pathname;
  } catch {
    return false;
  }
  const expected = await farmCronSignature(apiKey, t, pathname);
  return farmSecretsMatch(parsed[2]!, expected);
}

export function cronRoute<TEndpoint extends FarmCronEndpoint>(
  endpoint: TEndpoint,
  options?: FarmCronRouteOptions,
): TEndpoint;
export function cronRoute<TArgs extends unknown[], TResult>(
  handler: (request: Request, ...args: TArgs) => TResult,
  options?: FarmCronRouteOptions,
): (request: Request, ...args: TArgs) => TResult | Promise<Response>;
export function cronRoute(
  handler: ((request: Request, ...args: unknown[]) => unknown) | FarmCronEndpoint,
  options: FarmCronRouteOptions = {},
): unknown {
  const controls = resolveCronRunControls(options);
  if (isFarmEndpoint(handler)) return guardCronEndpoint(handler, options, controls);
  const route = handler as (request: Request, ...args: unknown[]) => unknown;
  return async (request: Request, ...args: unknown[]) => {
    if (!(await authorizeCronRequest(request, options))) {
      return unauthorizedCronResponse();
    }
    return runCronRouteControlled(
      controls,
      undefined,
      () => route(request, ...args),
      cronSkippedResponse,
      () => cronTimeoutResponse(controls.timeoutMs!),
    );
  };
}

function unauthorizedCronResponse(): Response {
  return Response.json({ error: "Unauthorized cron request." }, { status: 401 });
}

function isFarmEndpoint(value: unknown): value is FarmCronEndpoint & EndpointInternals {
  return (
    typeof value === "function" &&
    typeof (value as unknown as EndpointInternals).__handler === "function"
  );
}

interface EndpointInternals {
  __handler: (context: { request?: Request }) => unknown;
  __farmInvoke?: (context: { request?: Request; context?: unknown }) => unknown;
}

// Function own properties that describe the function itself, not the endpoint.
const FUNCTION_OWN_KEYS = new Set(["length", "name", "prototype", "arguments", "caller"]);

/**
 * The same endpoint, with every way of invoking it checking the request first. A context with no
 * request is refused, so a caller that cannot prove it is the scheduler never runs the handler.
 * An authorized invocation receives `context.cron` and runs under the route's `timeoutMs` and
 * `overlap` controls.
 */
function guardCronEndpoint(
  endpoint: FarmCronEndpoint & EndpointInternals,
  options: FarmCronRouteOptions,
  controls: FarmCronRunControls,
): FarmCronEndpoint {
  // Duck-typed: a Node server can pass a Request-like object that is not the global class.
  const allowed = async (context: { request?: unknown } | undefined) => {
    const request = context?.request as Request | undefined;
    if (typeof request?.headers?.get !== "function") return false;
    return authorizeCronRequest(request, options);
  };
  const withCron = (context: { request?: unknown; context?: unknown }) => {
    const controller = new AbortController();
    const cron = createFarmCronRequestContext(
      context.request as Request,
      options,
      controller.signal,
    );
    // `allowed()` already proved the duck-typed request; the spread keeps every other field.
    const invocation = {
      ...context,
      context: { ...(context.context as Record<string, unknown> | undefined), cron },
    } as { request?: Request; context?: unknown };
    return { controller, invocation };
  };
  const guarded = async function (this: unknown, context?: { request?: unknown }) {
    if (!(await allowed(context))) return unauthorizedCronResponse();
    const { controller, invocation } = withCron(context!);
    return runCronRouteControlled(
      controls,
      controller,
      () => (endpoint as (...args: unknown[]) => unknown).call(this, invocation),
      cronSkippedResponse,
      () => cronTimeoutResponse(controls.timeoutMs!),
    );
  } as unknown as FarmCronEndpoint & EndpointInternals;
  for (const key of Reflect.ownKeys(endpoint)) {
    if (typeof key === "string" && FUNCTION_OWN_KEYS.has(key)) continue;
    Object.defineProperty(guarded, key, Object.getOwnPropertyDescriptor(endpoint, key)!);
  }
  guarded.__handler = async (context) => {
    if (!(await allowed(context))) return unauthorizedCronResponse();
    const { controller, invocation } = withCron(context);
    return runCronRouteControlled(
      controls,
      controller,
      () => endpoint.__handler(invocation),
      cronSkippedResponse,
      () => cronTimeoutResponse(controls.timeoutMs!),
    );
  };
  const invoke = endpoint.__farmInvoke;
  if (invoke) {
    guarded.__farmInvoke = async (context) => {
      // A skipped or timed-out run reports `handlerExecuted: false`: the run was refused or
      // abandoned, so its result and invalidations are not this response's to claim.
      const denied = (result: Response) => ({
        result,
        context: context.context,
        handlerExecuted: false,
        invalidations: [] as const,
      });
      if (!(await allowed(context))) return denied(unauthorizedCronResponse());
      const { controller, invocation } = withCron(context);
      return runCronRouteControlled(
        controls,
        controller,
        () => invoke(invocation),
        () => denied(cronSkippedResponse()),
        () => denied(cronTimeoutResponse(controls.timeoutMs!)),
      );
    };
  }
  return guarded;
}

/** @internal One segment of a cron job name; route-level names join segments with `/`. */
export const FARM_CRON_NAME_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function normalizeCronJob(name: string, job: FarmCronJobConfig): FarmCronJob {
  if (!FARM_CRON_NAME_SEGMENT_PATTERN.test(name)) {
    throw new TypeError(
      `Farm cron name ${JSON.stringify(name)} must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new TypeError(`Farm cron ${JSON.stringify(name)} must be a configuration object.`);
  }

  const path = normalizeCronPath(name, job.path);
  const rawSchedule = Array.isArray(job.schedule) ? job.schedule : [job.schedule];
  const schedule = [...new Set(rawSchedule.map((value) => normalizeCronExpression(name, value)))];
  if (schedule.length === 0) {
    throw new TypeError(`Farm cron ${JSON.stringify(name)} must define at least one schedule.`);
  }

  return {
    name,
    schedule,
    path,
    description: job.description?.trim() || undefined,
  };
}

function normalizeCronPath(name: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim().startsWith("/")) {
    throw new TypeError(`Farm cron ${JSON.stringify(name)} path must start with "/".`);
  }

  const hasUnstableCharacters = (candidate: string) =>
    candidate.includes("\\") ||
    Array.from(candidate).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    });
  if (hasUnstableCharacters(value)) {
    throw new TypeError(
      `Farm cron ${JSON.stringify(name)} path cannot contain backslashes or control characters.`,
    );
  }

  const path = value.trim();
  if (path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new TypeError(
      `Farm cron ${JSON.stringify(name)} path must be an application pathname without a host, query, or hash.`,
    );
  }
  for (const segment of path.split("/")) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escapes remain literal and cannot conceal a separator or dot segment.
    }
    if (hasUnstableCharacters(decoded)) {
      throw new TypeError(
        `Farm cron ${JSON.stringify(name)} path cannot contain backslashes or control characters.`,
      );
    }
    if (decoded.includes("/")) {
      throw new TypeError(
        `Farm cron ${JSON.stringify(name)} path cannot contain percent-encoded path separators.`,
      );
    }
    if (decoded === "." || decoded === "..") {
      throw new TypeError(
        `Farm cron ${JSON.stringify(name)} path cannot contain "." or ".." path segments.`,
      );
    }
  }
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** @internal Validate and normalize one cron expression; the build scan reuses config's rules. */
export function normalizeCronExpression(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(`Farm cron ${JSON.stringify(name)} schedule must be a string.`);
  }

  const expression = value.trim().replace(/\s+/g, " ");
  const fields = expression.split(" ");
  if (fields.length !== CRON_FIELD_RANGES.length) {
    throw new TypeError(
      `Farm cron ${JSON.stringify(name)} schedule ${JSON.stringify(expression)} must use five fields: minute hour day-of-month month day-of-week.`,
    );
  }

  fields.forEach((field, index) => {
    const [minimum, maximum, label] = CRON_FIELD_RANGES[index];
    validateCronField(name, expression, field, minimum, maximum, label);
  });
  if (fields[2] !== "*" && fields[4] !== "*") {
    throw new TypeError(
      `Farm cron ${JSON.stringify(name)} schedule ${JSON.stringify(expression)} cannot constrain both day-of-month and day-of-week.`,
    );
  }
  return expression;
}

function validateCronField(
  name: string,
  expression: string,
  field: string,
  minimum: number,
  maximum: number,
  label: string,
): void {
  for (const segment of field.split(",")) {
    const [range, stepText, ...extra] = segment.split("/");
    if (!range || extra.length > 0 || (stepText !== undefined && !isIntegerInRange(stepText, 1))) {
      throwInvalidCronField(name, expression, label);
    }

    if (range === "*") continue;
    const bounds = range.split("-");
    if (bounds.length > 2 || !bounds.every((value) => isIntegerInRange(value, minimum, maximum))) {
      throwInvalidCronField(name, expression, label);
    }
    if (bounds.length === 2 && Number(bounds[0]) > Number(bounds[1])) {
      throwInvalidCronField(name, expression, label);
    }
  }
}

function isIntegerInRange(value: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return parsed >= minimum && parsed <= maximum;
}

function throwInvalidCronField(name: string, expression: string, label: string): never {
  throw new TypeError(
    `Farm cron ${JSON.stringify(name)} schedule ${JSON.stringify(expression)} has an invalid ${label} field.`,
  );
}

function isResolvedCronConfig(value: unknown): value is FarmCronResolvedConfig {
  return (
    !!value &&
    typeof value === "object" &&
    "enabled" in value &&
    typeof (value as FarmCronResolvedConfig).enabled === "boolean" &&
    "jobs" in value &&
    Array.isArray((value as FarmCronResolvedConfig).jobs) &&
    "secretEnv" in value
  );
}

function createCronScheduledTasks(jobs: FarmCronJob[]): Record<string, string | string[]> {
  const scheduledTasks: Record<string, string | string[]> = {};
  for (const job of jobs) {
    const taskName = getFarmCronTaskName(job.name);
    for (const schedule of job.schedule) {
      scheduledTasks[schedule] = mergeTaskNames(scheduledTasks[schedule], taskName);
    }
  }
  return scheduledTasks;
}

function mergeTaskNames(
  current: string | string[] | undefined,
  taskName: string,
): string | string[] {
  if (!current) return taskName;
  const names = Array.isArray(current) ? current : [current];
  return names.includes(taskName) ? names : [...names, taskName];
}

function getFarmCronTaskName(name: string): string {
  return `farm:cron:${name}`;
}

function createNitroCronTaskWrapper(job: FarmCronJob, secretEnv: string): string {
  return `
import { useNitroApp } from "nitro/app";
import { defineTask } from "nitro/task";

const name = ${JSON.stringify(job.name)};
const path = ${JSON.stringify(job.path)};
const secretEnv = ${JSON.stringify(secretEnv)};

function readSecret(event) {
  const runtimeEnv = event?.context?.cloudflare?.env || event?.context?.env || {};
  return runtimeEnv[secretEnv] || (typeof process !== "undefined" ? process.env?.[secretEnv] : "") || "";
}

export default defineTask({
  meta: {
    name: ${JSON.stringify(getFarmCronTaskName(job.name))},
    description: ${JSON.stringify(job.description || `Farm cron ${job.name}`)}
  },
  async run(event) {
    const headers = new Headers({
      "x-farm-cron-name": name,
      "x-farm-cron-scheduled-at": String(event?.payload?.scheduledTime || Date.now())
    });
    const secret = readSecret(event);
    if (secret) headers.set("authorization", "Bearer " + secret);

    const response = await useNitroApp().fetch(path, { method: "GET", headers });
    const contentType = response.headers.get("content-type") || "";
    const body = response.status === 204
      ? null
      : contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text();

    if (!response.ok) {
      const detail = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(
        "Farm cron " + JSON.stringify(name) + " received " + response.status +
        " from " + path + (detail ? ": " + detail : "")
      );
    }

    return { result: body };
  }
});
`.trim();
}

/**
 * Wrapper file names for a set of cron job names.
 *
 * Cron names are case-sensitive and `Daily` and `daily` are both valid, distinct
 * jobs — but macOS and Windows use case-insensitive filesystems by default, so
 * their wrappers would overwrite one another and both jobs would run whichever
 * file was written last. Names are only disambiguated when they actually
 * collide case-insensitively, so ordinary names such as `dailyCleanup` keep a
 * readable wrapper; every name in a colliding group gets a digest of the exact
 * job name appended, which keeps the result independent of configuration order.
 */
function resolveCronWrapperFileNames(names: readonly string[]): Map<string, string> {
  const groups = new Map<string, number>();
  for (const name of names) {
    const key = safeFileName(name).toLowerCase();
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  const resolved = new Map<string, string>();
  const claimed = new Map<string, string>();
  for (const name of names) {
    const base = safeFileName(name);
    const key = base.toLowerCase();
    const fileName = (groups.get(key) ?? 0) > 1 ? `${key}-${cronNameFingerprint(name)}` : base;
    const claimedBy = claimed.get(fileName.toLowerCase());
    if (claimedBy !== undefined) {
      throw new Error(
        `Farm cron jobs ${JSON.stringify(claimedBy)} and ${JSON.stringify(name)} generate the same wrapper file ${JSON.stringify(`${fileName}.mjs`)}. Rename one of them.`,
      );
    }
    claimed.set(fileName.toLowerCase(), name);
    resolved.set(name, fileName);
  }
  return resolved;
}

/**
 * FNV-1a. This module is bundled into server runtimes without node:crypto, and
 * the digest only needs to separate file names.
 */
function cronNameFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-") || "cron";
}
