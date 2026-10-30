/**
 * What `experimental.serverComponents` does for an app: whether `farm dev` and `farm build` run the
 * RSC pipeline, and what stands in the way. Shared by the pipeline and `farm doctor`, so both
 * answer the same way. No Vite or React imports: the CLI loads this for `farm doctor`.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  FARM_ISLANDS_MODE_UNAVAILABLE,
  isExplicitFarmServerComponentsMode,
  resolveFarmServerComponentsMode,
  type FarmServerComponentsMode,
} from "./server-components-mode";
import { logger } from "./utils";

type FarmConfigInput = Record<string, any>;

export const FARM_RSC_PACKAGES = [
  "@farm.js/plugin",
  "@vitejs/plugin-rsc",
  "react-server-dom-webpack",
];

export const FARM_RSC_INSTALL_HINT = `pnpm add ${FARM_RSC_PACKAGES.join(" ")}`;

/**
 * Config the RSC pipeline does not run yet and that decides what a request may see or receive.
 * Serving the app without it could expose pages it protects, so RSC refuses to start.
 */
const FARM_RSC_BLOCKING_KEYS = [
  "auth",
  "integrations",
  "headers",
  "redirects",
  "rewrites",
  "routeRules",
  "context",
] as const;

/** Config the RSC pipeline does not run yet and ignores with a warning. */
const FARM_RSC_IGNORED_KEYS = [
  "plugins",
  "storage",
  "schema",
  "cron",
  "workflows",
  "docs",
  "theme",
  "observability",
] as const;

export interface FarmServerComponentsStatus {
  /** The engine the config asks for, or `undefined` when server components are off. */
  mode: FarmServerComponentsMode | undefined;
  /** `experimental.serverComponents` asks for the RSC pipeline. */
  enabled: boolean;
  /** Picked with `{ mode }` rather than `true`; never falls back. */
  explicit: boolean;
  /** RSC packages the app does not resolve. */
  missingPackages: string[];
  /**
   * `true` without the packages: the app runs without RSC, as before the flag loaded the pipeline.
   * A future release makes `true` always run RSC.
   */
  fallback: boolean;
  /** Set config that stops RSC from starting. */
  blockingKeys: string[];
  /** Set config that RSC ignores. */
  ignoredKeys: string[];
}

/** Whether the app opted in to React Server Components in farm.config. */
export function farmConfigUsesServerComponents(
  config: FarmConfigInput | null | undefined,
): boolean {
  return resolveFarmServerComponentsMode(config?.experimental?.serverComponents) === "rsc";
}

export function findFarmAppPackageDir(root: string, packageName: string): string | undefined {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

function isSet(value: unknown): boolean {
  if (value === undefined || value === false || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== "object" || Object.keys(value).length > 0;
}

export function inspectFarmServerComponents(
  config: FarmConfigInput | null | undefined,
  root: string,
): FarmServerComponentsStatus {
  const value = config?.experimental?.serverComponents;
  const mode = resolveFarmServerComponentsMode(value);
  const enabled = mode === "rsc";
  const explicit = enabled && isExplicitFarmServerComponentsMode(value);
  const missingPackages = enabled
    ? FARM_RSC_PACKAGES.filter((name) => !findFarmAppPackageDir(root, name))
    : [];
  return {
    mode,
    enabled,
    explicit,
    missingPackages,
    // `true` predates the pipeline; `{ mode: "rsc" }` is new and fails with the install command.
    fallback: enabled && !explicit && missingPackages.length > 0,
    blockingKeys: enabled ? FARM_RSC_BLOCKING_KEYS.filter((key) => isSet(config?.[key])) : [],
    ignoredKeys: enabled ? FARM_RSC_IGNORED_KEYS.filter((key) => isSet(config?.[key])) : [],
  };
}

function formatKeys(keys: readonly string[]): string {
  return keys.map((key) => `\`${key}\``).join(", ");
}

export function formatFarmRscFallbackMessage(
  missingPackages: readonly string[],
  blockingKeys: readonly string[] = [],
): string {
  if (blockingKeys.length > 0) {
    return `experimental.serverComponents is true, but this app uses ${formatKeys(
      blockingKeys,
    )}, which the RSC pipeline does not run yet, so it runs without React Server Components. Remove the flag, or move ${
      blockingKeys.length === 1 ? "that feature" : "those features"
    } out of farm.config to turn RSC on.`;
  }
  return `experimental.serverComponents is true, but ${missingPackages.join(", ")} ${
    missingPackages.length === 1 ? "is" : "are"
  } not installed, so the app runs without React Server Components. \`farm dev\` and \`farm build\` install them outside CI; in CI or with another tool, run ${FARM_RSC_INSTALL_HINT}.`;
}

export function formatFarmRscBlockingMessage(blockingKeys: readonly string[]): string {
  return `experimental.serverComponents runs on the RSC pipeline, which does not run ${formatKeys(
    blockingKeys,
  )} yet. Serving the app without ${
    blockingKeys.length === 1 ? "it" : "them"
  } could expose what ${blockingKeys.length === 1 ? "it protects" : "they protect"}, so RSC does not start. Remove experimental.serverComponents to keep ${
    blockingKeys.length === 1 ? "it" : "them"
  }.`;
}

let warnedFallback = false;

/**
 * Whether `farm dev` and `farm build` run the RSC pipeline. Apps set the flag before it loaded the
 * pipeline (it only switched off isolated hydration), so one without the RSC packages keeps running
 * as before, with a warning. An app whose config RSC cannot honor safely fails here.
 */
export function farmAppUsesRscPipeline(
  config: FarmConfigInput | null | undefined,
  root: string,
): boolean {
  const status = inspectFarmServerComponents(config, root);
  if (status.mode === "islands") throw new Error(FARM_ISLANDS_MODE_UNAVAILABLE);
  if (!status.enabled) return false;
  if (status.fallback) {
    if (!warnedFallback) {
      warnedFallback = true;
      logger.warn(
        `[Farm.js] ${formatFarmRscFallbackMessage(status.missingPackages, status.blockingKeys)}`,
      );
    }
    return false;
  }
  if (status.blockingKeys.length > 0) {
    throw new Error(`[Farm.js] ${formatFarmRscBlockingMessage(status.blockingKeys)}`);
  }
  if (status.ignoredKeys.length > 0) {
    logger.warn(
      `[Farm.js] experimental.serverComponents runs on the RSC pipeline, which does not run ${formatKeys(
        status.ignoredKeys,
      )} yet. ${status.ignoredKeys.length === 1 ? "It is" : "They are"} ignored.`,
    );
  }
  return true;
}
