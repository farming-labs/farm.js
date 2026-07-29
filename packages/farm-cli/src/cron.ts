import {
  loadConfig,
  logger,
  resolveConfig,
  type FarmCronJob,
  type FarmCronResolvedConfig,
} from "@farm.js/core";
import { Cron } from "croner";
import path from "node:path";

export interface FarmCronCLIOptions {
  root?: string;
  configPath?: string;
}

export interface RunFarmCronOptions extends FarmCronCLIOptions {
  url?: string;
  host?: string;
  port?: number | string;
  secret?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  trigger?: "manual" | "development";
}

export interface FarmCronRunResult {
  job: FarmCronJob;
  url: string;
  status: number;
  body: unknown;
  durationMs: number;
}

export interface FarmCronSchedulerEntry {
  job: FarmCronJob;
  schedule: string;
  timer: Cron;
}

export interface FarmCronScheduler {
  entries: FarmCronSchedulerEntry[];
  stop: () => void;
}

export async function loadFarmCronConfig(
  options: FarmCronCLIOptions = {},
): Promise<FarmCronResolvedConfig> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "development");
  if (!userConfig) {
    throw new Error("No Farm config found. Create farm.config.ts before configuring cron routes.");
  }

  const resolvedConfig = await resolveConfig({ root, ...userConfig }, "development");
  return resolvedConfig.cron;
}

export async function listFarmCronJobs(options: FarmCronCLIOptions = {}): Promise<FarmCronJob[]> {
  const cron = await loadFarmCronConfig(options);
  return cron.jobs;
}

export function formatFarmCronJobs(jobs: FarmCronJob[]): string {
  if (jobs.length === 0) return "No cron routes configured in farm.config.ts.";

  const rows = jobs.map((job) => [
    job.name,
    job.schedule.join(", "),
    job.path,
    job.description || "",
  ]);
  const headings = ["NAME", "SCHEDULE (UTC)", "ROUTE", "DESCRIPTION"];
  const widths = headings.map((heading, column) =>
    Math.max(heading.length, ...rows.map((row) => row[column].length)),
  );

  return [headings, ...rows]
    .map((row) =>
      row
        .map((value, column) => value.padEnd(widths[column]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

export async function runFarmCronJob(
  name: string,
  options: RunFarmCronOptions = {},
): Promise<FarmCronRunResult> {
  const cron = await loadFarmCronConfig(options);
  const job = cron.jobs.find((entry) => entry.name === name);
  if (!job) {
    const available = cron.jobs.map((entry) => entry.name).join(", ");
    throw new Error(
      available
        ? `Cron route ${JSON.stringify(name)} was not found. Available routes: ${available}.`
        : `Cron route ${JSON.stringify(name)} was not found. No cron routes are configured.`,
    );
  }

  return invokeFarmCronJob(job, cron, options);
}

export async function startFarmCronScheduler(
  options: RunFarmCronOptions = {},
): Promise<FarmCronScheduler> {
  const cron = await loadFarmCronConfig(options);
  const entries: FarmCronSchedulerEntry[] = [];

  for (const job of cron.jobs) {
    for (const schedule of job.schedule) {
      const timer = new Cron(
        schedule,
        {
          name: `farm:cron:${job.name}:${schedule}`,
          timezone: "UTC",
          protect: () => {
            logger.warn(`Cron ${job.name} skipped an overlapping run.`);
          },
          catch: (error) => {
            logger.error(`Cron ${job.name} failed: ${formatError(error)}`);
          },
        },
        async () => {
          logger.info(`Cron ${job.name} -> ${job.path}`);
          const result = await invokeFarmCronJob(job, cron, {
            ...options,
            trigger: "development",
          });
          logger.success(`Cron ${job.name} completed in ${result.durationMs}ms.`);
        },
      );
      entries.push({ job, schedule, timer });
    }
  }

  if (entries.length === 0) {
    logger.info("No cron routes are configured; the development scheduler is idle.");
  } else {
    logger.info(
      `Development cron scheduler started with ${entries.length} UTC schedule${entries.length === 1 ? "" : "s"}.`,
    );
    for (const entry of entries) {
      const nextRun = entry.timer.nextRun();
      logger.info(
        `Cron ${entry.job.name} (${entry.schedule}) next runs ${nextRun?.toISOString() || "never"}.`,
      );
    }
  }

  return {
    entries,
    stop() {
      for (const entry of entries) entry.timer.stop();
    },
  };
}

async function invokeFarmCronJob(
  job: FarmCronJob,
  cron: FarmCronResolvedConfig,
  options: RunFarmCronOptions,
): Promise<FarmCronRunResult> {
  const target = resolveCronTarget(job, options);
  const headers = new Headers({
    accept: "application/json",
    "x-farm-cron-name": job.name,
    "x-farm-cron-trigger": options.trigger || "manual",
  });
  const secret = options.secret ?? process.env[cron.secretEnv];
  if (secret) headers.set("authorization", `Bearer ${secret}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  timeout.unref?.();
  const startedAt = Date.now();

  try {
    const response = await (options.fetch || globalThis.fetch)(target, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const body = await readResponseBody(response);
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new Error(
        `Cron ${job.name} received ${response.status} from ${job.path}${formatResponseDetail(body)}.`,
      );
    }

    return {
      job,
      url: target,
      status: response.status,
      body,
      durationMs,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Cron ${job.name} timed out after ${options.timeoutMs ?? 10_000}ms.`);
    }
    if (error instanceof TypeError) {
      throw new Error(
        `Could not reach ${target}. Start the Farm dev server or pass --url to a running app.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveCronTarget(job: FarmCronJob, options: RunFarmCronOptions): string {
  const baseURL = options.url || `http://${options.host || "localhost"}:${options.port || 3000}`;
  const normalizedBase = baseURL.endsWith("/") ? baseURL : `${baseURL}/`;
  return new URL(job.path.replace(/^\/+/, ""), normalizedBase).toString();
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  if ((response.headers.get("content-type") || "").includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function formatResponseDetail(body: unknown): string {
  if (body === null || body === undefined || body === "") return "";
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  return detail ? `: ${detail}` : "";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
