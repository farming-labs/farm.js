import { readFileSync } from "node:fs";
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
  window?: FarmDesktopWindowConfig;
  /**
   * Desktop shell adapter. A name resolves to the `@farm.js/desktop-<name>` package; a
   * package name (containing `/`) is imported as is. Defaults to `"electrobun"`.
   */
  shell?: "electrobun" | (string & {});
}

export interface ResolvedFarmDesktopConfig {
  name: string;
  id: string;
  version: string;
  window: { width: number; height: number; title: string };
  /** Adapter name, as configured. */
  shell: string;
  /** Package the CLI imports the adapter from. */
  shellPackage: string;
}

const DESKTOP_KEYS = new Set(["name", "id", "version", "window", "shell"]);
const WINDOW_KEYS = new Set(["width", "height", "title"]);
const APP_ID = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
const SHELL_NAME = /^[a-z][a-z0-9-]*$/;
const SHELL_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function fail(message: string): never {
  throw new TypeError(`desktop: ${message}`);
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
 * Check the shape of `desktop` in farm.config. Runs for every build, so a typo fails a web build
 * too, but resolves nothing: a web build never reads package.json or picks a shell for it.
 */
export function validateFarmDesktopConfig(input: unknown): FarmDesktopUserConfig | undefined {
  if (input === undefined) return undefined;
  if (!isPlainObject(input)) fail('must be an object, such as { name: "Notes" }.');
  checkKeys(input, DESKTOP_KEYS, "");
  optionalString(input.name, "name");
  const id = optionalString(input.id, "id");
  if (id !== undefined && !APP_ID.test(id)) {
    fail(`id must be a reverse-DNS identifier such as "com.example.notes", got "${id}".`);
  }
  optionalString(input.version, "version");
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

/** The adapter package for a `desktop.shell` value. */
export function resolveFarmDesktopShellPackage(shell: string): string {
  return shell.includes("/") ? shell : `@farm.js/desktop-${shell}`;
}

/** Fill in `desktop` defaults for a desktop dev session or build. */
export function resolveFarmDesktopConfig(
  input: FarmDesktopUserConfig | undefined,
  root: string,
): ResolvedFarmDesktopConfig {
  const config = validateFarmDesktopConfig(input) ?? {};
  const pkg = readPackageJson(root);
  const packageName =
    (typeof pkg.productName === "string" && pkg.productName.trim()) ||
    (typeof pkg.name === "string" && pkg.name.replace(/^@[^/]+\//, "").trim()) ||
    path.basename(root);
  const name = config.name?.trim() || packageName || "Farm App";
  const shell = config.shell?.trim() || "electrobun";
  return {
    name,
    id: config.id?.trim() || `local.farm.${slug(name)}`,
    version:
      config.version?.trim() || (typeof pkg.version === "string" && pkg.version.trim()) || "0.0.0",
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
    | ((userConfig: FarmUserConfig, root: string) => FarmDesktopSetup | undefined)
    | undefined;
};

const FARM_DESKTOP_SETUP = Symbol.for("@farm.js/core/desktop-setup");

/**
 * Desktop resolution for a `--desktop` dev session or build: fills in `desktop`, turns off the
 * public-site features a local app cannot use (unless the app sets them), drops the image
 * optimizer (sharp's native binaries are ~18 MB), and builds the server for the shell instead of
 * `deploy.target`. Returns undefined on the web.
 */
export function createFarmDesktopSetup(
  userConfig: FarmUserConfig,
  root: string,
): FarmDesktopSetup | undefined {
  if (resolveFarmPlatform() !== "desktop") return undefined;
  if (userConfig.desktop === undefined) {
    throw new Error(
      '--desktop needs a `desktop` entry in farm.config.ts, for example `desktop: { name: "Notes" }`.',
    );
  }
  const desktop = resolveFarmDesktopConfig(userConfig.desktop, root);
  return {
    desktop,
    userConfig: {
      ...userConfig,
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
export function installFarmDesktopSetup(): void {
  (globalThis as FarmDesktopSetupHost)[FARM_DESKTOP_SETUP] = createFarmDesktopSetup;
}
