import {
  createFarmRequestBodyErrorResponse,
  readFarmRequestBody,
  resolveFarmServerConfig,
  type FarmServerConfig,
  type ResolvedFarmServerConfig,
} from "./server-http";
import { toPosixPath } from "./utils";

export type FarmWorkflowSchedule = string | string[];

export interface FarmWorkflowsUserConfig {
  /** Enable or disable Farm workflow discovery. Enabled by default. */
  enabled?: boolean;
  /** Directory or directories to scan for workflow modules. */
  dir?: string | string[];
  /** Alias for dir. */
  dirs?: string[];
  /** HTTP route used for manual and URL-based cron invocation. */
  route?: string;
  /** Environment variable that stores the optional runner secret. */
  secretEnv?: string;
  /** Inline runner secret. Prefer secretEnv for deployed apps. */
  secret?: string;
}

export interface FarmWorkflowsResolvedConfig {
  enabled: boolean;
  dirs: string[];
  route: string;
  secretEnv: string;
  secret?: string;
}

export interface FarmWorkflowLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface FarmWorkflowRunContext<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  scheduledTime?: number | string;
  request?: Request;
  event?: unknown;
  env: Record<string, string | undefined>;
  data: Map<string, unknown>;
  log: FarmWorkflowLogger;
}

export interface FarmWorkflowDefinition<TPayload = unknown, TResult = unknown> {
  kind?: "farm-workflow";
  id?: string;
  description?: string;
  schedule?: FarmWorkflowSchedule;
  timezone?: string;
  run: (ctx: FarmWorkflowRunContext<TPayload>) => TResult | Promise<TResult>;
}

export interface FarmCronDefinition<
  TPayload = unknown,
  TResult = unknown,
> extends FarmWorkflowDefinition<TPayload, TResult> {
  schedule: FarmWorkflowSchedule;
}

export interface FarmDiscoveredWorkflow {
  id: string;
  filePath: string;
  description?: string;
  schedule: string[];
  timezone?: string;
  routePath: string;
}

export interface PreparedFarmWorkflows {
  workflows: FarmDiscoveredWorkflow[];
  tasks: Record<string, { handler: string; description: string }>;
  scheduledTasks: Record<string, string | string[]>;
  handlerPath?: string;
  manifestPath?: string;
}

export interface FarmWorkflowHTTPHandlerOptions {
  workflows: FarmDiscoveredWorkflow[];
  config: FarmWorkflowsResolvedConfig;
  loadModule: (workflow: FarmDiscoveredWorkflow) => Promise<Record<string, any>>;
  server?: FarmServerConfig | ResolvedFarmServerConfig;
}

export const DEFAULT_FARM_WORKFLOW_DIRS = ["src/jobs", "src/workflows", "src/cron"];
export const DEFAULT_FARM_WORKFLOW_ROUTE = "/api/_farm/workflows";
export const DEFAULT_FARM_WORKFLOW_SECRET_ENV = "CRON_SECRET";

export function defineWorkflow<const TPayload = unknown, TResult = unknown>(
  definition: FarmWorkflowDefinition<TPayload, TResult>,
): FarmWorkflowDefinition<TPayload, TResult> {
  return {
    ...definition,
    kind: "farm-workflow",
  };
}

export function defineTask<const TPayload = unknown, TResult = unknown>(
  definition: FarmWorkflowDefinition<TPayload, TResult>,
): FarmWorkflowDefinition<TPayload, TResult> {
  return defineWorkflow(definition);
}

/**
 * @deprecated Configure `cron` in `farm.config.ts` and point it at an API route.
 */
export function defineCron<const TPayload = unknown, TResult = unknown>(
  definition: FarmCronDefinition<TPayload, TResult>,
): FarmCronDefinition<TPayload, TResult> {
  return {
    ...definition,
    kind: "farm-workflow",
  };
}

export function resolveWorkflowsConfig(
  workflows: FarmWorkflowsUserConfig | boolean | undefined,
): FarmWorkflowsResolvedConfig {
  if (workflows === false) {
    return {
      enabled: false,
      dirs: [...DEFAULT_FARM_WORKFLOW_DIRS],
      route: DEFAULT_FARM_WORKFLOW_ROUTE,
      secretEnv: DEFAULT_FARM_WORKFLOW_SECRET_ENV,
    };
  }

  const options = workflows && typeof workflows === "object" ? workflows : {};
  const dirs = normalizeWorkflowDirs(options);

  return {
    enabled: options.enabled ?? true,
    dirs,
    route: normalizeWorkflowRoute(options.route || DEFAULT_FARM_WORKFLOW_ROUTE),
    secretEnv: options.secretEnv || DEFAULT_FARM_WORKFLOW_SECRET_ENV,
    secret: options.secret,
  };
}

export async function discoverFarmWorkflows(
  config: {
    root?: string;
    workflows?: FarmWorkflowsResolvedConfig | FarmWorkflowsUserConfig | boolean;
  },
  options: {
    loadModule?: (filePath: string) => Promise<Record<string, any>>;
  } = {},
): Promise<FarmDiscoveredWorkflow[]> {
  const workflowConfig = isResolvedWorkflowConfig(config.workflows)
    ? config.workflows
    : resolveWorkflowsConfig(config.workflows);
  if (!workflowConfig.enabled) return [];

  const root = config.root || process.cwd();
  const files = await findWorkflowFiles(root, workflowConfig.dirs);
  const workflows: FarmDiscoveredWorkflow[] = [];
  const seenIds = new Map<string, string>();

  for (const filePath of files) {
    const module = options.loadModule
      ? await options.loadModule(filePath)
      : await loadWorkflowModule(filePath, root);
    const definition = resolveWorkflowDefinition(module);
    if (!definition) continue;

    const id = normalizeWorkflowId(definition.id || workflowIdFromFile(root, filePath));
    const previousPath = seenIds.get(id);
    if (previousPath) {
      throw new Error(
        `Duplicate Farm workflow id "${id}" found in ${relativePath(root, previousPath)} and ${relativePath(root, filePath)}.`,
      );
    }
    seenIds.set(id, filePath);

    workflows.push({
      id,
      filePath,
      description: definition.description,
      schedule: normalizeSchedule(definition.schedule),
      timezone: definition.timezone,
      routePath: joinRoute(workflowConfig.route, encodeURIComponent(id)),
    });
  }

  return workflows;
}

export function createFarmWorkflowRequestHandler(options: FarmWorkflowHTTPHandlerOptions) {
  const workflowsById = new Map(options.workflows.map((workflow) => [workflow.id, workflow]));

  return async function handleFarmWorkflowRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    const route = normalizeWorkflowRoute(options.config.route);
    if (url.pathname !== route && !url.pathname.startsWith(`${route}/`)) {
      return null;
    }

    if (url.pathname === route) {
      const secretError = verifyWorkflowSecret(request, options.config);
      if (secretError) return secretError;

      return Response.json({
        workflows: options.workflows.map(toWorkflowMetadata),
      });
    }

    const id = decodeURIComponent(url.pathname.slice(route.length + 1));
    const workflow = workflowsById.get(id);
    if (!workflow) {
      return Response.json({ error: `Workflow "${id}" was not found.` }, { status: 404 });
    }

    const secretError = verifyWorkflowSecret(request, options.config);
    if (secretError) return secretError;

    let payload: unknown;
    try {
      payload = await readWorkflowPayload(
        request,
        resolveFarmServerConfig(options.server).bodySizeLimit,
      );
    } catch (error) {
      const response = createFarmRequestBodyErrorResponse(error);
      if (response) return response;
      throw error;
    }
    const module = await options.loadModule(workflow);
    const result = await runFarmWorkflowModule(module, {
      id: workflow.id,
      name: workflow.id,
      payload,
      request,
      scheduledTime: readScheduledTime(payload),
    });

    return Response.json({
      id: workflow.id,
      ok: true,
      result: result ?? null,
    });
  };
}

export async function runFarmWorkflowModule(
  module: Record<string, any>,
  context: {
    id: string;
    name?: string;
    payload?: unknown;
    scheduledTime?: number | string;
    request?: Request;
    event?: unknown;
    env?: Record<string, string | undefined>;
  },
): Promise<unknown> {
  const definition = resolveWorkflowDefinition(module);
  if (!definition) {
    throw new Error(`Farm workflow "${context.id}" does not export a workflow definition.`);
  }

  return await definition.run({
    id: context.id,
    name: context.name || context.id,
    payload: context.payload,
    scheduledTime: context.scheduledTime,
    request: context.request,
    event: context.event,
    env: context.env || process.env,
    data: new Map<string, unknown>(),
    log: console,
  });
}

export async function prepareFarmWorkflowsForNitro(config: {
  root?: string;
  distDir?: string;
  workflows?: FarmWorkflowsResolvedConfig | FarmWorkflowsUserConfig | boolean;
  server?: FarmServerConfig | ResolvedFarmServerConfig;
}): Promise<PreparedFarmWorkflows> {
  const workflowConfig = isResolvedWorkflowConfig(config.workflows)
    ? config.workflows
    : resolveWorkflowsConfig(config.workflows);
  const workflows = await discoverFarmWorkflows({
    root: config.root,
    workflows: workflowConfig,
  });

  if (workflows.length === 0) {
    return {
      workflows,
      tasks: {},
      scheduledTasks: {},
    };
  }

  const root = config.root || process.cwd();
  const distDir = config.distDir || ".farm";
  const fs = await import("fs/promises");
  const path = await import("path");
  const generatedDir = path.join(root, distDir, ".nitro", "farm-workflows");
  await fs.mkdir(generatedDir, { recursive: true });

  const tasks: PreparedFarmWorkflows["tasks"] = {};
  const scheduledTasks = createScheduledTasks(workflows);

  for (const workflow of workflows) {
    const wrapperPath = toPosixPath(path.join(generatedDir, `${safeFileName(workflow.id)}.mjs`));
    await fs.writeFile(wrapperPath, createNitroTaskWrapper(workflow), "utf8");
    tasks[workflow.id] = {
      handler: wrapperPath,
      description: workflow.description || `Farm workflow ${workflow.id}`,
    };
  }

  const handlerPath = toPosixPath(path.join(generatedDir, "http-handler.mjs"));
  await fs.writeFile(
    handlerPath,
    createNitroWorkflowHTTPHandler(
      workflowConfig,
      workflows,
      resolveFarmServerConfig(config.server),
    ),
    "utf8",
  );

  const manifestPath = path.join(generatedDir, "manifest.json");
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        route: workflowConfig.route,
        secretEnv: workflowConfig.secretEnv,
        trigger: {
          method: "GET",
          authorization: `Bearer $${workflowConfig.secretEnv}`,
        },
        workflows: workflows.map(toWorkflowMetadata),
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    workflows,
    tasks,
    scheduledTasks,
    handlerPath,
    manifestPath,
  };
}

export function createFarmWorkflowVercelCrons(
  workflows: FarmDiscoveredWorkflow[],
): Array<{ path: string; schedule: string }> {
  return workflows.flatMap((workflow) =>
    workflow.schedule.map((schedule) => ({
      path: workflow.routePath,
      schedule,
    })),
  );
}

export function applyFarmWorkflowVercelCrons(
  vercelConfig: Record<string, any>,
  workflows: FarmDiscoveredWorkflow[],
): Record<string, any> {
  const crons = createFarmWorkflowVercelCrons(workflows);
  if (crons.length === 0) return vercelConfig;

  const existingCrons = Array.isArray(vercelConfig.crons) ? vercelConfig.crons : [];
  const seen = new Set(existingCrons.map((cron) => `${cron.path}:${cron.schedule}`));
  const nextCrons = [...existingCrons];
  for (const cron of crons) {
    const key = `${cron.path}:${cron.schedule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextCrons.push(cron);
  }
  return {
    ...vercelConfig,
    crons: nextCrons,
  };
}

function isResolvedWorkflowConfig(value: unknown): value is FarmWorkflowsResolvedConfig {
  return (
    !!value &&
    typeof value === "object" &&
    "dirs" in value &&
    Array.isArray((value as FarmWorkflowsResolvedConfig).dirs) &&
    typeof (value as FarmWorkflowsResolvedConfig).route === "string"
  );
}

function normalizeWorkflowDirs(options: FarmWorkflowsUserConfig): string[] {
  const rawDirs =
    options.dirs ||
    (Array.isArray(options.dir) ? options.dir : options.dir ? [options.dir] : undefined);
  const dirs = rawDirs && rawDirs.length > 0 ? rawDirs : DEFAULT_FARM_WORKFLOW_DIRS;
  return [...new Set(dirs.map((dir) => trimSlashes(dir)).filter(Boolean))];
}

function normalizeWorkflowRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed || trimmed === "/") return DEFAULT_FARM_WORKFLOW_ROUTE;
  return `/${trimSlashes(trimmed)}`;
}

function normalizeWorkflowId(id: string): string {
  const normalized = id
    .replace(/\\/g, "/")
    .replace(/\.(tsx?|jsx?|mjs|cjs)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
  return normalized || "workflow";
}

function normalizeSchedule(schedule: FarmWorkflowSchedule | undefined): string[] {
  if (!schedule) return [];
  return (Array.isArray(schedule) ? schedule : [schedule])
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveWorkflowDefinition(
  module: Record<string, any>,
): FarmWorkflowDefinition | FarmCronDefinition | null {
  const candidates = [module.default, module.workflow, module.cron, module.task, module.job];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && typeof candidate.run === "function") {
      return candidate as FarmWorkflowDefinition;
    }
  }
  return null;
}

async function findWorkflowFiles(root: string, dirs: string[]): Promise<string[]> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const files: string[] = [];

  for (const dir of dirs) {
    const absoluteDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
    if (!(await pathExists(absoluteDir))) continue;
    await walkWorkflowDir(absoluteDir, files);
  }

  return files.sort();
}

async function walkWorkflowDir(dir: string, files: string[]): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walkWorkflowDir(filePath, files);
      continue;
    }
    if (isWorkflowFile(entry.name)) {
      files.push(filePath);
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  const fs = await import("fs/promises");
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function isWorkflowFile(fileName: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(fileName) && !/\.d\.[cm]?ts$/.test(fileName);
}

async function loadWorkflowModule(filePath: string, root: string): Promise<Record<string, any>> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const { pathToFileURL } = await import("url");
  const { build } = await import("esbuild");
  const outDir = path.join(root, ".farm", ".workflow-loader");
  await fs.mkdir(outDir, { recursive: true });
  const outfile = path.join(
    outDir,
    `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );

  await build({
    absWorkingDir: root,
    entryPoints: [filePath],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: `node${process.versions.node.split(".")[0]}`,
    packages: "external",
    external: ["@farm.js/core", "@farm.js/core/*", "nitro", "nitro/*"],
    jsx: "automatic",
    logLevel: "silent",
    sourcemap: "inline",
  });

  try {
    return await import(/* @vite-ignore */ `${pathToFileURL(outfile).href}?t=${Date.now()}`);
  } finally {
    await fs.unlink(outfile).catch(() => undefined);
  }
}

function workflowIdFromFile(root: string, filePath: string): string {
  const normalizedRoot = root.replace(/\\/g, "/");
  const normalizedFile = filePath.replace(/\\/g, "/");
  const relative = normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
  return normalizeWorkflowId(
    relative.replace(/^src\/(?:jobs|workflows|cron)\//, "").replace(/\.(tsx?|jsx?|mjs|cjs)$/, ""),
  );
}

function createScheduledTasks(
  workflows: FarmDiscoveredWorkflow[],
): Record<string, string | string[]> {
  const scheduleMap = new Map<string, string[]>();
  for (const workflow of workflows) {
    for (const schedule of workflow.schedule) {
      const taskIds = scheduleMap.get(schedule) || [];
      taskIds.push(workflow.id);
      scheduleMap.set(schedule, taskIds);
    }
  }

  return Object.fromEntries(
    [...scheduleMap.entries()].map(([schedule, taskIds]) => [
      schedule,
      taskIds.length === 1 ? taskIds[0] : taskIds,
    ]),
  );
}

function createNitroTaskWrapper(workflow: FarmDiscoveredWorkflow): string {
  const normalizedPath = workflow.filePath.replace(/\\/g, "/");
  return `
import { defineTask } from "nitro/runtime";
import { runFarmWorkflowModule } from "@farm.js/core/workflows";
import * as workflowModule from ${JSON.stringify(normalizedPath)};

export default defineTask({
  meta: {
    description: ${JSON.stringify(workflow.description || `Farm workflow ${workflow.id}`)}
  },
  async run(event) {
    const payload = event?.payload || {};
    const env = event?.context?.cloudflare?.env || event?.context?.env || process.env;
    return await runFarmWorkflowModule(workflowModule, {
      id: ${JSON.stringify(workflow.id)},
      name: event?.name || ${JSON.stringify(workflow.id)},
      payload,
      scheduledTime: payload.scheduledTime,
      request: event?.context?.request,
      event,
      env
    });
  }
});
`.trim();
}

function createNitroWorkflowHTTPHandler(
  config: FarmWorkflowsResolvedConfig,
  workflows: FarmDiscoveredWorkflow[],
  server: ResolvedFarmServerConfig,
): string {
  return `
import { H3 } from "h3";
import { runTask } from "nitro/runtime";
import {
  createFarmRequestBodyErrorResponse,
  readFarmRequestBody
} from "@farm.js/core/internal/production-runtime";

const route = ${JSON.stringify(config.route)};
const secretEnv = ${JSON.stringify(config.secretEnv)};
const inlineSecret = ${JSON.stringify(config.secret || "")};
const bodySizeLimit = ${JSON.stringify(server.bodySizeLimit)};
const workflows = ${JSON.stringify(workflows.map(toWorkflowMetadata))};
const workflowIds = new Set(workflows.map((workflow) => workflow.id));

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function getHeader(event, name) {
  return event.req.headers.get(name);
}

function getSecret() {
  return inlineSecret || process.env[secretEnv] || "";
}

function verifySecret(event) {
  const secret = getSecret();
  if (!secret) return null;
  const authorization = getHeader(event, "authorization") || "";
  const headerSecret = getHeader(event, "x-farm-workflow-secret") || "";
  const bearer = authorization.match(/^Bearer\\s+(.+)$/i)?.[1] || "";
  if (headerSecret === secret || bearer === secret) return null;
  return json({ error: "Unauthorized workflow request." }, 401);
}

async function readPayload(event) {
  if (event.req.method === "GET" || event.req.method === "HEAD") {
    return Object.fromEntries(event.url.searchParams.entries());
  }
  const bytes = await readFarmRequestBody(event.req, bodySizeLimit);
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  return JSON.parse(text);
}

export default new H3()
  .get(route, (event) => {
    const unauthorized = verifySecret(event);
    if (unauthorized) return unauthorized;
    return { workflows };
  })
  .all(route + "/:id", async (event) => {
    const id = decodeURIComponent(event.context.params?.id || "");
    if (!workflowIds.has(id)) {
      return json({ error: "Workflow " + id + " was not found." }, 404);
    }

    const unauthorized = verifySecret(event);
    if (unauthorized) return unauthorized;

    let payload;
    try {
      payload = await readPayload(event);
    } catch (error) {
      const response = createFarmRequestBodyErrorResponse(error);
      if (response) return response;
      if (error instanceof SyntaxError) return json({ error: "Invalid workflow request body." }, 400);
      throw error;
    }
    const result = await runTask(id, {
      payload,
      context: {
        source: "http",
        request: event.req,
        route,
        url: event.url.href,
        method: event.req.method
      }
    });
    return {
      id,
      ok: true,
      result: result ?? null
    };
  });
`.trim();
}

function toWorkflowMetadata(workflow: FarmDiscoveredWorkflow) {
  return {
    id: workflow.id,
    description: workflow.description || null,
    schedule: workflow.schedule,
    timezone: workflow.timezone || null,
    path: workflow.routePath,
  };
}

async function readWorkflowPayload(request: Request, bodySizeLimit: number): Promise<unknown> {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    return Object.fromEntries(url.searchParams.entries());
  }

  const bytes = await readFarmRequestBody(request, bodySizeLimit);
  const text = new TextDecoder().decode(bytes);
  if (!text) return {};
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  return text ? { text } : {};
}

function readScheduledTime(payload: unknown): number | string | undefined {
  return payload && typeof payload === "object" && "scheduledTime" in payload
    ? (payload as { scheduledTime?: number | string }).scheduledTime
    : undefined;
}

function verifyWorkflowSecret(
  request: Request,
  config: FarmWorkflowsResolvedConfig,
): Response | null {
  const secret = config.secret || process.env[config.secretEnv] || "";
  if (!secret) return null;

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerSecret = request.headers.get("x-farm-workflow-secret") || "";
  if (bearer === secret || headerSecret === secret) return null;

  return Response.json({ error: "Unauthorized workflow request." }, { status: 401 });
}

function joinRoute(...parts: string[]): string {
  return `/${parts
    .map((part) => trimSlashes(part))
    .filter(Boolean)
    .join("/")}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-") || "workflow";
}

function relativePath(root: string, filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(`${root.replace(/\\/g, "/")}/`, "");
}
