import {
  getFarmSourceRoots,
  loadConfig,
  resolveConfig,
  type FarmCronJob,
  type ResolvedFarmConfig,
} from "@farmjs/core";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";

export type FarmDoctorCheckStatus = "pass" | "warn" | "fail" | "info";

export interface FarmDoctorCheck {
  status: FarmDoctorCheckStatus;
  code: string;
  title: string;
  message: string;
  action?: string;
}

export interface FarmDoctorReport {
  generatedAt: string;
  source: "live" | "project";
  health: "ready" | "attention" | "error";
  project: {
    name: string;
    root: string;
  };
  target?: {
    url?: string;
    devtoolsUrl?: string;
    deployment?: string;
    preset?: string;
  };
  runtime?: {
    pages: number;
    layouts: number;
    apiRoutes: number;
    middleware: number;
    integrations: number;
    storageMounts: number;
    cronJobs: number;
    workflows: number;
  };
  summary: Record<FarmDoctorCheckStatus, number>;
  checks: FarmDoctorCheck[];
}

export interface FarmDoctorOptions {
  root?: string;
  configPath?: string;
  url?: string;
  host?: string;
  port?: number | string;
  offline?: boolean;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

type LiveSnapshot = {
  generatedAt?: string;
  health?: "ready" | "attention" | "error";
  project: {
    name: string;
    root: string;
  };
  deployment: {
    target: string;
    preset: string;
  };
  counts: {
    pages: number;
    layouts: number;
    apiRoutes: number;
    middleware: number;
    integrations: number;
    storageMounts: number;
    cronJobs: number;
    workflows: number;
  };
  diagnostics: Array<{
    severity: "error" | "warning" | "info";
    code: string;
    title: string;
    message: string;
    action?: string;
  }>;
};

const ROUTE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "md", "mdx"];
const CONFIG_FILES = [
  "farm.config.ts",
  "farm.config.mts",
  "farm.config.js",
  "farm.config.mjs",
  "config.ts",
  "config.mts",
  "config.js",
  "config.mjs",
];

export async function runFarmDoctor(options: FarmDoctorOptions = {}): Promise<FarmDoctorReport> {
  const root = path.resolve(options.root || process.cwd());
  const liveTarget = resolveLiveTarget(options);
  let liveError: string | undefined;

  if (!options.offline) {
    try {
      const snapshot = await fetchLiveSnapshot(liveTarget, options);
      return createLiveReport(snapshot, liveTarget, options.now);
    } catch (error) {
      liveError = formatError(error);
    }
  }

  const report = await createProjectReport(root, options);
  if (!options.offline && hasExplicitLiveTarget(options) && liveError) {
    report.checks.unshift({
      status: "warn",
      code: "LIVE_RUNTIME_UNREACHABLE",
      title: "Running app was not reachable",
      message: liveError,
      action: `Start farm dev or verify ${liveTarget}.`,
    });
    report.target = { ...report.target, url: liveTarget };
    finalizeReport(report);
  }
  return report;
}

export function formatFarmDoctorReport(
  report: FarmDoctorReport,
  options: { color?: boolean } = {},
): string {
  const color = options.color === undefined ? pc : pc.createColors(options.color);
  const statusStyle: Record<FarmDoctorCheckStatus, (value: string) => string> = {
    pass: color.inverse,
    warn: color.yellow,
    fail: color.red,
    info: color.cyan,
  };
  const lines = [
    `${color.bold("FARM")} ${color.dim("/")} ${color.bold("DOCTOR")}`,
    `${color.white(report.project.name)} ${color.dim("/")} ${color.dim(report.source === "live" ? "LIVE RUNTIME" : "PROJECT")}`,
    "",
  ];

  for (const check of report.checks) {
    const label = check.status.toUpperCase().padEnd(4);
    lines.push(`${statusStyle[check.status](label)}  ${color.bold(check.title)}`);
    lines.push(`      ${color.dim(check.message)}`);
    if (check.action) lines.push(`      ${color.dim(`Next: ${check.action}`)}`);
  }

  const summary = [
    `${report.summary.pass} passed`,
    `${report.summary.warn} warning${report.summary.warn === 1 ? "" : "s"}`,
    `${report.summary.fail} failed`,
    `${report.summary.info} info`,
  ].join(" / ");
  lines.push("", `${color.bold("SUMMARY")}  ${summary}`);
  if (report.target?.devtoolsUrl) {
    lines.push(`${color.bold("DEVTOOLS")} ${report.target.devtoolsUrl}`);
  }
  return lines.join("\n");
}

async function fetchLiveSnapshot(
  baseUrl: string,
  options: FarmDoctorOptions,
): Promise<LiveSnapshot> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 1_200;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await (options.fetch || globalThis.fetch)(`${baseUrl}/__farm/devtools.json`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Devtools returned ${response.status} from ${baseUrl}.`);
    }
    const value = (await response.json()) as unknown;
    if (!isLiveSnapshot(value)) {
      throw new Error(`Devtools at ${baseUrl} returned an unsupported snapshot.`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms while probing ${baseUrl}.`);
    }
    if (error instanceof TypeError) {
      throw new Error(`Could not connect to ${baseUrl}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createLiveReport(
  snapshot: LiveSnapshot,
  baseUrl: string,
  now: FarmDoctorOptions["now"],
): FarmDoctorReport {
  const checks: FarmDoctorCheck[] = [
    {
      status: "pass",
      code: "LIVE_RUNTIME_READY",
      title: "Connected to the Farm runtime",
      message: `${formatCount(snapshot.counts.pages, "page")}, ${formatCount(snapshot.counts.apiRoutes, "API route")}, and ${formatCount(snapshot.counts.middleware, "middleware layer")} are registered.`,
    },
    {
      status: "pass",
      code: "DEPLOYMENT_RESOLVED",
      title: "Deployment target is resolved",
      message: `${snapshot.deployment.target} uses the ${snapshot.deployment.preset} preset.`,
    },
    {
      status: "info",
      code: "PRODUCT_SYSTEMS_DISCOVERED",
      title: "Product systems are visible",
      message: `${formatCount(snapshot.counts.integrations, "integration")}, ${formatCount(snapshot.counts.storageMounts, "storage mount")}, ${formatCount(snapshot.counts.cronJobs, "cron route")}, and ${formatCount(snapshot.counts.workflows, "workflow")}.`,
    },
    ...snapshot.diagnostics.map((diagnostic) => ({
      status:
        diagnostic.severity === "error"
          ? ("fail" as const)
          : diagnostic.severity === "warning"
            ? ("warn" as const)
            : ("info" as const),
      code: diagnostic.code,
      title: diagnostic.title,
      message: diagnostic.message,
      ...(diagnostic.action ? { action: diagnostic.action } : {}),
    })),
  ];
  const report: FarmDoctorReport = {
    generatedAt: snapshot.generatedAt || (now?.() || new Date()).toISOString(),
    source: "live",
    health: "ready",
    project: snapshot.project,
    target: {
      url: baseUrl,
      devtoolsUrl: `${baseUrl}/__farm/devtools`,
      deployment: snapshot.deployment.target,
      preset: snapshot.deployment.preset,
    },
    runtime: { ...snapshot.counts },
    summary: emptySummary(),
    checks,
  };
  finalizeReport(report);
  return report;
}

async function createProjectReport(
  root: string,
  options: FarmDoctorOptions,
): Promise<FarmDoctorReport> {
  const checks: FarmDoctorCheck[] = [];
  const report: FarmDoctorReport = {
    generatedAt: (options.now?.() || new Date()).toISOString(),
    source: "project",
    health: "ready",
    project: { name: path.basename(root), root },
    summary: emptySummary(),
    checks,
  };

  collectNodeCheck(checks);
  collectPackageCheck(root, checks);

  let config: ResolvedFarmConfig | undefined;
  let userConfig: Awaited<ReturnType<typeof loadConfig>>;
  try {
    userConfig = await loadConfig(root, options.configPath, "development");
    if (!userConfig) {
      checks.push({
        status: "fail",
        code: "CONFIG_MISSING",
        title: "Farm config was not found",
        message: `No Farm config exists under ${root}.`,
        action: "Add farm.config.ts and export defineConfig({...}).",
      });
    } else {
      config = await resolveConfig({ root, ...userConfig }, "development");
      const configFile = findConfigFile(root, options.configPath);
      checks.push({
        status: "pass",
        code: "CONFIG_VALID",
        title: "Farm config loads successfully",
        message: configFile
          ? path.relative(root, configFile) || path.basename(configFile)
          : "Resolved config",
      });
    }
  } catch (error) {
    checks.push({
      status: "fail",
      code: "CONFIG_INVALID",
      title: "Farm config could not be resolved",
      message: formatError(error),
      action: "Fix the config or environment validation error, then run farm doctor again.",
    });
  }

  if (config && userConfig) {
    collectRouterChecks(config, checks);
    report.target = collectDeploymentChecks(config, userConfig, checks);
    collectCronChecks(config, options.env || process.env, checks);
  }

  finalizeReport(report);
  return report;
}

function collectNodeCheck(checks: FarmDoctorCheck[]): void {
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(
    major >= 18
      ? {
          status: "pass",
          code: "NODE_SUPPORTED",
          title: "Node.js is supported",
          message: `Node ${process.versions.node} satisfies Farm's Node 18+ baseline.`,
        }
      : {
          status: "fail",
          code: "NODE_UNSUPPORTED",
          title: "Node.js is too old",
          message: `Node ${process.versions.node} does not satisfy Farm's Node 18+ baseline.`,
          action: "Upgrade Node.js to version 18 or newer.",
        },
  );
}

function collectPackageCheck(root: string, checks: FarmDoctorCheck[]): void {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) {
    checks.push({
      status: "fail",
      code: "PACKAGE_MISSING",
      title: "package.json was not found",
      message: `No package manifest exists under ${root}.`,
      action: "Run the command from a Farm application root.",
    });
    return;
  }

  try {
    const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
    const dependencies = {
      ...asRecord(manifest.dependencies),
      ...asRecord(manifest.devDependencies),
      ...asRecord(manifest.peerDependencies),
    };
    const version = dependencies["@farmjs/core"];
    checks.push(
      typeof version === "string"
        ? {
            status: "pass",
            code: "CORE_INSTALLED",
            title: "Farm core is installed",
            message: `@farmjs/core ${version}`,
          }
        : {
            status: "fail",
            code: "CORE_MISSING",
            title: "Farm core is not declared",
            message: "@farmjs/core is missing from package.json.",
            action: "Install @farmjs/core and add it to the application dependencies.",
          },
    );
  } catch (error) {
    checks.push({
      status: "fail",
      code: "PACKAGE_INVALID",
      title: "package.json is invalid",
      message: formatError(error),
      action: "Fix the package manifest JSON.",
    });
  }
}

function collectRouterChecks(config: ResolvedFarmConfig, checks: FarmDoctorCheck[]): void {
  const sources = getFarmSourceRoots(config);
  const appDirectories = sources.map((source) => path.join(source.root, source.srcDir, "app"));
  const hasPages = appDirectories.some((directory) =>
    containsFile(directory, /^page\.(?:ts|tsx|js|jsx|md|mdx)$/),
  );
  const hasProgrammaticRoutes = sources.some((source) =>
    ROUTE_EXTENSIONS.some((extension) =>
      existsSync(path.join(source.root, source.srcDir, `farm.routes.${extension}`)),
    ),
  );
  checks.push(
    hasPages || hasProgrammaticRoutes
      ? {
          status: "pass",
          code: "APP_ROUTER_READY",
          title: "App router has route modules",
          message: `${config.srcDir}/app and extended layers are discoverable.`,
        }
      : {
          status: "fail",
          code: "NO_PAGE_ROUTES",
          title: "No page routes were found",
          message: `Farm found no page modules under ${config.srcDir}/app.`,
          action: `Add ${config.srcDir}/app/page.tsx or ${config.srcDir}/farm.routes.tsx.`,
        },
  );

  const hasRootLayout = appDirectories.some((directory) =>
    ROUTE_EXTENSIONS.some((extension) => existsSync(path.join(directory, `layout.${extension}`))),
  );
  checks.push(
    hasRootLayout
      ? {
          status: "pass",
          code: "ROOT_LAYOUT_READY",
          title: "Root layout is present",
          message: "Shared metadata and application chrome have a root boundary.",
        }
      : {
          status: "warn",
          code: "ROOT_LAYOUT_MISSING",
          title: "Root layout is missing",
          message: "The application has no shared root layout.",
          action: `Add ${config.srcDir}/app/layout.tsx.`,
        },
  );
}

function collectDeploymentChecks(
  config: ResolvedFarmConfig,
  userConfig: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  checks: FarmDoctorCheck[],
): NonNullable<FarmDoctorReport["target"]> {
  const target = String(config.deploy.target || "node");
  const preset = String(config.deploy.preset || config.preset || "node-server");
  checks.push({
    status: "pass",
    code: "DEPLOYMENT_RESOLVED",
    title: "Deployment target is resolved",
    message: `${target} uses the ${preset} preset and writes to ${config.deploy.outputDir}.`,
  });

  const integrations = Object.values(config.integrations || {}).filter(Boolean).length;
  const storageMounts = getStorageMountCount(config.storage);
  checks.push({
    status: "info",
    code: "PRODUCT_SYSTEMS_DISCOVERED",
    title: "Product systems are configured",
    message: `${formatCount(integrations, "integration")} and ${formatCount(storageMounts, "storage mount")}.`,
  });

  if (
    userConfig.storage &&
    describeRootStorageDriver(userConfig.storage) === "memory" &&
    ["vercel", "cloudflare", "netlify"].includes(target)
  ) {
    checks.push({
      status: "warn",
      code: "EPHEMERAL_PRODUCTION_STORAGE",
      title: "Production storage is in memory",
      message: `${target} instances do not preserve in-memory data across executions.`,
      action: "Configure a durable root storage driver for production state.",
    });
  }

  return { deployment: target, preset };
}

function collectCronChecks(
  config: ResolvedFarmConfig,
  env: Record<string, string | undefined>,
  checks: FarmDoctorCheck[],
): void {
  const cron = config.cron;
  if (!cron.jobs.length) return;

  const missingRoutes = cron.jobs.filter((job) => !hasCronRoute(config, job));
  for (const job of missingRoutes) {
    checks.push({
      status: "warn",
      code: "CRON_ROUTE_MISSING",
      title: `Cron route ${job.path} was not found`,
      message: `${job.name} is scheduled, but its GET API route is not present in the app directory.`,
      action: "Add the target API route or update the cron path in farm.config.ts.",
    });
  }
  if (!env[cron.secretEnv]) {
    checks.push({
      status: "info",
      code: "CRON_SECRET_NOT_SET",
      title: `${cron.secretEnv} is not set`,
      message: "Local manual runs remain available, but production cron routes fail closed.",
      action: `Set ${cron.secretEnv} in the deployment environment before production.`,
    });
  }
}

function hasCronRoute(config: ResolvedFarmConfig, job: FarmCronJob): boolean {
  const relative = job.path.replace(/^\/+/, "").replace(/^api\//, "");
  return getFarmSourceRoots(config).some((source) => {
    const directory = path.join(source.root, source.srcDir, "app", "api", relative);
    return ROUTE_EXTENSIONS.some((extension) =>
      existsSync(path.join(directory, `route.${extension}`)),
    );
  });
}

function containsFile(directory: string, pattern: RegExp): boolean {
  if (!existsSync(directory)) return false;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile() && pattern.test(entry.name)) return true;
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        pending.push(path.join(current, entry.name));
      }
    }
  }
  return false;
}

function getStorageMountCount(storage: unknown): number {
  if (!storage || typeof storage !== "object") return 1;
  const mounts = asRecord((storage as Record<string, unknown>).mounts);
  return 1 + Object.keys(mounts).length;
}

function describeRootStorageDriver(storage: unknown): string {
  if (!storage || typeof storage !== "object") return "memory";
  const value = storage as Record<string, unknown>;
  if (value.kind === "farm-storage-client") return "storage client";
  if (value.client) return "storage client";
  if (typeof value.driver === "string") return value.driver;
  if (typeof value.driver === "function") return "custom";
  return "memory";
}

function findConfigFile(root: string, configPath?: string): string | undefined {
  const candidates = configPath ? [configPath, ...CONFIG_FILES] : CONFIG_FILES;
  return candidates
    .map((candidate) => (path.isAbsolute(candidate) ? candidate : path.join(root, candidate)))
    .find(existsSync);
}

function resolveLiveTarget(options: FarmDoctorOptions): string {
  const raw = options.url || `http://${options.host || "localhost"}:${options.port || 3000}`;
  return raw.replace(/\/+$/, "");
}

function hasExplicitLiveTarget(options: FarmDoctorOptions): boolean {
  return Boolean(options.url || options.host || options.port);
}

function isLiveSnapshot(value: unknown): value is LiveSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LiveSnapshot>;
  return Boolean(
    snapshot.project &&
    typeof snapshot.project.name === "string" &&
    snapshot.deployment &&
    typeof snapshot.deployment.target === "string" &&
    snapshot.counts &&
    typeof snapshot.counts.pages === "number" &&
    Array.isArray(snapshot.diagnostics),
  );
}

function emptySummary(): Record<FarmDoctorCheckStatus, number> {
  return { pass: 0, warn: 0, fail: 0, info: 0 };
}

function finalizeReport(report: FarmDoctorReport): void {
  const summary = emptySummary();
  for (const check of report.checks) summary[check.status] += 1;
  report.summary = summary;
  report.health = summary.fail > 0 ? "error" : summary.warn > 0 ? "attention" : "ready";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatCount(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
