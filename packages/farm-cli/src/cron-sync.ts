import fs from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { resolveCronConfig, type FarmCronJob, type FarmCronProvider } from "@farm.js/core/cron";

const DEFAULT_FARMJS_API_URL = "https://app.farmjs.dev";
const FARMJS_ENVIRONMENTS = ["production", "staging", "development"] as const;
const SYNC_TIMEOUT_MS = 15_000;

export interface SyncFarmCronOptions {
  root?: string;
  /** Built manifest, relative to `root`. */
  manifest?: string;
  /** The deployed app's public HTTPS origin, which Infra calls. */
  url: string;
  /** Replace the endpoint's Infra schedules. Without it, only the plan is returned. */
  apply?: boolean;
  /** Allow an applied sync to clear every schedule for the endpoint. */
  allowDelete?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface FarmCronSyncResult {
  schemaVersion: 1;
  applied: boolean;
  endpoint: string;
  apiUrl: string;
  environment: string;
  projectId: string | null;
  provider: FarmCronProvider;
  jobs: FarmCronJob[];
  accepted?: number;
}

export type FarmCronSyncErrorCode =
  | "INVALID_OPTION"
  | "MANIFEST_READ_FAILED"
  | "INVALID_MANIFEST"
  | "DELETE_NOT_ALLOWED"
  | "MISSING_API_KEY"
  | "SYNC_FAILED";

export class FarmCronSyncError extends Error {
  readonly code: FarmCronSyncErrorCode;
  readonly cause?: unknown;

  constructor(code: FarmCronSyncErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "FarmCronSyncError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function origin(value: string, key: string, api = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FarmCronSyncError(
      "INVALID_OPTION",
      `\`${key}\` must be an HTTPS origin such as https://app.example.com.`,
    );
  }
  const host = url.hostname.replace(/\.$/, "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (
    (url.protocol !== "https:" && !(api && loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    /[?#\s]/.test(value) ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    (!api &&
      (loopback ||
        isIP(host.replace(/^\[|\]$/g, "")) ||
        host.endsWith(".localhost") ||
        host.endsWith(".local")))
  ) {
    throw new FarmCronSyncError(
      "INVALID_OPTION",
      `\`${key}\` must be a public HTTPS origin without credentials, a path, query, or fragment.`,
    );
  }
  return url.origin;
}

function readManifest(value: unknown): { provider: FarmCronProvider; jobs: FarmCronJob[] } {
  const invalid = (reason: string) =>
    new FarmCronSyncError(
      "INVALID_MANIFEST",
      `Invalid cron manifest: ${reason}. Rebuild with \`farm build\` and pass its \`cron-manifest.json\` with \`--manifest\`.`,
    );
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.jobs)) {
    throw invalid("expected `schemaVersion: 1` and a `jobs` array");
  }
  const provider = value.provider ?? "host";
  if (provider !== "host" && provider !== "farmjs") {
    throw invalid('`provider` must be "host" or "farmjs"');
  }
  const names = new Set<string>();
  const jobs = value.jobs.map((entry: unknown): FarmCronJob => {
    if (!record(entry) || typeof entry.name !== "string") throw invalid("every job needs a name");
    if (names.has(entry.name)) throw invalid(`job ${JSON.stringify(entry.name)} appears twice`);
    names.add(entry.name);
    if (!Array.isArray(entry.schedule) || entry.schedule.length === 0) {
      throw invalid(`job ${JSON.stringify(entry.name)} has no schedule`);
    }
    if (
      entry.description !== undefined &&
      entry.description !== null &&
      typeof entry.description !== "string"
    ) {
      throw invalid(`job ${JSON.stringify(entry.name)} has a non-string description`);
    }
    let resolved: FarmCronJob | undefined;
    try {
      // The same normalization as `farm build`, so a hand-edited manifest cannot register a
      // schedule or path the config would have rejected.
      resolved = resolveCronConfig({
        [entry.name]: {
          schedule: entry.schedule as string[],
          path: entry.path as string,
          ...(typeof entry.description === "string" ? { description: entry.description } : {}),
        },
      }).jobs[0];
    } catch (error) {
      throw invalid(error instanceof Error ? error.message.replace(/\.$/, "") : String(error));
    }
    if (!resolved) throw invalid(`job ${JSON.stringify(entry.name)} did not resolve`);
    const timeoutMs = entry.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (typeof timeoutMs !== "number" ||
        !Number.isInteger(timeoutMs) ||
        (provider === "farmjs" && (timeoutMs < 1_000 || timeoutMs > 60_000)))
    ) {
      throw new FarmCronSyncError(
        "INVALID_MANIFEST",
        `Infra cron job ${JSON.stringify(entry.name)} needs a \`timeoutMs\` from 1000 to 60000. Update the route and rebuild.`,
      );
    }
    return { ...resolved, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  });
  // A host manifest means Infra should run nothing for this endpoint.
  return { provider, jobs: provider === "farmjs" ? jobs : [] };
}

function printable(value: string): string {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  }).join("");
}

async function describeRefusal(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (record(body) && typeof body.message === "string") {
      // Infra's message is shown to the operator; keep it short and printable.
      const message = printable(body.message).slice(0, 300);
      const code = typeof body.error === "string" ? ` (${printable(body.error).slice(0, 60)})` : "";
      return ` Infra said${code}: ${message}`;
    }
  } catch {
    // A non-JSON refusal still reports its status.
  }
  return "";
}

/** Plan by default; replace the deployed endpoint's Infra schedules only with `apply`. */
export async function syncFarmCronJobs(options: SyncFarmCronOptions): Promise<FarmCronSyncResult> {
  const endpoint = origin(options.url, "--url");
  const apiUrl = origin(
    process.env.FARMJS_API_URL || DEFAULT_FARMJS_API_URL,
    "FARMJS_API_URL",
    true,
  );
  const environment = process.env.FARMJS_ENVIRONMENT;
  if (
    !environment ||
    !FARMJS_ENVIRONMENTS.includes(environment as (typeof FARMJS_ENVIRONMENTS)[number])
  ) {
    throw new FarmCronSyncError(
      "INVALID_OPTION",
      `Set \`FARMJS_ENVIRONMENT\` to the deployed environment: ${FARMJS_ENVIRONMENTS.join(", ")}.`,
    );
  }
  const root = path.resolve(options.root || process.cwd());
  const manifestPath = path.resolve(root, options.manifest || ".farm/cron-manifest.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw new FarmCronSyncError(
      "MANIFEST_READ_FAILED",
      `Could not read the cron manifest at ${manifestPath}. Run \`farm build\`, or pass the deployed build's manifest with \`--manifest\`.`,
      { cause },
    );
  }
  const { provider, jobs } = readManifest(manifest);
  const plan: FarmCronSyncResult = {
    schemaVersion: 1,
    applied: false,
    endpoint,
    apiUrl,
    environment,
    projectId: process.env.FARMJS_PROJECT_ID || null,
    provider,
    jobs,
  };
  if (!options.apply) return plan;
  if (jobs.length === 0 && !options.allowDelete) {
    throw new FarmCronSyncError(
      "DELETE_NOT_ALLOWED",
      "This sync clears every Infra cron job for the endpoint. Review the plan, then pass `--apply --allow-delete`.",
    );
  }
  const apiKey = process.env.FARMJS_API_KEY;
  if (!apiKey) {
    throw new FarmCronSyncError(
      "MISSING_API_KEY",
      "Set `FARMJS_API_KEY` to a server key with the `cron:jobs` permission before applying.",
    );
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "x-farm-environment": environment,
  };
  if (plan.projectId) headers["x-farm-project"] = plan.projectId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  timer.unref?.();
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(`${apiUrl}/api/cron/jobs`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ endpoint, jobs }),
      signal: controller.signal,
      // Never forward the API key to a redirect target.
      redirect: "error",
    });
  } catch (cause) {
    clearTimeout(timer);
    throw new FarmCronSyncError(
      "SYNC_FAILED",
      controller.signal.aborted
        ? `Infra did not answer within ${SYNC_TIMEOUT_MS / 1000}s. Retry \`farm cron sync --apply\`; the job list is replaced as a whole.`
        : `Could not reach Infra at ${apiUrl} (redirects are refused). Check \`FARMJS_API_URL\` and the network, then retry.`,
      { cause },
    );
  }
  try {
    if (!response.ok) {
      throw new FarmCronSyncError(
        "SYNC_FAILED",
        `Infra refused the sync with HTTP ${response.status}.${await describeRefusal(response)} Check the key's \`cron:jobs\` permission, \`FARMJS_ENVIRONMENT\`, and \`FARMJS_PROJECT_ID\`.`,
      );
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch (cause) {
      throw new FarmCronSyncError(
        "SYNC_FAILED",
        "Infra answered with a body that is not JSON. Check `FARMJS_API_URL`, then retry.",
        { cause },
      );
    }
    if (!record(result) || result.accepted !== jobs.length) {
      throw new FarmCronSyncError(
        "SYNC_FAILED",
        `Infra acknowledged ${record(result) && typeof result.accepted === "number" ? result.accepted : "no"} of ${jobs.length} cron job(s). Retry \`farm cron sync --apply\`; the job list is replaced as a whole.`,
      );
    }
    return { ...plan, applied: true, accepted: jobs.length };
  } finally {
    clearTimeout(timer);
  }
}
