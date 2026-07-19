export type FarmRouteRuntime = "auto" | "node" | "edge";
export type FarmRouteRegions = "auto" | readonly string[];
export type FarmRouteMaxDuration = "auto" | number;

/** Portable execution controls shared by file, programmatic, and config routes. */
export interface FarmRouteRuntimeConfig {
  runtime?: FarmRouteRuntime;
  regions?: FarmRouteRegions;
  maxDuration?: FarmRouteMaxDuration;
}

export interface ResolvedFarmRouteRuntimeConfig {
  runtime: FarmRouteRuntime;
  regions?: string[];
  maxDuration?: number;
}

export type FarmRouteRuntimeEntryKind = "page" | "api" | "rule";
export type FarmRouteRenderingMode = "static" | "dynamic";

export interface FarmRouteRuntimeManifestEntry extends ResolvedFarmRouteRuntimeConfig {
  kind: FarmRouteRuntimeEntryKind;
  pattern: string;
  rendering: FarmRouteRenderingMode;
  source?: string;
}

export interface FarmRouteRuntimeManifest {
  version: 1;
  routes: FarmRouteRuntimeManifestEntry[];
}

export function normalizeFarmRouteRuntimeConfig(
  value: FarmRouteRuntimeConfig | null | undefined,
  source = "Route configuration",
): FarmRouteRuntimeConfig {
  if (!value) return {};

  const normalized: FarmRouteRuntimeConfig = {};

  if (value.runtime !== undefined) {
    if (value.runtime !== "auto" && value.runtime !== "node" && value.runtime !== "edge") {
      throw new TypeError(`${source} runtime must be "auto", "node", or "edge"`);
    }
    normalized.runtime = value.runtime;
  }

  if (value.regions !== undefined) {
    if (value.regions === "auto") {
      normalized.regions = "auto";
    } else {
      if (!Array.isArray(value.regions) || value.regions.length === 0) {
        throw new TypeError(`${source} regions must be "auto" or a non-empty string array`);
      }

      const regions = Array.from(
        new Set(
          value.regions.map((region) => {
            if (
              typeof region !== "string" ||
              !region.trim() ||
              /[\u0000-\u001f\u007f]/.test(region)
            ) {
              throw new TypeError(`${source} regions must contain non-empty region identifiers`);
            }
            return region.trim();
          }),
        ),
      );

      normalized.regions = regions;
    }
  }

  if (value.maxDuration !== undefined) {
    if (value.maxDuration === "auto") {
      normalized.maxDuration = "auto";
    } else if (
      typeof value.maxDuration !== "number" ||
      !Number.isInteger(value.maxDuration) ||
      value.maxDuration <= 0
    ) {
      throw new TypeError(`${source} maxDuration must be "auto" or a positive integer in seconds`);
    } else {
      normalized.maxDuration = value.maxDuration;
    }
  }

  return normalized;
}

/** Merge from lowest to highest precedence. Explicit "auto" values reset inherited hints. */
export function mergeFarmRouteRuntimeConfigs(
  ...configs: Array<FarmRouteRuntimeConfig | null | undefined>
): FarmRouteRuntimeConfig {
  const merged: FarmRouteRuntimeConfig = {};

  for (const config of configs) {
    if (!config) continue;
    if (config.runtime !== undefined) merged.runtime = config.runtime;
    if (config.regions !== undefined) merged.regions = config.regions;
    if (config.maxDuration !== undefined) merged.maxDuration = config.maxDuration;
  }

  return merged;
}

export function resolveFarmRouteRuntimeConfig(
  config: FarmRouteRuntimeConfig | null | undefined,
  source?: string,
): ResolvedFarmRouteRuntimeConfig {
  const normalized = normalizeFarmRouteRuntimeConfig(config, source);

  return {
    runtime: normalized.runtime ?? "auto",
    ...(normalized.regions && normalized.regions !== "auto"
      ? { regions: [...normalized.regions] }
      : {}),
    ...(typeof normalized.maxDuration === "number" ? { maxDuration: normalized.maxDuration } : {}),
  };
}

export function hasFarmRouteRuntimeControls(
  config: FarmRouteRuntimeConfig | null | undefined,
): boolean {
  return Boolean(
    config &&
    (config.runtime !== undefined ||
      config.regions !== undefined ||
      config.maxDuration !== undefined),
  );
}

export function getFarmRouteRuntimeConfig(value: unknown): FarmRouteRuntimeConfig {
  if (!value || typeof value !== "object") return {};
  const route = value as FarmRouteRuntimeConfig;
  return {
    ...(route.runtime !== undefined ? { runtime: route.runtime } : {}),
    ...(route.regions !== undefined ? { regions: route.regions } : {}),
    ...(route.maxDuration !== undefined ? { maxDuration: route.maxDuration } : {}),
  };
}

export function createFarmRouteRuntimeKey(config: ResolvedFarmRouteRuntimeConfig): string {
  return JSON.stringify({
    runtime: config.runtime,
    regions: config.regions || null,
    maxDuration: config.maxDuration || null,
  });
}

/** Resolve matching route rules from broadest to most specific. */
export function resolveFarmRouteRuleRuntimeConfig(
  pathname: string,
  routeRules: Record<string, FarmRouteRuntimeConfig> | null | undefined,
): FarmRouteRuntimeConfig {
  if (!routeRules) return {};

  const matches = Object.entries(routeRules)
    .filter(
      ([pattern, rule]) =>
        hasFarmRouteRuntimeControls(rule) && farmRouteRuleMatches(pattern, pathname),
    )
    .sort(([left], [right]) => compareFarmRouteRuleSpecificity(left, right));

  return mergeFarmRouteRuntimeConfigs(...matches.map(([, rule]) => rule));
}

export function farmRouteRuleMatches(pattern: string, pathname: string): boolean {
  const normalizedPattern = normalizeRoutePattern(pattern);
  const normalizedPathname = normalizeRoutePattern(pathname);
  if (normalizedPattern === normalizedPathname) return true;

  const expression = normalizedPattern
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment === "**") return ".*";
      if (segment === "*") return "[^/]+";
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return ".*";
      if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
      if (/^\[.+\]$/.test(segment) || /^:.+$/.test(segment)) return "[^/]+";
      return escapeRegExp(segment);
    })
    .join("/");

  return new RegExp(`^/${expression}/?$`).test(normalizedPathname);
}

function compareFarmRouteRuleSpecificity(left: string, right: string): number {
  const leftScore = getFarmRouteRuleSpecificity(left);
  const rightScore = getFarmRouteRuleSpecificity(right);
  return leftScore - rightScore || left.localeCompare(right);
}

function getFarmRouteRuleSpecificity(pattern: string): number {
  return normalizeRoutePattern(pattern)
    .split("/")
    .filter(Boolean)
    .reduce((score, segment) => {
      if (segment === "**" || /^\[\[\.\.\./.test(segment)) return score + 1;
      if (segment === "*" || /^\[\.\.\./.test(segment)) return score + 10;
      if (/^\[.+\]$/.test(segment) || /^:.+$/.test(segment)) return score + 50;
      return score + 100;
    }, 0);
}

function normalizeRoutePattern(value: string): string {
  const withSlash = value.trim().startsWith("/") ? value.trim() : `/${value.trim()}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
