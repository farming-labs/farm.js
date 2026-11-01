import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import type { FarmDeployConfig, FarmUserConfig } from "../config";
import type { FarmPlatform } from "../platform";

export type { FarmPlatform };

/** Environment variable the CLI sets for `--desktop`. Anything other than "desktop" means web. */
export const FARM_PLATFORM_ENV = "FARM_PLATFORM";

/** Where `farm dev --desktop` leaves the session for the dev server in the same process. */
export const FARM_DESKTOP_DEV_SESSION = Symbol.for("@farm.js/core/desktop-dev-session");

export interface FarmDesktopDevSession {
  secret: string;
  handshakeToken: string;
  /** Set by the dev guard once the window used the token, so a Vite restart cannot reopen it. */
  handshakeUsed?: boolean;
}

/** Called by the CLI before it starts the dev server for `farm dev --desktop`. */
export function setFarmDesktopDevSession(session: FarmDesktopDevSession | undefined): void {
  const store = globalThis as Record<PropertyKey, unknown>;
  if (session) store[FARM_DESKTOP_DEV_SESSION] = session;
  else delete store[FARM_DESKTOP_DEV_SESSION];
}

export function resolveFarmPlatform(env: NodeJS.ProcessEnv = process.env): FarmPlatform {
  return env[FARM_PLATFORM_ENV] === "desktop" ? "desktop" : "web";
}

export interface FarmDesktopWindowConfig {
  /** Initial width in points. Defaults to 1024. */
  width?: number;
  /** Initial height in points. Defaults to 768. */
  height?: number;
  /** Window title. Defaults to `desktop.name`. */
  title?: string;
}

export interface FarmDesktopUserConfig {
  /** Display name of the app. Defaults to the package.json `productName` or `name`. */
  name?: string;
  /**
   * Reverse-DNS app identifier, such as `com.example.notes`. The OS keys the app's data
   * directory on it, so changing it later moves the user's data. Defaults to `local.farm.<name>`.
   */
  id?: string;
  /** App version. Defaults to the package.json `version`. */
  version?: string;
  /**
   * App icon: a square PNG, relative to the app root. 1024×1024 is recommended; the OS scales it
   * down. Defaults to the Farm icon.
   */
  icon?: string;
  window?: FarmDesktopWindowConfig;
  /**
   * Desktop shell adapter. A name resolves to `@farm.js/desktop/<name>`; a package name or
   * subpath (containing `/`) is imported as is. Defaults to `"electrobun"`.
   */
  shell?: "electrobun" | (string & {});
}

/** What a function-valued `desktop` block receives. Resolved once per dev start or build. */
export interface FarmDesktopContext {
  /** The OS the app is built for. Builds target the host OS. */
  os: "macos" | "windows" | "linux";
  mode: "development" | "production";
  command: "dev" | "build";
  /** `--profile`, `"production"` by default. */
  profile: string;
  env: Readonly<Record<string, string | undefined>>;
  /** App root. */
  root: string;
}

/**
 * `desktop` in farm.config: a static block, or a function of the platform context that returns
 * one. The function runs in the CLI only; its code never reaches a server or browser bundle.
 */
export type FarmDesktopConfigInput =
  | FarmDesktopUserConfig
  | ((context: FarmDesktopContext) => FarmDesktopUserConfig | Promise<FarmDesktopUserConfig>);

export interface ResolvedFarmDesktopConfig {
  name: string;
  id: string;
  version: string;
  /** Absolute path of the app's icon PNG, or undefined for the shell's default icon. */
  icon?: string;
  window: { width: number; height: number; title: string };
  /** Adapter name, as configured. */
  shell: string;
  /** Module the CLI imports the adapter from, such as `@farm.js/desktop/electrobun`. */
  shellPackage: string;
}

const DESKTOP_KEYS = new Set(["name", "id", "version", "icon", "window", "shell"]);
const WINDOW_KEYS = new Set(["width", "height", "title"]);
const APP_ID = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const SHELL_NAME = /^[a-z][a-z0-9-]*$/;
const SHELL_PACKAGE =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

let failPrefix = "desktop";

function fail(message: string): never {
  throw new TypeError(`${failPrefix}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`unknown option ${where}${key}. Supported: ${[...allowed].join(", ")}.`);
    }
  }
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) fail(`${key} must be a non-empty string.`);
  return value.trim();
}

function optionalSize(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 16384) {
    fail(`${key} must be a whole number of points between 100 and 16384.`);
  }
  return value;
}

/**
 * Check a `desktop` block. Web builds check a static block this way (a function-valued block is
 * not called there); desktop builds check the value a function returned, naming the OS.
 */
export function validateFarmDesktopConfig(
  input: unknown,
  context?: Pick<FarmDesktopContext, "os">,
): FarmDesktopUserConfig | undefined {
  failPrefix = context ? `desktop (os: ${context.os})` : "desktop";
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) {
    fail(
      context
        ? 'the function must return an object, such as { name: "Notes" }.'
        : 'must be an object, such as { name: "Notes" }, or a function that returns one.',
    );
  }
  checkKeys(input, DESKTOP_KEYS, "");
  optionalString(input.name, "name");
  const id = optionalString(input.id, "id");
  if (id !== undefined && !APP_ID.test(id)) {
    fail(`id must be a reverse-DNS identifier such as "com.example.notes", got "${id}".`);
  }
  optionalString(input.version, "version");
  const icon = optionalString(input.icon, "icon");
  if (icon !== undefined && !/\.png$/i.test(icon)) {
    fail(`icon must be a PNG file, such as "src/app-icon.png", got "${icon}".`);
  }
  if (input.window !== undefined) {
    if (!isPlainObject(input.window)) fail("window must be an object, such as { width: 1024 }.");
    checkKeys(input.window, WINDOW_KEYS, "window.");
    optionalSize(input.window.width, "window.width");
    optionalSize(input.window.height, "window.height");
    optionalString(input.window.title, "window.title");
  }
  const shell = optionalString(input.shell, "shell");
  if (shell !== undefined && !SHELL_NAME.test(shell) && !shell.includes("/")) {
    fail(`shell must be an adapter name such as "electrobun" or a package name, got "${shell}".`);
  }
  if (shell !== undefined && shell.includes("/") && !SHELL_PACKAGE.test(shell)) {
    fail(`shell "${shell}" is not a valid package name.`);
  }
  return input as FarmDesktopUserConfig;
}

function readPackageJson(root: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function slug(value: string): string {
  return (
    value
      .replace(/^@[^/]+\//, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  );
}

/** The module a `desktop.shell` value imports: built-in shells are `@farm.js/desktop` subpaths. */
export function resolveFarmDesktopShellPackage(shell: string): string {
  return shell.includes("/") ? shell : `@farm.js/desktop/${shell}`;
}

/** Fill in `desktop` defaults for a desktop dev session or build. */
/** Fill in defaults for an already resolved (static or returned) `desktop` block. */
export function resolveFarmDesktopConfig(
  input: FarmDesktopUserConfig | undefined,
  root: string,
  context?: Pick<FarmDesktopContext, "os">,
): ResolvedFarmDesktopConfig {
  const config = validateFarmDesktopConfig(input, context) ?? {};
  const pkg = readPackageJson(root);
  const packageName =
    (typeof pkg.productName === "string" && pkg.productName.trim()) ||
    (typeof pkg.name === "string" && pkg.name.replace(/^@[^/]+\//, "").trim()) ||
    path.basename(root);
  const name = config.name?.trim() || packageName || "Farm App";
  const shell = config.shell?.trim() || "electrobun";
  const icon = config.icon ? path.resolve(root, config.icon.trim()) : undefined;
  if (icon && !existsSync(icon)) fail(`icon ${config.icon} was not found in ${root}.`);
  return {
    name,
    id: config.id?.trim() || `local.farm.${slug(name)}`,
    version:
      config.version?.trim() || (typeof pkg.version === "string" && pkg.version.trim()) || "0.0.0",
    ...(icon ? { icon } : {}),
    window: {
      width: config.window?.width ?? 1024,
      height: config.window?.height ?? 768,
      title: config.window?.title?.trim() || name,
    },
    shell,
    shellPackage: resolveFarmDesktopShellPackage(shell),
  };
}

/** Where `farm build --desktop` writes its outputs, relative to the app root. */
export function getFarmDesktopOutputDirs(distDir: string): {
  root: string;
  server: string;
  shell: string;
  dist: string;
  devData: string;
} {
  const root = path.join(distDir, "output", "desktop");
  return {
    root,
    server: path.join(root, "server"),
    shell: path.join(root, "shell"),
    dist: path.join(root, "dist"),
    devData: path.join(distDir, "data", "desktop"),
  };
}

export function getFarmHostDesktopOS(
  platform: NodeJS.Platform = process.platform,
): FarmDesktopContext["os"] {
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
}

export interface FarmDesktopSetupOptions {
  command: FarmDesktopContext["command"];
  /** `--profile`; defaults to `"production"`. */
  profile?: string;
  /** Target OS; defaults to the host. `farm config inspect --os` sets another one. */
  os?: FarmDesktopContext["os"];
}

const DESKTOP_OS = new Set(["macos", "windows", "linux"]);

/** The context a function-valued block receives. `env` is a frozen snapshot. */
export function createFarmDesktopContext(
  options: FarmDesktopSetupOptions & { root: string; mode: FarmDesktopContext["mode"] },
): FarmDesktopContext {
  const os = options.os ?? getFarmHostDesktopOS();
  if (!DESKTOP_OS.has(os)) {
    throw new TypeError(`--os must be macos, windows, or linux, got "${os}".`);
  }
  const profile = options.profile ?? "production";
  if (typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) {
    throw new TypeError(`--profile must be a name such as "beta", got "${String(profile)}".`);
  }
  return Object.freeze({
    os,
    mode: options.mode,
    command: options.command,
    profile,
    env: Object.freeze({ ...process.env }),
    root: options.root,
  });
}

/** Results of function-valued blocks for one dev session or build. */
export type FarmDesktopBlockCache = Map<string, Promise<FarmDesktopUserConfig>>;

/**
 * The plain `desktop` block for a context: the static object, or what the function returned.
 * Validated, with errors naming the OS and field.
 *
 * With a cache, the function runs once per session: `farm dev` loads farm.config more than once
 * while it starts, and each load brings a new function with the same source. An edited block has
 * new source, so it runs again.
 */
export async function resolveFarmDesktopBlock(
  input: FarmDesktopConfigInput,
  context: FarmDesktopContext,
  cache?: FarmDesktopBlockCache,
): Promise<FarmDesktopUserConfig> {
  if (typeof input !== "function") {
    return validateFarmDesktopConfig(input, context) ?? {};
  }
  const call = () =>
    Promise.resolve()
      .then(() => input(context))
      .then((value) => validateFarmDesktopConfig(value, context) ?? {});
  if (!cache) return call();
  const key = [
    context.os,
    context.mode,
    context.command,
    context.profile,
    context.root,
    String(input),
  ].join("\0");
  let resolved = cache.get(key);
  if (!resolved) {
    resolved = call();
    cache.set(key, resolved);
    // A failed call runs again on the next resolution, after the app fixes farm.config.
    resolved.catch(() => cache.delete(key));
  }
  return resolved;
}

/** What the desktop setup hands back to `resolveConfig`. */
export interface FarmDesktopSetup {
  desktop: ResolvedFarmDesktopConfig;
  userConfig: FarmUserConfig;
  deploy: {
    preset: NonNullable<FarmDeployConfig["preset"]>;
    outputDir: string;
    env: NodeJS.ProcessEnv;
  };
}

/** @internal `resolveConfig` reads the setup from this global, so web builds carry none of it. */
export type FarmDesktopSetupHost = typeof globalThis & {
  [key: symbol]:
    | ((
        userConfig: FarmUserConfig,
        root: string,
        mode: FarmDesktopContext["mode"],
      ) => Promise<FarmDesktopSetup | undefined>)
    | undefined;
};

const FARM_DESKTOP_SETUP = Symbol.for("@farm.js/core/desktop-setup");

/**
 * Desktop resolution for a `--desktop` dev session or build: fills in `desktop`, turns off the
 * public-site features a local app cannot use (unless the app sets them), drops the image
 * optimizer (sharp's native binaries are ~18 MB), and builds the server for the shell instead of
 * `deploy.target`. Returns undefined on the web.
 */
export async function createFarmDesktopSetup(
  userConfig: FarmUserConfig,
  root: string,
  mode: FarmDesktopContext["mode"],
  options: FarmDesktopSetupOptions,
  cache?: FarmDesktopBlockCache,
): Promise<FarmDesktopSetup | undefined> {
  if (resolveFarmPlatform() !== "desktop") return undefined;
  if (userConfig.desktop === undefined) {
    throw new Error(
      '--desktop needs a `desktop` entry in farm.config.ts, for example `desktop: { name: "Notes" }`.',
    );
  }
  const context = createFarmDesktopContext({ ...options, root, mode });
  const block = await resolveFarmDesktopBlock(userConfig.desktop, context, cache);
  const desktop = resolveFarmDesktopConfig(block, root, context);
  return {
    desktop,
    userConfig: {
      ...userConfig,
      // Only the resolved block goes on; the function stays in the CLI.
      desktop: block,
      agent: {
        jsonLd: false,
        llmsTxt: false,
        sitemap: false,
        aiCatalog: false,
        manifest: false,
        mcp: false,
        ...userConfig.agent,
      },
      images:
        userConfig.images?.provider === undefined
          ? { ...userConfig.images, provider: "none" }
          : userConfig.images,
    },
    // On Bun by default; the CLI picks node-server for shells that embed Node. A platform
    // build environment (VERCEL=1) must not move it either.
    deploy: {
      preset: "bun",
      outputDir: getFarmDesktopOutputDirs(userConfig.distDir || ".farm").server,
      env: {},
    },
  };
}

/** Called by `farm dev|build --desktop` before any config resolves. */
export function installFarmDesktopSetup(options: FarmDesktopSetupOptions): void {
  const cache: FarmDesktopBlockCache = new Map();
  (globalThis as FarmDesktopSetupHost)[FARM_DESKTOP_SETUP] = (userConfig, root, mode) =>
    createFarmDesktopSetup(userConfig, root, mode, options, cache);
}
