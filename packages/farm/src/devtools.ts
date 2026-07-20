import path from "node:path";
import { getDeployTargetForPreset } from "./config";
import { resolveCronConfig, type FarmCronJob } from "./cron";
import {
  mergeFarmRouteRuntimeConfigs,
  resolveFarmRouteRuleRuntimeConfig,
  resolveFarmRouteRuntimeConfig,
  type ResolvedFarmRouteRuntimeConfig,
} from "./route-runtime";
import type { FarmConfig } from "./types";
import type { FarmDiscoveredWorkflow } from "./workflows";

type RouteMapEntry = {
  pattern: string;
  modulePath: string;
};

type RouteManagerLike = {
  getRoutes(): Map<string, RouteMapEntry>;
  getLayouts(): Map<string, RouteMapEntry>;
  getLoadings(): Map<string, RouteMapEntry>;
  getErrors(): Map<string, RouteMapEntry>;
  resolveRouteRuntimeConfig?(
    pattern: string,
  ): Promise<ResolvedFarmRouteRuntimeConfig> | ResolvedFarmRouteRuntimeConfig;
};

type APIRouteManagerLike = {
  getRoutes(): Map<
    string,
    {
      path: string;
      filePath: string;
      methods: string[];
      runtime?: "auto" | "node" | "edge";
      regions?: "auto" | readonly string[];
      maxDuration?: "auto" | number;
    }
  >;
};

type MiddlewareManagerLike = {
  getMiddlewares(): Array<{
    path: string;
    filePath: string;
    handlers: unknown[];
    source?: "config" | "file";
  }>;
};

type IntegrationLike = {
  kind?: string;
  type?: string;
  category?: string;
  serverRuntime?: boolean;
  routes?: ReadonlyArray<{
    path: string;
    method?: string;
    methods?: readonly string[];
  }>;
  middleware?: readonly unknown[];
  providers?: readonly unknown[];
  schema?: {
    models?: Record<string, unknown>;
  };
};

export type FarmDevtoolsRuntime = {
  runtime: "auto" | "node" | "edge";
  regions?: string[];
  maxDuration?: number;
};

export type FarmDevtoolsDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  title: string;
  message: string;
  action?: string;
};

export type FarmDevtoolsSnapshot = {
  generatedAt: string;
  health: "ready" | "attention" | "error";
  project: {
    name: string;
    root: string;
    srcDir: string;
    basePath: string;
    deploymentId: string;
  };
  deployment: {
    target: string;
    preset: string;
    outputDir?: string;
  };
  counts: {
    pages: number;
    layouts: number;
    loadingBoundaries: number;
    errorBoundaries: number;
    apiRoutes: number;
    middleware: number;
    integrations: number;
    storageMounts: number;
    cronJobs: number;
    workflows: number;
    layers: number;
    diagnostics: number;
  };
  routes: Array<{
    kind: "page" | "layout" | "loading" | "error";
    pattern: string;
    filePath: string;
    runtime?: FarmDevtoolsRuntime;
  }>;
  apiRoutes: Array<{
    path: string;
    methods: string[];
    filePath: string;
    runtime: FarmDevtoolsRuntime;
  }>;
  middleware: Array<{
    path: string;
    source: "config" | "file";
    filePath: string;
    handlerCount: number;
  }>;
  integrations: Array<{
    key: string;
    type: string;
    category: string;
    serverRuntime: boolean;
    routes: Array<{ path: string; methods: string[] }>;
    middlewareCount: number;
    providerCount: number;
    schemaModelCount: number;
  }>;
  storage: Array<{
    mount: string;
    driver: string;
    default: boolean;
  }>;
  cron: FarmCronJob[];
  workflows: Array<{
    id: string;
    filePath: string;
    routePath: string;
    schedule: string[];
    timezone?: string;
  }>;
  layers: Array<{
    name: string;
    source: string;
    srcDir: string;
  }>;
  environment: {
    server: string[];
    public: string[];
  };
  docs: {
    enabled: boolean;
    entry?: string;
  };
  features: {
    openapi: boolean;
    markdown: boolean;
    serverComponents: boolean;
    serverActions: boolean;
    observability: boolean;
  };
  diagnostics: FarmDevtoolsDiagnostic[];
};

export interface CreateFarmDevtoolsSnapshotInput {
  root: string;
  srcDir: string;
  routeManager: RouteManagerLike;
  apiRouteManager: APIRouteManagerLike;
  middlewareManager: MiddlewareManagerLike;
  config?: FarmConfig & { openapi?: { enabled?: boolean } };
  workflows?: readonly FarmDiscoveredWorkflow[];
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function toProjectPath(root: string, filePath: string): string {
  const normalizedRoot = normalizePath(root).replace(/\/$/, "");
  const normalizedFile = normalizePath(filePath);
  if (normalizedFile.startsWith(normalizedRoot + "/")) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  return normalizedFile;
}

function sortByPath<T extends { path?: string; pattern?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (a.path || a.pattern || "").localeCompare(b.path || b.pattern || ""),
  );
}

function toRuntime(value: ResolvedFarmRouteRuntimeConfig): FarmDevtoolsRuntime {
  return {
    runtime: value.runtime,
    ...(value.regions ? { regions: [...value.regions] } : {}),
    ...(value.maxDuration ? { maxDuration: value.maxDuration } : {}),
  };
}

async function collectRoutes(
  root: string,
  kind: FarmDevtoolsSnapshot["routes"][number]["kind"],
  routes: Map<string, RouteMapEntry>,
  routeManager: RouteManagerLike,
  diagnostics: FarmDevtoolsDiagnostic[],
): Promise<FarmDevtoolsSnapshot["routes"]> {
  return Promise.all(
    Array.from(routes.values()).map(async (route) => {
      let runtime: FarmDevtoolsRuntime | undefined;
      if (kind === "page" && routeManager.resolveRouteRuntimeConfig) {
        try {
          runtime = toRuntime(await routeManager.resolveRouteRuntimeConfig(route.pattern));
        } catch (error) {
          diagnostics.push({
            severity: "warning",
            code: "ROUTE_RUNTIME_UNRESOLVED",
            title: `Could not inspect ${route.pattern}`,
            message: error instanceof Error ? error.message : String(error),
            action: "Check the route and inherited layout runtime exports.",
          });
        }
      }

      return {
        kind,
        pattern: route.pattern,
        filePath: toProjectPath(root, route.modulePath),
        ...(runtime ? { runtime } : {}),
      };
    }),
  );
}

function collectIntegrations(integrations: FarmConfig["integrations"] | undefined) {
  if (!integrations || typeof integrations !== "object") return [];

  return Object.entries(integrations)
    .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
    .map(([key, value]) => {
      const integration = value as IntegrationLike;
      const routes = (integration.routes || []).map((route) => ({
        path: route.path,
        methods: [...(route.methods || (route.method ? [route.method] : ["ALL"]))]
          .map((method) => method.toUpperCase())
          .sort(),
      }));

      return {
        key,
        type: integration.type || key,
        category: integration.category || "custom",
        serverRuntime: integration.serverRuntime !== false,
        routes: sortByPath(routes),
        middlewareCount: integration.middleware?.length || 0,
        providerCount: integration.providers?.length || 0,
        schemaModelCount: Object.keys(integration.schema?.models || {}).length,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function collectStorage(storage: FarmConfig["storage"] | undefined): {
  entries: FarmDevtoolsSnapshot["storage"];
  configured: boolean;
} {
  if (!storage || typeof storage !== "object") {
    return {
      entries: [{ mount: "root", driver: "memory", default: true }],
      configured: false,
    };
  }

  const value = storage as Record<string, any>;
  if (value.kind === "farm-storage-client") {
    return {
      entries: [{ mount: "root", driver: "storage client", default: false }],
      configured: true,
    };
  }

  const configured = Object.keys(value).length > 0;
  const rootDriver = value.client
    ? describeStorageDriver(value.client)
    : describeStorageDriver(value.driver);
  const entries: FarmDevtoolsSnapshot["storage"] = [
    {
      mount: "root",
      driver: rootDriver,
      default: !configured,
    },
  ];

  if (value.mounts && typeof value.mounts === "object") {
    for (const [mount, mountConfig] of Object.entries(value.mounts)) {
      entries.push({
        mount,
        driver: describeStorageDriver(mountConfig),
        default: false,
      });
    }
  }

  return {
    entries: entries.sort((a, b) => {
      if (a.mount === "root") return -1;
      if (b.mount === "root") return 1;
      return a.mount.localeCompare(b.mount);
    }),
    configured,
  };
}

function describeStorageDriver(value: unknown): string {
  if (!value) return "memory";
  if (typeof value === "string") return value;
  if (typeof value === "function") return "custom";
  if (typeof value !== "object") return "custom";

  const record = value as Record<string, unknown>;
  if (record.kind === "farm-storage-client") return "storage client";
  if (typeof record.driver === "string") return record.driver;
  if (typeof record.driver === "function") return "custom";
  return "custom";
}

function featureEnabled(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "object" && "enabled" in value) {
    return (value as { enabled?: boolean }).enabled !== false;
  }
  return value !== false;
}

function collectEnvironmentKeys(config: FarmConfig | undefined) {
  const env = config?.env as
    | { server?: Record<string, unknown>; public?: Record<string, unknown> }
    | undefined;
  return {
    server: Object.keys(env?.server || {}).sort(),
    public: Object.keys(env?.public || {}).sort(),
  };
}

function resolveHealth(diagnostics: FarmDevtoolsDiagnostic[]): FarmDevtoolsSnapshot["health"] {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return "error";
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning")) return "attention";
  return "ready";
}

export async function createFarmDevtoolsSnapshot(
  input: CreateFarmDevtoolsSnapshotInput,
): Promise<FarmDevtoolsSnapshot> {
  const config = input.config || {};
  const diagnostics: FarmDevtoolsDiagnostic[] = [];
  const pageRoutes = await collectRoutes(
    input.root,
    "page",
    input.routeManager.getRoutes(),
    input.routeManager,
    diagnostics,
  );
  const layoutRoutes = await collectRoutes(
    input.root,
    "layout",
    input.routeManager.getLayouts(),
    input.routeManager,
    diagnostics,
  );
  const loadingRoutes = await collectRoutes(
    input.root,
    "loading",
    input.routeManager.getLoadings(),
    input.routeManager,
    diagnostics,
  );
  const errorRoutes = await collectRoutes(
    input.root,
    "error",
    input.routeManager.getErrors(),
    input.routeManager,
    diagnostics,
  );
  const apiRoutes = sortByPath(
    Array.from(input.apiRouteManager.getRoutes().values()).map((route) => {
      const runtime = resolveFarmRouteRuntimeConfig(
        mergeFarmRouteRuntimeConfigs(
          resolveFarmRouteRuleRuntimeConfig(route.path, config.routeRules),
          route,
        ),
        `API route "${route.path}"`,
      );
      return {
        path: route.path,
        methods: [...route.methods].sort(),
        filePath: toProjectPath(input.root, route.filePath),
        runtime: toRuntime(runtime),
      };
    }),
  );
  const middleware = sortByPath(
    input.middlewareManager.getMiddlewares().map((entry) => ({
      path: entry.path,
      source: entry.source || "file",
      filePath: toProjectPath(input.root, entry.filePath),
      handlerCount: entry.handlers.length,
    })),
  );
  const integrations = collectIntegrations(config.integrations);
  const storage = collectStorage(config.storage);
  const cron = resolveCronConfig(config.cron);
  const workflows = (input.workflows || [])
    .map((workflow) => ({
      id: workflow.id,
      filePath: toProjectPath(input.root, workflow.filePath),
      routePath: workflow.routePath,
      schedule: [...workflow.schedule],
      ...(workflow.timezone ? { timezone: workflow.timezone } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const layers = (config.layers || []).map((layer) => ({
    name: layer.name,
    source: layer.source,
    srcDir: layer.srcDir,
  }));
  const deploymentPreset = String(config.deploy?.preset || config.preset || "node-server");
  const deploymentTarget = String(
    config.deploy?.target || getDeployTargetForPreset(deploymentPreset) || "node",
  );
  const env = input.env || process.env;

  if (pageRoutes.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "NO_PAGE_ROUTES",
      title: "No page routes found",
      message: `Farm did not discover a page under ${input.srcDir}/app.`,
      action: `Add ${input.srcDir}/app/page.tsx or a programmatic page route.`,
    });
  }
  if (layoutRoutes.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "ROOT_LAYOUT_MISSING",
      title: "Root layout is missing",
      message: "The application has no shared root layout.",
      action: `Add ${input.srcDir}/app/layout.tsx for shared metadata and application chrome.`,
    });
  }

  const apiPaths = new Set(apiRoutes.map((route) => route.path));
  for (const job of cron.jobs) {
    if (!apiPaths.has(job.path)) {
      diagnostics.push({
        severity: "warning",
        code: "CRON_ROUTE_MISSING",
        title: `Cron route ${job.path} was not found`,
        message: `${job.name} is scheduled, but its GET API route is not registered.`,
        action: "Add the target API route or update the cron path in farm.config.ts.",
      });
    }
  }
  if (cron.jobs.length > 0 && !env[cron.secretEnv]) {
    diagnostics.push({
      severity: "info",
      code: "CRON_SECRET_NOT_SET",
      title: `${cron.secretEnv} is not set`,
      message: "Local manual runs remain available, but production cron routes fail closed.",
      action: `Set ${cron.secretEnv} in the deployment environment before production.`,
    });
  }
  if (
    storage.configured &&
    storage.entries[0]?.driver === "memory" &&
    ["vercel", "cloudflare", "netlify"].includes(deploymentTarget)
  ) {
    diagnostics.push({
      severity: "warning",
      code: "EPHEMERAL_PRODUCTION_STORAGE",
      title: "Production storage is in memory",
      message: `${deploymentTarget} instances do not preserve in-memory data across executions.`,
      action: "Configure a durable storage driver or mount for production state.",
    });
  }

  const environment = collectEnvironmentKeys(config);
  const docs = config.docs;
  const docsEnabled = featureEnabled(docs);
  const allRoutes = sortByPath([...pageRoutes, ...layoutRoutes, ...loadingRoutes, ...errorRoutes]);

  return {
    generatedAt: (input.now?.() || new Date()).toISOString(),
    health: resolveHealth(diagnostics),
    project: {
      name: path.basename(path.resolve(input.root)),
      root: input.root,
      srcDir: input.srcDir,
      basePath: config.basePath || "/",
      deploymentId: config.deploymentId || "development",
    },
    deployment: {
      target: deploymentTarget,
      preset: deploymentPreset,
      ...(config.deploy?.outputDir ? { outputDir: config.deploy.outputDir } : {}),
    },
    counts: {
      pages: pageRoutes.length,
      layouts: layoutRoutes.length,
      loadingBoundaries: loadingRoutes.length,
      errorBoundaries: errorRoutes.length,
      apiRoutes: apiRoutes.length,
      middleware: middleware.length,
      integrations: integrations.length,
      storageMounts: storage.entries.length,
      cronJobs: cron.jobs.length,
      workflows: workflows.length,
      layers: layers.length,
      diagnostics: diagnostics.length,
    },
    routes: allRoutes,
    apiRoutes,
    middleware,
    integrations,
    storage: storage.entries,
    cron: cron.jobs,
    workflows,
    layers,
    environment,
    docs: {
      enabled: docsEnabled,
      entry:
        docsEnabled && docs && typeof docs === "object" && "entry" in docs
          ? String(docs.entry)
          : undefined,
    },
    features: {
      openapi: Boolean(config.openapi?.enabled),
      markdown: featureEnabled(config.md),
      serverComponents: Boolean(config.experimental?.serverComponents),
      serverActions: Boolean(config.experimental?.serverActions),
      observability: featureEnabled(config.observability),
    },
    diagnostics,
  };
}
