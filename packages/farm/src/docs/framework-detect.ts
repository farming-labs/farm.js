import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmDocsAdapterDescriptor, FarmDocsUserConfig } from "./types";

const FRAMEWORK_PACKAGE = "@farming-labs/farmjs";
const FRAMEWORK_CONFIG_ENTRY = "@farming-labs/farmjs/config";

/**
 * The adapter descriptor protocol this core release knows how to drive.
 * Auto-detection must never wire up a descriptor from a future framework
 * release that this core cannot interpret; explicit withDocs() usage stays
 * the user's own call.
 */
const SUPPORTED_ADAPTER_PROTOCOL = 1;

export interface FarmDocsFrameworkDetectionOptions {
  root: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/**
 * Delegation triggers only for a dependency the app declared itself. A copy
 * that is merely resolvable through hoisting or a transitive dependency must
 * not silently change how the app's docs are served.
 */
async function frameworkDeclaredByApp(root: string): Promise<boolean> {
  try {
    const raw = await readFile(path.join(root, "package.json"), "utf8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const section = manifest[field];
      if (section && typeof section === "object" && FRAMEWORK_PACKAGE in section) {
        return true;
      }
    }
  } catch {
    // Unreadable manifest: treat as not declared and keep the embedded renderer.
  }
  return false;
}

const emittedNotices = new Set<string>();

/** Test hook: notices are once-per-process so dev-server restarts stay quiet. */
export function resetFarmDocsFrameworkDetectionNotices(): void {
  emittedNotices.clear();
}

function noticeOnce(key: string, emit: (message: string) => void, message: string): void {
  if (emittedNotices.has(key)) return;
  emittedNotices.add(key);
  emit(message);
}

function docsWantsFrameworkDetection(docs: FarmDocsUserConfig | undefined): boolean {
  if (docs === true) return true;
  if (!docs || typeof docs !== "object") return false;
  if (docs.enabled === false) return false;
  // An explicit descriptor means the app already wired an adapter; an
  // explicit `false` is the opt-out that pins the embedded renderer.
  if (docs.adapter !== undefined) return false;
  return true;
}

function isSupportedAdapterDescriptor(value: unknown): value is FarmDocsAdapterDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<FarmDocsAdapterDescriptor>;
  return (
    descriptor.protocol === SUPPORTED_ADAPTER_PROTOCOL &&
    typeof descriptor.server === "string" &&
    descriptor.server.length > 0 &&
    typeof descriptor.react === "string" &&
    descriptor.react.length > 0
  );
}

/**
 * Delegate `docs: {}` to the @farming-labs/farmjs docs framework when the app
 * has it installed (#483 phase 1).
 *
 * Detection applies the framework's own withDocs() to the user config, so the
 * result is byte-for-byte what a manual `withDocs(defineConfig(...))` produces:
 * the MDX Vite plugin plus the versioned adapter descriptor. When the package
 * is absent the embedded renderer keeps serving, with a one-time migration
 * notice. Any failure falls back to the embedded renderer instead of breaking
 * a working app.
 */
export async function applyFarmDocsFrameworkAutoDetection<
  T extends { docs?: FarmDocsUserConfig; vite?: unknown },
>(userConfig: T, options: FarmDocsFrameworkDetectionOptions): Promise<T> {
  if (!docsWantsFrameworkDetection(userConfig.docs)) return userConfig;

  const log = options.log ?? ((message: string) => console.log(message));
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const root = path.resolve(options.root || process.cwd());

  if (!(await frameworkDeclaredByApp(root))) {
    noticeOnce(
      "embedded-fallback",
      warn,
      `[farm] docs is served by the embedded renderer, which is being replaced by the ${FRAMEWORK_PACKAGE} docs framework. ` +
        `Install ${FRAMEWORK_PACKAGE} (with @farming-labs/docs and @farming-labs/theme) to migrate now, ` +
        "or set docs.adapter = false to keep the embedded renderer and silence this notice.",
    );
    return userConfig;
  }

  let configEntryPath: string;
  try {
    const requireFromApp = createRequire(path.join(root, "package.json"));
    configEntryPath = requireFromApp.resolve(FRAMEWORK_CONFIG_ENTRY);
  } catch {
    noticeOnce(
      "declared-not-installed",
      warn,
      `[farm] ${FRAMEWORK_PACKAGE} is declared in package.json but could not be resolved; ` +
        "keeping the embedded docs renderer. Run your package manager's install to enable docs delegation.",
    );
    return userConfig;
  }

  try {
    const frameworkConfig = await import(/* @vite-ignore */ pathToFileURL(configEntryPath).href);
    const withDocs = frameworkConfig?.withDocs;
    if (typeof withDocs !== "function") {
      noticeOnce(
        "missing-withdocs",
        warn,
        `[farm] ${FRAMEWORK_CONFIG_ENTRY} does not export withDocs(); keeping the embedded docs renderer.`,
      );
      return userConfig;
    }

    const applied = withDocs(userConfig);
    const adapter = (applied as { docs?: { adapter?: unknown } } | undefined)?.docs?.adapter;
    if (!isSupportedAdapterDescriptor(adapter)) {
      noticeOnce(
        "unsupported-descriptor",
        warn,
        `[farm] The installed ${FRAMEWORK_PACKAGE} release publishes a docs adapter this Farm version cannot drive ` +
          `(need protocol ${SUPPORTED_ADAPTER_PROTOCOL}); keeping the embedded docs renderer. ` +
          "Upgrading @farm.js/core usually resolves this.",
      );
      return userConfig;
    }

    noticeOnce(
      "delegated",
      log,
      `[farm] docs: delegated to ${FRAMEWORK_PACKAGE} (detected in this app). ` +
        "Set docs.adapter = false to keep the embedded renderer.",
    );
    return applied as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    noticeOnce(
      "detect-failed",
      warn,
      `[farm] Failed to load ${FRAMEWORK_CONFIG_ENTRY} (${message}); keeping the embedded docs renderer.`,
    );
    return userConfig;
  }
}
