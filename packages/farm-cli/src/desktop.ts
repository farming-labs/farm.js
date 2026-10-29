import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DesktopDevSession,
  DesktopShell,
  DesktopShellContext,
  ResolvedFarmDesktopConfig,
} from "@farm.js/core/desktop";
import { withProductionNodeEnv } from "@farm.js/core/internal/production-node-env";
import { detectFarmPackageManager } from "./upgrade";

export type FarmDesktopErrorCode =
  | "config-missing"
  | "shell-missing"
  | "shell-invalid"
  | "server-address"
  | "unsafe-output";

export class FarmDesktopError extends Error {
  readonly code: FarmDesktopErrorCode;

  constructor(code: FarmDesktopErrorCode, message: string) {
    super(message);
    this.name = "FarmDesktopError";
    this.code = code;
  }
}

export interface FarmDesktopCommandOptions {
  root?: string;
  port?: number;
  /** `--profile`, passed to a function-valued `desktop` block. Defaults to "production". */
  profile?: string;
}

const HOOK_FILE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];

/** `--desktop` and `--web` are the only way the platform is chosen, so a stale env never leaks in. */
export function setFarmPlatform(platform: "web" | "desktop"): void {
  if (platform === "desktop") process.env.FARM_PLATFORM = "desktop";
  else delete process.env.FARM_PLATFORM;
}

function readPackageManagerField(root: string): unknown {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).packageManager;
  } catch {
    return undefined;
  }
}

/** The install command for a missing adapter, in the app's package manager. */
export function formatDesktopShellInstallCommand(root: string, packageName: string): string {
  const manager = detectFarmPackageManager(root, readPackageManagerField(root));
  const add = manager === "npm" ? "npm install -D" : `${manager} add -D`;
  return `${add} ${packageName}`;
}

function isDesktopShell(value: unknown): value is DesktopShell {
  const shell = value as Partial<DesktopShell> | null;
  return (
    !!shell &&
    typeof shell === "object" &&
    typeof shell.name === "string" &&
    (shell.runtime === "bun" || shell.runtime === "node") &&
    typeof shell.generateMain === "function" &&
    typeof shell.dev === "function" &&
    typeof shell.package === "function"
  );
}

/** Import the adapter for `desktop.shell` from the app, or say how to install it. */
export async function loadFarmDesktopShell(
  desktop: Pick<ResolvedFarmDesktopConfig, "shell" | "shellPackage">,
  root: string,
): Promise<DesktopShell> {
  const requireFromApp = createRequire(path.join(root, "package.json"));
  let entry: string;
  try {
    entry = requireFromApp.resolve(desktop.shellPackage);
  } catch {
    throw new FarmDesktopError(
      "shell-missing",
      `desktop.shell "${desktop.shell}" needs ${desktop.shellPackage}, which is not installed in ${root}.\n` +
        `Install it:\n  ${formatDesktopShellInstallCommand(root, desktop.shellPackage)}`,
    );
  }
  const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
  const shell = module.default;
  if (!isDesktopShell(shell)) {
    throw new FarmDesktopError(
      "shell-invalid",
      `${desktop.shellPackage} does not default-export a desktop shell (name, runtime, generateMain, dev, package).`,
    );
  }
  return shell;
}

function findHooksFile(root: string, srcDir: string): string | undefined {
  for (const extension of HOOK_FILE_EXTENSIONS) {
    const file = path.join(root, srcDir, `desktop${extension}`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Lists what the last generation wrote, so a file the adapter stopped generating goes away. */
const GENERATED_MANIFEST = ".farm-generated.json";

/**
 * Write the adapter's files, refusing paths that would leave the shell directory. Everything
 * else in it (the shell's own caches and build folders) is left alone.
 */
async function writeShellFiles(
  shellDir: string,
  files: Array<{ path: string; contents: string }>,
): Promise<void> {
  await mkdir(shellDir, { recursive: true });
  const written = new Set<string>();
  for (const file of files) {
    const target = path.resolve(shellDir, file.path);
    const relative = path.relative(shellDir, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(file.path)) {
      throw new FarmDesktopError(
        "unsafe-output",
        `The desktop shell tried to write ${file.path} outside ${shellDir}.`,
      );
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents);
    written.add(relative);
  }
  const manifestPath = path.join(shellDir, GENERATED_MANIFEST);
  let previous: unknown = [];
  try {
    previous = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    // First generation.
  }
  for (const relative of Array.isArray(previous) ? previous : []) {
    if (typeof relative !== "string" || written.has(relative)) continue;
    const stale = path.resolve(shellDir, relative);
    if (!path.relative(shellDir, stale).startsWith("..")) await rm(stale, { force: true });
  }
  await writeFile(manifestPath, `${JSON.stringify([...written].sort(), null, 2)}\n`);
}

function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

type ConfigRuntime = typeof import("@farm.js/core/internal/config-runtime");
type ResolvedConfig = Awaited<ReturnType<ConfigRuntime["resolveConfig"]>>;

function createShellContext(
  root: string,
  config: ResolvedConfig,
  runtime: ConfigRuntime,
): DesktopShellContext {
  const dirs = runtime.getFarmDesktopOutputDirs(config.distDir);
  return {
    root,
    desktop: config.desktop as ResolvedFarmDesktopConfig,
    basePath: config.basePath === "/" ? "" : config.basePath,
    shellDir: path.resolve(root, dirs.shell),
    serverDir: path.resolve(root, config.deploy.outputDir),
    hooksFile: findHooksFile(root, config.srcDir),
  };
}

async function resolveDesktopConfig(
  root: string,
  mode: "development" | "production",
  runtime: ConfigRuntime,
  setup: Parameters<ConfigRuntime["installFarmDesktopSetup"]>[0],
  loadEnv?: Parameters<ConfigRuntime["loadConfig"]>[3],
): Promise<ResolvedConfig> {
  setFarmPlatform("desktop");
  // Desktop resolution lives outside resolveConfig, so web server bundles never carry it.
  runtime.installFarmDesktopSetup(setup);
  const userConfig = await runtime.loadConfig(root, undefined, mode, loadEnv);
  if (!userConfig) {
    throw new FarmDesktopError(
      "config-missing",
      'No Farm config found. Create farm.config.ts with a `desktop` entry, such as `desktop: { name: "Notes" }`.',
    );
  }
  return runtime.resolveConfig({ ...userConfig, root: userConfig.root ?? root }, mode);
}

/**
 * `farm dev --desktop`: the dev server with the desktop guard, and the shell's window on it.
 * Resolves when the window closes or the process is interrupted, after both have stopped.
 */
export async function devFarmDesktop(options: FarmDesktopCommandOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const runtime = await import("@farm.js/core/internal/config-runtime");
  const config = await resolveDesktopConfig(root, "development", runtime, {
    command: "dev",
    profile: options.profile,
  });
  const context = createShellContext(root, config, runtime);
  const shell = await loadFarmDesktopShell(context.desktop, root);

  const dataDir = path.resolve(root, runtime.getFarmDesktopOutputDirs(config.distDir).devData);
  process.env.FARM_DESKTOP_DATA_DIR = dataDir;
  const session = { secret: createSecret(), handshakeToken: createSecret() };
  runtime.setFarmDesktopDevSession(session);

  const { startDevServer } = await import("@farm.js/core/server");
  const server = await startDevServer({ root }, options.port);
  let shellSession: DesktopDevSession | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ||= (async () => {
      await shellSession?.close().catch((error: unknown) => {
        runtime.logger.error(`Failed to stop the desktop shell: ${String(error)}`);
      });
      await server.close();
      runtime.setFarmDesktopDevSession(undefined);
    })());

  try {
    const address = server.httpServer?.address();
    if (!address || typeof address !== "object") {
      throw new FarmDesktopError("server-address", "The dev server did not report its port.");
    }
    const devUrl = `http://localhost:${address.port}`;
    await writeShellFiles(context.shellDir, await shell.generateMain(context));
    shellSession = await shell.dev({
      ...context,
      devUrl,
      dataDir,
      ...session,
      env: {
        ...process.env,
        FARM_DESKTOP_DEV_URL: devUrl,
        FARM_DESKTOP_SECRET: session.secret,
        FARM_DESKTOP_HANDSHAKE_TOKEN: session.handshakeToken,
        FARM_DESKTOP_DATA_DIR: dataDir,
      },
    });
    runtime.logger.info(`Desktop window (${shell.name}) on ${devUrl}; app data in ${dataDir}`);
  } catch (error) {
    await stop();
    throw error;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      void stop().then(resolve, resolve);
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    shellSession?.exited.then(finish, finish);
  });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** `farm build --desktop`: the server for the shell's runtime, the generated shell, the app. */
export async function buildFarmDesktop(options: FarmDesktopCommandOptions = {}): Promise<string[]> {
  const root = path.resolve(options.root || process.cwd());
  return withProductionNodeEnv(async () => {
    const runtime = await import("@farm.js/core/internal/config-runtime");
    const productionVite = await runtime.loadFarmProductionVite();
    const config = await resolveDesktopConfig(
      root,
      "production",
      runtime,
      { command: "build", profile: options.profile },
      productionVite.loadEnv,
    );
    const context = createShellContext(root, config, runtime);
    const shell = await loadFarmDesktopShell(context.desktop, root);

    // The shell embeds the server, so its runtime picks the preset.
    const preset = shell.runtime === "node" ? "node-server" : "bun";
    config.preset = preset;
    config.deploy = { ...config.deploy, preset };
    const { build } = await import("@farm.js/core/internal/build-runtime");
    await build(config, { preset, root, productionVite });

    await writeShellFiles(context.shellDir, await shell.generateMain(context));
    const distDir = path.resolve(root, runtime.getFarmDesktopOutputDirs(config.distDir).dist);
    const artifacts = await shell.package({ ...context, distDir });
    for (const file of artifacts.files) {
      const size =
        existsSync(file) && statSync(file).isFile() ? ` (${formatSize(statSync(file).size)})` : "";
      runtime.logger.info(`📦 ${path.relative(root, file)}${size}`);
    }
    return artifacts.files;
  });
}

export interface FarmDesktopInspectOptions {
  root?: string;
  os?: "macos" | "windows" | "linux";
  profile?: string;
  command?: "dev" | "build";
}

/**
 * `farm config inspect --desktop`: the `desktop` block a dev session or build would use for an
 * OS and profile, with defaults filled in. Builds nothing and loads no shell.
 */
export async function inspectFarmDesktopConfig(
  options: FarmDesktopInspectOptions = {},
): Promise<{ context: Record<string, string>; desktop: ResolvedFarmDesktopConfig }> {
  const root = path.resolve(options.root || process.cwd());
  const command = options.command ?? "build";
  const mode = command === "dev" ? "development" : "production";
  const runtime = await import("@farm.js/core/internal/config-runtime");
  const userConfig = await runtime.loadConfig(root, undefined, mode);
  if (userConfig?.desktop === undefined) {
    throw new FarmDesktopError(
      "config-missing",
      'farm.config.ts has no `desktop` entry. Add one, such as `desktop: { name: "Notes" }`.',
    );
  }
  const context = runtime.createFarmDesktopContext({
    command,
    profile: options.profile,
    os: options.os,
    root,
    mode,
  });
  const block = await runtime.resolveFarmDesktopBlock(userConfig.desktop, context);
  return {
    context: { os: context.os, mode, command, profile: context.profile },
    desktop: runtime.resolveFarmDesktopConfig(block, root, context),
  };
}
