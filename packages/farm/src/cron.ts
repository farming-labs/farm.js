export type FarmCronSchedule = string | string[];

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

export type FarmCronUserConfig = Record<string, FarmCronJobConfig>;

export interface FarmCronJob {
  name: string;
  schedule: string[];
  path: string;
  description?: string;
}

export interface FarmCronResolvedConfig {
  enabled: boolean;
  secretEnv: typeof DEFAULT_FARM_CRON_SECRET_ENV;
  jobs: FarmCronJob[];
}

export interface PreparedFarmCron {
  jobs: FarmCronJob[];
  tasks: Record<string, { handler: string; description: string }>;
  scheduledTasks: Record<string, string | string[]>;
  manifestPath?: string;
}

export interface FarmCronRouteOptions {
  /** Environment variable containing the bearer token. */
  secretEnv?: string;
  /** Inline token, primarily useful in tests. Environment variables are preferred. */
  secret?: string;
  /** Allow a production route without a secret. Defaults to false. */
  allowUnsecured?: boolean;
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

  const jobs: FarmCronJob[] = [];
  for (const [name, job] of Object.entries(cron)) {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      throw new TypeError(`Farm cron ${JSON.stringify(name)} must be a configuration object.`);
    }
    if (job.enabled === false) continue;
    jobs.push(normalizeCronJob(name, job));
  }

  return {
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

  if (!cron.enabled) {
    await Promise.all([
      fs.rm(manifestPath, { force: true }),
      fs.rm(generatedDir, { recursive: true, force: true }),
    ]);
    return {
      jobs: [],
      tasks: {},
      scheduledTasks: {},
    };
  }

  await fs.rm(generatedDir, { recursive: true, force: true });
  await fs.mkdir(generatedDir, { recursive: true });

  const tasks: PreparedFarmCron["tasks"] = {};
  for (const job of cron.jobs) {
    const taskName = getFarmCronTaskName(job.name);
    const wrapperPath = path.join(generatedDir, `${safeFileName(job.name)}.mjs`);
    await fs.writeFile(wrapperPath, createNitroCronTaskWrapper(job, cron.secretEnv), "utf8");
    tasks[taskName] = {
      handler: wrapperPath,
      description: job.description || `Farm cron ${job.name}`,
    };
  }

  const manifest = createFarmCronManifest(cron);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    jobs: cron.jobs,
    tasks,
    scheduledTasks: createCronScheduledTasks(cron.jobs),
    manifestPath,
  };
}

export function createFarmCronManifest(cron: FarmCronResolvedConfig) {
  return {
    schemaVersion: 1,
    secretEnv: cron.secretEnv,
    jobs: cron.jobs.map((job) => ({
      name: job.name,
      schedule: job.schedule,
      path: job.path,
      description: job.description || null,
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

export function isCronRequestAuthorized(
  request: Request,
  options: FarmCronRouteOptions = {},
): boolean {
  const secretEnv = options.secretEnv || DEFAULT_FARM_CRON_SECRET_ENV;
  const secret = options.secret || readEnvironmentValue(secretEnv);
  if (!secret) {
    return (
      options.allowUnsecured === true ||
      (!getFarmRuntimeBindings() && readEnvironmentValue("NODE_ENV") !== "production")
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return bearer === secret || request.headers.get("x-farm-cron-secret") === secret;
}

export function cronRoute<TArgs extends unknown[], TResult>(
  handler: (request: Request, ...args: TArgs) => TResult,
  options: FarmCronRouteOptions = {},
): (request: Request, ...args: TArgs) => TResult | Promise<Response> {
  return (request, ...args) => {
    if (!isCronRequestAuthorized(request, options)) {
      return Promise.resolve(
        Response.json({ error: "Unauthorized cron request." }, { status: 401 }),
      );
    }
    return handler(request, ...args);
  };
}

function normalizeCronJob(name: string, job: FarmCronJobConfig): FarmCronJob {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
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

  const path = value.trim();
  if (path.startsWith("//") || path.includes("?") || path.includes("#")) {
    throw new TypeError(
      `Farm cron ${JSON.stringify(name)} path must be an application pathname without a host, query, or hash.`,
    );
  }
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function normalizeCronExpression(name: string, value: unknown): string {
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
import { defineTask, useNitroApp } from "nitro/runtime";

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

function readEnvironmentValue(name: string): string | undefined {
  const runtimeValue = getFarmRuntimeBindings()?.[name];
  if (typeof runtimeValue === "string") return runtimeValue;
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function getFarmRuntimeBindings(): Record<string, unknown> | undefined {
  const runtimeBindings = (globalThis as typeof globalThis & {
    __env__?: Record<string, unknown>;
  }).__env__;
  return runtimeBindings && typeof runtimeBindings === "object" ? runtimeBindings : undefined;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-") || "cron";
}
