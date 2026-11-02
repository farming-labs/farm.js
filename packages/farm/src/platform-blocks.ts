import { readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Shared by the `desktop` and `mobile` config blocks: the static-or-function block form, the
 * context profile, package.json defaults, and option checks whose errors name the block.
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Checks for one block, with errors prefixed by the block, such as `mobile (os: android)`. */
export interface PlatformBlockChecker {
  fail(message: string): never;
  checkKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void;
  optionalString(value: unknown, key: string): string | undefined;
}

export function createPlatformBlockChecker(prefix: string): PlatformBlockChecker {
  const fail = (message: string): never => {
    throw new TypeError(`${prefix}: ${message}`);
  };
  return {
    fail,
    checkKeys(value, allowed, where) {
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          fail(`unknown option ${where}${key}. Supported: ${[...allowed].join(", ")}.`);
        }
      }
    },
    optionalString(value, key) {
      if (value === undefined) return undefined;
      if (typeof value !== "string" || !value.trim()) fail(`${key} must be a non-empty string.`);
      return (value as string).trim();
    },
  };
}

export function readAppPackageJson(root: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The package.json `productName`, else its unscoped `name`, else the root directory name. */
export function resolveAppPackageName(root: string, pkg: Record<string, unknown>): string {
  return (
    (typeof pkg.productName === "string" && pkg.productName.trim()) ||
    (typeof pkg.name === "string" && pkg.name.replace(/^@[^/]+\//, "").trim()) ||
    path.basename(root)
  );
}

/** `--profile`: a name such as `"beta"`, `"production"` by default. */
export function resolvePlatformProfile(profile: unknown = "production"): string {
  if (typeof profile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) {
    throw new TypeError(`--profile must be a name such as "beta", got "${String(profile)}".`);
  }
  return profile;
}

/** What every platform context carries besides `env`. */
export interface PlatformBlockContext {
  os: string;
  mode: string;
  command: string;
  profile: string;
  root: string;
}

/** Results of function-valued blocks for one dev session or build. */
export type PlatformBlockCache<T> = Map<string, Promise<T>>;

/**
 * The plain block for a context: the static object, or what the function returned, checked by
 * `validate`. With a cache, the function runs once per session: `farm dev` loads farm.config
 * more than once while it starts, and each load brings a new function with the same source. An
 * edited block has new source, so it runs again.
 */
export async function resolvePlatformBlock<C extends PlatformBlockContext, T>(
  input: T | ((context: C) => T | Promise<T>),
  context: C,
  validate: (value: unknown, context: C) => T,
  cache?: PlatformBlockCache<T>,
): Promise<T> {
  if (typeof input !== "function") return validate(input, context);
  const fn = input as (context: C) => T | Promise<T>;
  const call = () =>
    Promise.resolve()
      .then(() => fn(context))
      .then((value) => validate(value, context));
  if (!cache) return call();
  const key = [
    context.os,
    context.mode,
    context.command,
    context.profile,
    context.root,
    String(fn),
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
