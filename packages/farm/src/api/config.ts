import type { ResolvedFarmEnv } from "../env";

export const DEFAULT_FARM_API_BASE_PATH = "/api";

export interface FarmAPIConfigResolverContext {
  root: string;
  mode: "development" | "production";
  env: ResolvedFarmEnv;
}

export type FarmAPIConfigValue =
  | string
  | undefined
  | ((context: FarmAPIConfigResolverContext) => string | undefined | Promise<string | undefined>);

export interface FarmAPIConfig {
  /**
   * Public API root. An origin-only URL is joined with `basePath`; a URL that
   * already has a path is used as-is. May be resolved from deployment context.
   */
  baseURL?: FarmAPIConfigValue;
  /** Public API path used when `baseURL` has no path. @default "/api" */
  basePath?: FarmAPIConfigValue;
}

export interface ResolvedFarmAPIConfig {
  /** Fully resolved public API root, either absolute or root-relative. */
  baseURL: string;
  /** Effective pathname of `baseURL`. */
  basePath: string;
}

declare const __FARM_API_BASE_URL__: string | undefined;

export async function resolveFarmAPIConfig(
  config: FarmAPIConfig | undefined,
  context: FarmAPIConfigResolverContext,
): Promise<ResolvedFarmAPIConfig> {
  const configuredBasePath = await resolveConfigValue(config?.basePath, context, "api.basePath");
  const basePath = normalizeFarmAPIBasePath(configuredBasePath ?? DEFAULT_FARM_API_BASE_PATH);
  const configuredBaseURL = await resolveConfigValue(config?.baseURL, context, "api.baseURL");

  return normalizeFarmAPIConfig({ baseURL: configuredBaseURL, basePath });
}

/** Normalize already-resolved API strings. */
export function normalizeFarmAPIConfig(
  config: { baseURL?: string; basePath?: string } | undefined,
): ResolvedFarmAPIConfig {
  const basePath = normalizeFarmAPIBasePath(config?.basePath ?? DEFAULT_FARM_API_BASE_PATH);
  const baseURL = config?.baseURL?.trim();

  if (!baseURL) {
    return { baseURL: basePath, basePath };
  }

  if (baseURL.startsWith("/")) {
    const url = parseRootRelativeBaseURL(baseURL);
    if (url.pathname !== "/") {
      const effectivePath = normalizeFarmAPIBasePath(url.pathname);
      return { baseURL: effectivePath, basePath: effectivePath };
    }
    return { baseURL: basePath, basePath };
  }

  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error(
      'Farm api.baseURL must be an absolute URL or a root-relative path such as "/api".',
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Farm api.baseURL must use http or https.");
  }
  if (url.search || url.hash) {
    throw new Error("Farm api.baseURL cannot contain a query string or hash.");
  }

  if (url.pathname !== "/") {
    const effectivePath = normalizeFarmAPIBasePath(url.pathname);
    return {
      baseURL: `${url.origin}${effectivePath}`,
      basePath: effectivePath,
    };
  }

  return {
    baseURL: basePath === "/" ? url.origin : `${url.origin}${basePath}`,
    basePath,
  };
}

export function normalizeFarmAPIBasePath(value: string): string {
  const path = value.trim();
  if (!path) {
    throw new Error("Farm api.basePath cannot be empty.");
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error("Farm api.basePath cannot contain a query string or hash.");
  }

  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "/" : normalized;
}

/** Read the API root embedded by Farm's Vite build. */
export function getFarmAPIBaseURL(): string {
  if (typeof __FARM_API_BASE_URL__ !== "undefined" && __FARM_API_BASE_URL__) {
    return __FARM_API_BASE_URL__;
  }
  return DEFAULT_FARM_API_BASE_PATH;
}

/** Resolve a canonical Farm route such as `/api/users` against an API root. */
export function resolveFarmAPIRequestURL(
  routePath: string,
  baseURL = getFarmAPIBaseURL(),
  fallbackOrigin = getDefaultOrigin(),
): URL {
  const base = new URL(baseURL, fallbackOrigin);
  if (base.pathname === "/") {
    return new URL(routePath, base);
  }

  const route = new URL(routePath, fallbackOrigin);
  const suffix = stripCanonicalAPIBasePath(route.pathname);
  const joinedPath = joinURLPath(base.pathname, suffix);
  base.pathname = joinedPath;
  base.search = route.search;
  base.hash = route.hash;
  return base;
}

async function resolveConfigValue(
  value: FarmAPIConfigValue,
  context: FarmAPIConfigResolverContext,
  name: string,
): Promise<string | undefined> {
  const resolved = typeof value === "function" ? await value(context) : value;
  if (resolved === undefined) return undefined;
  if (typeof resolved !== "string") {
    throw new Error(`Farm ${name} must resolve to a string or undefined.`);
  }
  if (!resolved.trim()) {
    throw new Error(`Farm ${name} cannot be empty.`);
  }
  return resolved;
}

function parseRootRelativeBaseURL(value: string): URL {
  const url = new URL(value, "http://farm.local");
  if (url.search || url.hash) {
    throw new Error("Farm api.baseURL cannot contain a query string or hash.");
  }
  return url;
}

function stripCanonicalAPIBasePath(pathname: string): string {
  if (pathname === DEFAULT_FARM_API_BASE_PATH) return "";
  if (pathname.startsWith(`${DEFAULT_FARM_API_BASE_PATH}/`)) {
    return pathname.slice(DEFAULT_FARM_API_BASE_PATH.length + 1);
  }
  return pathname.replace(/^\/+/, "");
}

function joinURLPath(basePath: string, suffix: string): string {
  const normalizedBase = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const normalizedSuffix = suffix.replace(/^\/+/, "");
  if (!normalizedSuffix) return normalizedBase || "/";
  return `${normalizedBase}/${normalizedSuffix}`;
}

function getDefaultOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
}
