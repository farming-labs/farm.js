import {
  generateFarmTypeArtifacts,
  getFarmSourceRoots,
  getFarmDocsRouteTypeEntries,
  loadConfig,
  resolveConfig,
  type FarmCronJob,
  type ResolvedFarmConfig,
} from "@farm.js/core";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createHttpLocalUrl } from "./local-url";
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
  fixes?: FarmDoctorFix[];
}

export interface FarmDoctorFix {
  code: string;
  title: string;
  filePath: string;
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
  /** Verify the public beta dist-tags against the npm registry. */
  registry?: boolean;
  /** Apply only additive corrections that never overwrite application files. */
  fix?: boolean;
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

type ProjectPackageManifest = {
  name?: unknown;
  version?: unknown;
  packageManager?: unknown;
  workspaces?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
};

type FarmPackageManager = "npm" | "pnpm" | "yarn" | "bun";

type WorkspaceContext = {
  root: string;
  patterns: string[];
  packages: Map<string, string>;
};

const ROUTE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "vue", "md", "mdx"];
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
const PACKAGE_MANAGER_LOCKFILES: ReadonlyArray<readonly [FarmPackageManager, readonly string[]]> = [
  ["pnpm", ["pnpm-lock.yaml"]],
  ["yarn", ["yarn.lock"]],
  ["bun", ["bun.lock", "bun.lockb"]],
  ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
];
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const WORKSPACE_SCAN_IGNORES = new Set([
  ".farm",
  ".git",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export async function runFarmDoctor(options: FarmDoctorOptions = {}): Promise<FarmDoctorReport> {
  const root = path.resolve(options.root || process.cwd());
  const liveTarget = resolveLiveTarget(options);
  let liveError: string | undefined;

  if (!options.offline && !options.fix) {
    try {
      const snapshot = await fetchLiveSnapshot(liveTarget, options);
      const report = createLiveReport(snapshot, liveTarget, options.now);
      if (options.registry) {
        await collectRegistryChecks(readProjectManifestSafe(root), options, report.checks);
        finalizeReport(report);
      }
      return report;
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
  if (report.fixes?.length) {
    lines.push("", color.bold("FIXED"));
    for (const fix of report.fixes) {
      lines.push(`  ${color.green("✓")} ${fix.title}`);
      lines.push(`    ${color.dim(fix.filePath)}`);
    }
  }
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

/** Reported paths are shown to the user, so keep them POSIX on every platform. */
function toPosix(value: string) {
  return value.split(path.sep).join("/");
}

function createLiveReport(
  snapshot: LiveSnapshot,
  baseUrl: string,
  now: FarmDoctorOptions["now"],
): FarmDoctorReport {
  const runtimeHealth = snapshot.health ?? "ready";
  const runtimeHealthStatus: FarmDoctorCheckStatus =
    runtimeHealth === "error" ? "fail" : runtimeHealth === "attention" ? "warn" : "pass";
  const checks: FarmDoctorCheck[] = [
    {
      status: "pass",
      code: "LIVE_RUNTIME_READY",
      title: "Connected to the Farm runtime",
      message: `${formatCount(snapshot.counts.pages, "page")}, ${formatCount(snapshot.counts.apiRoutes, "API route")}, and ${formatCount(snapshot.counts.middleware, "middleware layer")} are registered.`,
    },
    {
      status: runtimeHealthStatus,
      code: "LIVE_RUNTIME_HEALTH",
      title: "Runtime health is reported",
      message: `The running Farm application reports ${runtimeHealth} health.`,
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
  const packageManifest = collectPackageChecks(root, options.env || process.env, checks);

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
      const configRoot = path.resolve(root, userConfig.root || ".");
      config = await resolveConfig({ ...userConfig, root: configRoot }, "development");
      const configFile = findConfigFile(root, options.configPath);
      checks.push({
        status: "pass",
        code: "CONFIG_VALID",
        title: "Farm config loads successfully",
        message: configFile
          ? toPosix(path.relative(root, configFile)) || path.basename(configFile)
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
    await collectGeneratedArtifactChecks(config, options.configPath, root, checks);
    collectEntrypointChecks(config, root, checks);
    report.target = collectDeploymentChecks(config, userConfig, checks);
    collectCronChecks(config, options.env || process.env, checks);
  }

  if (options.registry) {
    await collectRegistryChecks(packageManifest, options, checks);
  }

  if (config && options.fix) {
    const fixes = applySafeProjectFixes(root, config, checks);
    if (fixes.length) {
      const refreshed = await createProjectReport(root, { ...options, fix: false });
      refreshed.fixes = fixes;
      return refreshed;
    }
    report.fixes = [];
  }

  finalizeReport(report);
  return report;
}

function applySafeProjectFixes(
  root: string,
  config: ResolvedFarmConfig,
  checks: readonly FarmDoctorCheck[],
): FarmDoctorFix[] {
  const fixes: FarmDoctorFix[] = [];
  if (checks.some((check) => check.code === "ROOT_LAYOUT_MISSING")) {
    const rendererExtension = config.renderer.componentExtensions?.[0] || ".tsx";
    const layoutPath = path.join(config.root, config.srcDir, "app", `layout${rendererExtension}`);
    if (!existsSync(layoutPath)) {
      const source = createRootLayoutSource(config.renderer.name);
      if (!source) return fixes;
      mkdirSync(path.dirname(layoutPath), { recursive: true });
      writeFileSync(layoutPath, source, { encoding: "utf8", flag: "wx" });
      fixes.push({
        code: "ROOT_LAYOUT_CREATED",
        title: "Created the missing root layout",
        filePath: toPosix(path.relative(root, layoutPath)),
      });
    }
  }
  return fixes;
}

function createRootLayoutSource(renderer: string): string | undefined {
  if (renderer === "vue") {
    return `<script setup lang="ts">\ndefineOptions({ inheritAttrs: false });\n</script>\n\n<template>\n  <slot />\n</template>\n`;
  }
  if (renderer === "solid") {
    return `import type { ParentProps } from "solid-js";\n\nexport default function RootLayout(props: ParentProps) {\n  return <>{props.children}</>;\n}\n`;
  }
  if (renderer === "preact") {
    return `import type { ComponentChildren } from "preact";\n\nexport default function RootLayout({ children }: { children?: ComponentChildren }) {\n  return <>{children}</>;\n}\n`;
  }
  if (renderer === "svelte") {
    return `<script lang="ts">\n  import type { Snippet } from "svelte";\n\n  let { children }: { children?: Snippet } = $props();\n</script>\n\n{@render children?.()}\n`;
  }
  if (renderer !== "react") return undefined;
  return `import type { ReactNode } from "react";\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n`;
}

function collectNodeCheck(checks: FarmDoctorCheck[]): void {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const supported = major > 22 || (major === 22 && minor >= 13);
  checks.push(
    supported
      ? {
          status: "pass",
          code: "NODE_SUPPORTED",
          title: "Node.js is supported",
          message: `Node ${process.versions.node} satisfies Farm's Node 22.13+ baseline.`,
        }
      : {
          status: "fail",
          code: "NODE_UNSUPPORTED",
          title: "Node.js is too old",
          message: `Node ${process.versions.node} does not satisfy Farm's Node 22.13+ baseline.`,
          action: "Upgrade Node.js to version 22.13 or newer.",
        },
  );
}

function collectPackageChecks(
  root: string,
  env: Record<string, string | undefined>,
  checks: FarmDoctorCheck[],
): ProjectPackageManifest | undefined {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) {
    checks.push({
      status: "fail",
      code: "PACKAGE_MISSING",
      title: "package.json was not found",
      message: `No package manifest exists under ${root}.`,
      action: "Run the command from a Farm application root.",
    });
    return undefined;
  }

  try {
    const manifest = readProjectManifest(root);
    if (!manifest) return undefined;
    const dependencies = getProjectDependencies(manifest);
    const version = dependencies["@farm.js/core"];
    checks.push(
      typeof version === "string"
        ? {
            status: "pass",
            code: "CORE_INSTALLED",
            title: "Farm core is installed",
            message: `@farm.js/core ${version}`,
          }
        : {
            status: "fail",
            code: "CORE_MISSING",
            title: "Farm core is not declared",
            message: "@farm.js/core is missing from package.json.",
            action: "Install @farm.js/core and add it to the application dependencies.",
          },
    );
    const workspace = findWorkspaceContext(root);
    collectPackageManagerChecks(root, manifest, workspace, env, checks);
    collectLocalPackageChecks(root, dependencies, workspace, checks);
    return manifest;
  } catch (error) {
    checks.push({
      status: "fail",
      code: "PACKAGE_INVALID",
      title: "package.json is invalid",
      message: formatError(error),
      action: "Fix the package manifest JSON.",
    });
    return undefined;
  }
}

function readProjectManifest(root: string): ProjectPackageManifest | undefined {
  const packagePath = path.join(root, "package.json");
  if (!existsSync(packagePath)) return undefined;
  return JSON.parse(readFileSync(packagePath, "utf8")) as ProjectPackageManifest;
}

function readProjectManifestSafe(root: string): ProjectPackageManifest | undefined {
  try {
    return readProjectManifest(root);
  } catch {
    return undefined;
  }
}

function getProjectDependencies(manifest: ProjectPackageManifest): Record<string, unknown> {
  return Object.assign({}, ...DEPENDENCY_SECTIONS.map((section) => asRecord(manifest[section])));
}

function collectPackageManagerChecks(
  root: string,
  manifest: ProjectPackageManifest,
  workspace: WorkspaceContext | undefined,
  env: Record<string, string | undefined>,
  checks: FarmDoctorCheck[],
): void {
  const workspaceManifest = workspace ? readProjectManifestSafe(workspace.root) : undefined;
  const packageManagerField =
    typeof manifest.packageManager === "string"
      ? manifest.packageManager
      : typeof workspaceManifest?.packageManager === "string"
        ? workspaceManifest.packageManager
        : undefined;
  const declared = parsePackageManager(packageManagerField);
  const lockfileRoot = workspace?.root || root;
  const lockfileManagers = PACKAGE_MANAGER_LOCKFILES.filter(([, files]) =>
    files.some((file) => existsSync(path.join(lockfileRoot, file))),
  ).map(([manager]) => manager);
  const manager = declared?.name || lockfileManagers[0] || "npm";
  const conflicts = new Set<FarmPackageManager>();
  if (lockfileManagers.length > 1) lockfileManagers.forEach((entry) => conflicts.add(entry));
  if (declared && lockfileManagers.some((entry) => entry !== declared.name)) {
    conflicts.add(declared.name);
    lockfileManagers.forEach((entry) => conflicts.add(entry));
  }

  if (conflicts.size > 0) {
    checks.push({
      status: "warn",
      code: "PACKAGE_MANAGER_CONFLICT",
      title: "Package-manager signals disagree",
      message: `Farm found conflicting package-manager signals: ${[...conflicts].sort().join(", ")}.`,
      action: "Keep one lockfile and align the packageManager field with it.",
    });
  } else {
    checks.push({
      status: "pass",
      code: "PACKAGE_MANAGER_RESOLVED",
      title: "Package manager is resolved",
      message: `${manager}${declared?.version ? ` ${declared.version}` : ""} is selected${workspace ? ` from workspace ${toPosix(path.relative(root, workspace.root)) || "."}` : ""}.`,
    });
  }

  if (manager !== "pnpm") return;
  const userAgentVersion = parsePnpmUserAgent(env.npm_config_user_agent);
  const version = userAgentVersion || declared?.version;
  if (!version) {
    checks.push({
      status: "warn",
      code: "PNPM_VERSION_UNKNOWN",
      title: "pnpm version could not be verified",
      message:
        "Farm selected pnpm, but neither packageManager nor the current user agent includes its version.",
      action: "Declare packageManager as pnpm@8 or newer in package.json.",
    });
    return;
  }

  const supported = isVersionAtLeast(version, 8, 0);
  checks.push(
    supported
      ? {
          status: "pass",
          code: "PNPM_SUPPORTED",
          title: "pnpm is supported",
          message: `pnpm ${version} satisfies Farm's pnpm 8+ baseline.`,
        }
      : {
          status: "fail",
          code: "PNPM_UNSUPPORTED",
          title: "pnpm is too old",
          message: `pnpm ${version} does not satisfy Farm's pnpm 8+ baseline.`,
          action: "Upgrade pnpm to version 8 or newer and reinstall the workspace.",
        },
  );
}

function parsePackageManager(
  value: string | undefined,
): { name: FarmPackageManager; version?: string } | undefined {
  if (!value) return undefined;
  const match = /^(npm|pnpm|yarn|bun)(?:@([^+\s]+))?/.exec(value.trim());
  if (!match) return undefined;
  return {
    name: match[1] as FarmPackageManager,
    ...(match[2] ? { version: match[2] } : {}),
  };
}

function parsePnpmUserAgent(value: string | undefined): string | undefined {
  const match = /(?:^|\s)pnpm\/([^\s]+)/.exec(value || "");
  return match?.[1];
}

function isVersionAtLeast(value: string, minimumMajor: number, minimumMinor: number): boolean {
  const match = /^(\d+)\.(\d+)/.exec(value);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}

function collectLocalPackageChecks(
  root: string,
  dependencies: Record<string, unknown>,
  workspace: WorkspaceContext | undefined,
  checks: FarmDoctorCheck[],
): void {
  const resolved: string[] = [];
  const missing: string[] = [];
  const unverifiedCatalogs: string[] = [];

  for (const [name, rawSpecifier] of Object.entries(dependencies)) {
    if (typeof rawSpecifier !== "string") continue;
    if (rawSpecifier.startsWith("workspace:")) {
      const target = getWorkspaceTargetName(name, rawSpecifier);
      if (workspace?.packages.has(target)) resolved.push(name);
      else missing.push(`${name} (${rawSpecifier})`);
      continue;
    }
    if (rawSpecifier.startsWith("catalog:")) {
      if (workspace) unverifiedCatalogs.push(name);
      else missing.push(`${name} (${rawSpecifier})`);
      continue;
    }
    const localPrefix = ["file:", "link:", "portal:"].find((prefix) =>
      rawSpecifier.startsWith(prefix),
    );
    if (!localPrefix) continue;
    const target = rawSpecifier.slice(localPrefix.length);
    const targetPath = path.resolve(root, target);
    if (!existsSync(targetPath)) {
      missing.push(`${name} (${rawSpecifier})`);
      continue;
    }
    const localManifest = readProjectManifestSafe(targetPath);
    if (localManifest && typeof localManifest.name === "string" && localManifest.name !== name) {
      missing.push(`${name} (${rawSpecifier} points to ${localManifest.name})`);
      continue;
    }
    resolved.push(name);
  }

  if (missing.length > 0) {
    checks.push({
      status: "fail",
      code: "LOCAL_PACKAGES_MISSING",
      title: "Local package references are unresolved",
      message: missing.sort().join(", "),
      action: "Add the missing package to the workspace or replace the local dependency specifier.",
    });
  } else if (resolved.length > 0) {
    checks.push({
      status: "pass",
      code: "LOCAL_PACKAGES_RESOLVED",
      title: "Local package references resolve",
      message: resolved.sort().join(", "),
    });
  }

  if (unverifiedCatalogs.length > 0) {
    checks.push({
      status: "info",
      code: "WORKSPACE_CATALOG_USED",
      title: "Workspace catalog dependencies are delegated to pnpm",
      message: unverifiedCatalogs.sort().join(", "),
    });
  }
}

function getWorkspaceTargetName(name: string, specifier: string): string {
  const target = specifier.slice("workspace:".length);
  if (!target.startsWith("@")) return name;
  const versionSeparator = target.indexOf("@", 1);
  return versionSeparator === -1 ? target : target.slice(0, versionSeparator);
}

function findWorkspaceContext(start: string): WorkspaceContext | undefined {
  let current = path.resolve(start);
  while (true) {
    const patterns = readWorkspacePatterns(current);
    if (patterns.length > 0) {
      return {
        root: current,
        patterns,
        packages: discoverWorkspacePackages(current, patterns),
      };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readWorkspacePatterns(root: string): string[] {
  const workspaceFile = path.join(root, "pnpm-workspace.yaml");
  if (existsSync(workspaceFile)) {
    const patterns: string[] = [];
    let packagesIndent: number | undefined;
    for (const line of readFileSync(workspaceFile, "utf8").split(/\r?\n/)) {
      const key = /^(\s*)packages\s*:\s*(?:#.*)?$/.exec(line);
      if (key) {
        packagesIndent = key[1].length;
        continue;
      }
      if (packagesIndent === undefined) continue;
      const indentation = /^(\s*)/.exec(line)?.[1].length || 0;
      if (line.trim() && indentation <= packagesIndent) break;
      const pattern = /^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line)?.[1]?.trim();
      if (pattern) patterns.push(pattern);
    }
    if (patterns.length > 0) return patterns;
  }

  const manifest = readProjectManifestSafe(root);
  const workspaces = manifest?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((value): value is string => typeof value === "string");
  }
  if (workspaces && typeof workspaces === "object") {
    const packages = (workspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((value): value is string => typeof value === "string");
    }
  }
  return [];
}

function discoverWorkspacePackages(root: string, patterns: readonly string[]): Map<string, string> {
  const packages = new Map<string, string>();
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) continue;
    const relative = toPosix(path.relative(root, entry.directory)) || ".";
    const manifest = readProjectManifestSafe(entry.directory);
    if (manifest && typeof manifest.name === "string" && matchesWorkspacePath(relative, patterns)) {
      packages.set(manifest.name, entry.directory);
    }
    if (entry.depth >= 8) continue;
    for (const child of readdirSync(entry.directory, { withFileTypes: true })) {
      if (!child.isDirectory() || WORKSPACE_SCAN_IGNORES.has(child.name)) continue;
      if (child.name.startsWith(".") && entry.depth > 0) continue;
      pending.push({ directory: path.join(entry.directory, child.name), depth: entry.depth + 1 });
    }
  }

  return packages;
}

function matchesWorkspacePath(relative: string, patterns: readonly string[]): boolean {
  let matched = false;
  for (const rawPattern of patterns) {
    const excluded = rawPattern.startsWith("!");
    const pattern = excluded ? rawPattern.slice(1) : rawPattern;
    if (!globPatternToRegExp(pattern).test(relative)) continue;
    matched = !excluded;
  }
  return matched;
}

function globPatternToRegExp(value: string): RegExp {
  const pattern = toPosix(value).replace(/^\.\//, "").replace(/\/$/, "");
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

async function collectGeneratedArtifactChecks(
  config: ResolvedFarmConfig,
  configPath: string | undefined,
  reportRoot: string,
  checks: FarmDoctorCheck[],
): Promise<void> {
  try {
    const result = await generateFarmTypeArtifacts({
      root: config.root,
      srcDir: config.srcDir,
      configPath,
      layers: config.layers,
      plugins: config.plugins,
      extraRoutes: [
        ...(config.openapi?.enabled && config.openapi.route ? [config.openapi.route] : []),
        ...getFarmDocsRouteTypeEntries(config.docs),
      ],
      suppressLintOnLink: config.suppressLintOnLink,
      componentExtensions: config.renderer.componentExtensions,
      i18nConfig: config.i18n,
      check: true,
    });
    const stalePaths = [...new Set(result.stalePaths)]
      .map((filePath) => toPosix(path.relative(reportRoot, filePath)))
      .sort();
    checks.push(
      stalePaths.length === 0
        ? {
            status: "pass",
            code: "GENERATED_ARTIFACTS_CURRENT",
            title: "Generated framework types are current",
            message: "Route, API, environment, content, and i18n declarations match the project.",
          }
        : {
            status: "fail",
            code: "GENERATED_ARTIFACTS_STALE",
            title: "Generated framework types are stale",
            message: stalePaths.join(", "),
            action: "Run farm generate and commit the updated generated files.",
          },
    );
  } catch (error) {
    checks.push({
      status: "fail",
      code: "GENERATED_ARTIFACTS_CHECK_FAILED",
      title: "Generated framework types could not be checked",
      message: formatError(error),
      action: "Run farm generate to reproduce and fix the generation error.",
    });
  }
}

function collectEntrypointChecks(
  config: ResolvedFarmConfig,
  root: string,
  checks: FarmDoctorCheck[],
): void {
  const rendererRequire = createRequire(path.join(config.root, "package.json"));
  const entrypoints = [config.renderer.vite, config.renderer.server, config.renderer.client].filter(
    (value, index, values): value is string =>
      typeof value === "string" && value.length > 0 && values.indexOf(value) === index,
  );
  const missing = entrypoints.filter((specifier) => {
    if (config.renderer.name === "react" && specifier.startsWith("@farm.js/core/renderer/react/")) {
      return false;
    }
    try {
      rendererRequire.resolve(specifier);
      return false;
    } catch {
      return true;
    }
  });

  checks.push(
    missing.length === 0
      ? {
          status: "pass",
          code: "RENDERER_ENTRYPOINTS_READY",
          title: `${config.renderer.name} renderer entrypoints resolve`,
          message: entrypoints.join(", "),
        }
      : {
          status: "fail",
          code: "RENDERER_ENTRYPOINTS_MISSING",
          title: `${config.renderer.name} renderer entrypoints are missing`,
          message: missing.join(", "),
          action: `Install the ${config.renderer.name} renderer package and verify its vite, server, and client exports.`,
        },
  );

  const integrations = Object.entries(config.integrations || {})
    .filter(([, integration]) => Boolean(integration))
    .map(
      ([key, integration]) =>
        `${key} (${String((integration as { type?: unknown }).type || "unknown")})`,
    )
    .sort();
  if (integrations.length > 0) {
    checks.push({
      status: "pass",
      code: "INTEGRATION_ENTRYPOINTS_READY",
      title: "Configured integration entrypoints loaded",
      message: integrations.join(", "),
    });
  }

  const packageRequire = createRequire(path.join(root, "package.json"));
  const dependencies = getProjectDependencies(readProjectManifestSafe(root) || {});
  const missingFarmPackages = Object.entries(dependencies)
    .filter(
      ([name, specifier]) =>
        name.startsWith("@farm.js/") &&
        name !== "@farm.js/core" &&
        typeof specifier === "string" &&
        !specifier.startsWith("workspace:") &&
        !specifier.startsWith("file:") &&
        !specifier.startsWith("link:") &&
        !specifier.startsWith("portal:"),
    )
    .map(([name]) => name)
    .filter((name) => {
      try {
        packageRequire.resolve(name);
        return false;
      } catch {
        return true;
      }
    });
  if (missingFarmPackages.length > 0) {
    checks.push({
      status: "warn",
      code: "FARM_PACKAGES_NOT_INSTALLED",
      title: "Declared Farm packages are not installed",
      message: missingFarmPackages.sort().join(", "),
      action: "Run the selected package manager's install command.",
    });
  }
}

type RegistryPackageMetadata = {
  "dist-tags"?: Record<string, unknown>;
  versions?: Record<string, unknown>;
};

async function collectRegistryChecks(
  manifest: ProjectPackageManifest | undefined,
  options: FarmDoctorOptions,
  checks: FarmDoctorCheck[],
): Promise<void> {
  const packageNames = ["@farm.js/core", "@farm.js/create-app"];
  const fetchRegistry = options.fetch || globalThis.fetch;
  const resolved: Array<{ name: string; beta: string }> = [];

  try {
    for (const name of packageNames) {
      const response = await fetchRegistry(
        `https://registry.npmjs.org/${encodeURIComponent(name)}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(`${name} returned ${response.status}.`);
      }
      const metadata = (await response.json()) as RegistryPackageMetadata;
      const beta = metadata["dist-tags"]?.beta;
      if (typeof beta !== "string") {
        checks.push({
          status: "fail",
          code: "REGISTRY_BETA_MISSING",
          title: `${name} has no beta dist-tag`,
          message: "The registry cannot resolve the beta release channel.",
          action: `Publish or repair the beta dist-tag for ${name}.`,
        });
        continue;
      }
      if (!metadata.versions || !Object.prototype.hasOwnProperty.call(metadata.versions, beta)) {
        checks.push({
          status: "fail",
          code: "REGISTRY_BETA_INVALID",
          title: `${name}@beta points to a missing version`,
          message: `${name}@beta resolves to ${beta}, but that version is absent from the registry metadata.`,
          action: `Repair the beta dist-tag for ${name}.`,
        });
        continue;
      }
      resolved.push({ name, beta });
    }
  } catch (error) {
    checks.push({
      status: "warn",
      code: "REGISTRY_UNREACHABLE",
      title: "The npm registry could not be checked",
      message: formatError(error),
      action: "Verify registry connectivity and run farm doctor --registry again.",
    });
    return;
  }

  if (resolved.length === packageNames.length) {
    checks.push({
      status: "pass",
      code: "REGISTRY_BETA_RESOLVED",
      title: "Farm beta dist-tags resolve",
      message: resolved.map(({ name, beta }) => `${name}@beta -> ${beta}`).join(", "),
    });
  }

  const dependencies = manifest ? getProjectDependencies(manifest) : {};
  const stale = resolved.filter(({ name, beta }) => {
    const declared = dependencies[name];
    return typeof declared === "string" && isExactVersion(declared) && declared !== beta;
  });
  if (stale.length > 0) {
    checks.push({
      status: "warn",
      code: "FARM_BETA_STALE",
      title: "Installed Farm beta declarations are stale",
      message: stale
        .map(
          ({ name, beta }) =>
            `${name} declares ${String(dependencies[name])}; registry beta is ${beta}`,
        )
        .join(", "),
      action:
        "Run farm upgrade --beta, or refresh the scaffold command with PNPM_CONFIG_DLX_CACHE_MAX_AGE=0.",
    });
  }
}

function isExactVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function collectRouterChecks(config: ResolvedFarmConfig, checks: FarmDoctorCheck[]): void {
  const sources = getFarmSourceRoots(config);
  const appDirectories = sources.map((source) => path.join(source.root, source.srcDir, "app"));
  const routeExtensions = [
    ...new Set([
      ...ROUTE_EXTENSIONS,
      ...(config.renderer.componentExtensions ?? []).map((extension) =>
        extension.replace(/^\./, ""),
      ),
    ]),
  ];
  const pageFilePattern = new RegExp(`^page\\.(?:${routeExtensions.map(escapeRegExp).join("|")})$`);
  const suggestedRouteExtension = config.renderer.componentExtensions?.[0] || ".tsx";
  const hasPages = appDirectories.some((directory) => containsFile(directory, pageFilePattern));
  const hasProgrammaticRoutes = sources.some((source) =>
    routeExtensions.some((extension) =>
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
          action: `Add ${config.srcDir}/app/page${suggestedRouteExtension} or ${config.srcDir}/farm.routes${suggestedRouteExtension}.`,
        },
  );

  const hasRootLayout = appDirectories.some((directory) =>
    routeExtensions.some((extension) => existsSync(path.join(directory, `layout.${extension}`))),
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
          action: `Add ${config.srcDir}/app/layout${suggestedRouteExtension}.`,
        },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const relative = resolveCronSourceRelativePath(config, job.path);
  if (relative === undefined) return false;
  return getFarmSourceRoots(config).some((source) => {
    const directory = path.join(source.root, source.srcDir, "app", "api", relative);
    return ROUTE_EXTENSIONS.some((extension) =>
      existsSync(path.join(directory, `route.${extension}`)),
    );
  });
}

function resolveCronSourceRelativePath(
  config: ResolvedFarmConfig,
  cronPath: string,
): string | undefined {
  const serverBasePath = config.api.baseURL.startsWith("/") ? config.api.basePath : "/api";
  if (serverBasePath === "/") return cronPath.replace(/^\/+/, "");
  if (cronPath === serverBasePath) return "";
  if (!cronPath.startsWith(`${serverBasePath}/`)) return undefined;
  return cronPath.slice(serverBasePath.length + 1);
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
  const raw = options.url || createHttpLocalUrl(options.host || "localhost", options.port || 3000);
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
    (snapshot.health === undefined ||
      snapshot.health === "ready" ||
      snapshot.health === "attention" ||
      snapshot.health === "error") &&
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
