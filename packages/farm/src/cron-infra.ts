import type { FarmCronJob } from "./cron";
import { readFarmEnvironmentValue as readEnvironmentValue } from "./utils/runtime-env";

/** Which scheduler fires the app's cron jobs: the host's own, or Farm.js Infra. */
export type FarmCronScheduler = "host" | "farmjs";

export const FARM_CRON_SCHEDULER_ENV = "FARM_CRON_SCHEDULER";
export const DEFAULT_FARM_INFRA_API_URL = "https://app.farmjs.dev";

export interface FarmCronInfraEnv {
  scheduler: FarmCronScheduler;
  apiKey?: string;
  apiUrl: string;
  environment?: string;
  projectId?: string;
}

/**
 * Which scheduler this build targets. Connected (`FARMJS_API_KEY` present at build time) means
 * Farm.js Infra runs the schedules and the build writes no host cron output; exactly one scheduler
 * fires a job. `FARM_CRON_SCHEDULER=host` keeps the host's schedulers despite the key, and
 * `farmjs` asks for Infra explicitly, which then requires the key.
 */
export function resolveCronSchedulerEnv(
  env: (name: string) => string | undefined = readEnvironmentValue,
): FarmCronInfraEnv {
  const choice = env(FARM_CRON_SCHEDULER_ENV);
  if (choice !== undefined && choice !== "host" && choice !== "farmjs") {
    throw new Error(
      `\`${FARM_CRON_SCHEDULER_ENV}\` must be "host" or "farmjs", got ${JSON.stringify(choice)}. ` +
        `Unset it to let \`FARMJS_API_KEY\` decide.`,
    );
  }
  const apiKey = env("FARMJS_API_KEY") || undefined;
  if (choice === "farmjs" && !apiKey) {
    throw new Error(
      `\`${FARM_CRON_SCHEDULER_ENV}\` is "farmjs", but \`FARMJS_API_KEY\` is not set in the build ` +
        `environment, so Farm.js Infra cannot schedule this app's cron jobs.`,
    );
  }
  const scheduler: FarmCronScheduler = choice ?? (apiKey ? "farmjs" : "host");
  return {
    scheduler: apiKey ? scheduler : "host",
    apiKey,
    apiUrl: (env("FARMJS_API_URL") || DEFAULT_FARM_INFRA_API_URL).replace(/\/+$/, ""),
    environment: env("FARMJS_ENVIRONMENT") || undefined,
    projectId: env("FARMJS_PROJECT_ID") || undefined,
  };
}

/**
 * The origin Infra calls the jobs at. Explicit `FARM_SITE_URL` wins, then the platform's own
 * deployment URL. Never a request's Host header, and https only, matching the wakes API's rules.
 */
export function resolveCronEndpointOrigin(
  env: (name: string) => string | undefined = readEnvironmentValue,
): string | undefined {
  const explicit = env("FARM_SITE_URL");
  const candidate =
    explicit ||
    (env("VERCEL_PROJECT_PRODUCTION_URL") && `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}`) ||
    env("URL") ||
    undefined;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export interface RegisterCronJobsOptions {
  jobs: readonly FarmCronJob[];
  endpoint: string;
  infra: FarmCronInfraEnv;
  fetchImpl?: typeof globalThis.fetch;
}

/**
 * Registers this build's cron jobs with Farm.js Infra: `PUT /api/cron/jobs`, replace-all for this
 * endpoint, so Infra's schedule always matches the deployed app. A failure throws with the fix,
 * and the build fails: silently keeping host crons could double-fire later, and silently skipping
 * both means the jobs never fire.
 */
export async function registerCronJobsWithInfra(options: RegisterCronJobsOptions): Promise<number> {
  const { jobs, endpoint, infra } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {
    authorization: `Bearer ${infra.apiKey}`,
    "content-type": "application/json",
  };
  if (infra.environment) headers["x-farm-environment"] = infra.environment;
  if (infra.projectId) headers["x-farm-project"] = infra.projectId;
  const body = JSON.stringify({
    endpoint,
    jobs: jobs.map((job) => ({
      name: job.name,
      path: job.path,
      schedule: job.schedule,
      ...(job.description ? { description: job.description } : {}),
      ...(job.timeoutMs !== undefined ? { timeoutMs: job.timeoutMs } : {}),
    })),
  });
  let response: Response;
  try {
    response = await fetchImpl(`${infra.apiUrl}/api/cron/jobs`, { method: "PUT", headers, body });
  } catch (error) {
    throw new Error(
      `Farm.js Infra did not take this build's cron jobs (${
        error instanceof Error ? error.message : String(error)
      }). Retry the build, keep the host's schedulers with \`${FARM_CRON_SCHEDULER_ENV}=host\`, ` +
        `or unset \`FARMJS_API_KEY\` for the build.`,
    );
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(
      `Farm.js Infra refused this build's cron jobs (${response.status}${
        detail ? `: ${detail}` : ""
      }). The key needs the \`cron:jobs\` permission. Keep the host's schedulers with ` +
        `\`${FARM_CRON_SCHEDULER_ENV}=host\`, or unset \`FARMJS_API_KEY\` for the build.`,
    );
  }
  const accepted = (await response.json().catch(() => ({}))) as { accepted?: number };
  return typeof accepted.accepted === "number" ? accepted.accepted : jobs.length;
}
