/**
 * Feature packages that @farm.js/core declares as optional peer dependencies.
 * Apps that use the feature install the package; everything else skips it.
 * Core loads each one with a literal dynamic import on the feature's own code
 * path, and turns a missing package into an actionable install hint.
 */
import { createRequire } from "node:module";
import path from "node:path";

/** Whether `error` reports that `packageName` itself (not one of its dependencies) is missing. */
export function isMissingPackageError(error: unknown, packageName: string): boolean {
  // Bundlers and test runners wrap the loader's error; follow `cause` a few levels.
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (!current || typeof current !== "object") return false;
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
      typeof message === "string"
    ) {
      // Node names the package itself, even for a subpath import.
      return message.includes(`'${packageName}'`) || message.includes(`"${packageName}"`);
    }
    current = cause;
  }
  return false;
}

/**
 * Whether the app can load `packageName`, resolving from the app root first
 * and then beside `@farm.js/core`, where pnpm links core's own peers.
 */
export function isOptionalPeerInstalled(root: string, packageName: string): boolean {
  const appRequire = createRequire(path.join(root, "package.json"));
  const requires = [appRequire];
  try {
    requires.push(createRequire(appRequire.resolve("@farm.js/core")));
  } catch {
    // The app does not resolve core itself (for example a nested fixture).
  }
  return requires.some((parentRequire) => {
    try {
      parentRequire.resolve(`${packageName}/package.json`);
      return true;
    } catch (error) {
      // Installed, but its exports map hides package.json.
      return (error as { code?: unknown }).code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
    }
  });
}

/** `Install "sharp" to optimize images: pnpm add sharp` */
export function formatOptionalPeerInstallHint(
  packageName: string,
  purpose: string,
  options: { dev?: boolean } = {},
): string {
  return `Install "${packageName}" to ${purpose}: pnpm add ${options.dev ? "-D " : ""}${packageName}`;
}

export const VERCEL_OG_INSTALL_HINT = formatOptionalPeerInstallHint(
  "@vercel/og",
  "render OG and metadata images",
);

/** Optional peers an app module can import through a core entry (`@farm.js/core/og`). */
const APP_IMPORTED_OPTIONAL_PEERS: ReadonlyArray<readonly [string, string]> = [
  ["@vercel/og", VERCEL_OG_INSTALL_HINT],
];

/**
 * Replace a module-not-found error for an optional peer with one that names
 * the install command, keeping the original as `cause`. Other errors pass through.
 */
export function explainMissingOptionalPeer(error: unknown, context: string): unknown {
  for (const [packageName, hint] of APP_IMPORTED_OPTIONAL_PEERS) {
    if (isMissingPackageError(error, packageName)) {
      return withOptionalPeerCause(
        new Error(`${context} needs ${packageName}, which is not installed. ${hint}`),
        error,
      );
    }
  }
  return error;
}

/** Keep the loader's error as `cause` (the ES2022 Error option is not in every consumer's lib). */
export function withOptionalPeerCause(error: Error, cause: unknown): Error {
  return Object.assign(error, { cause });
}
