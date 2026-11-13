import { applyFarmBasePath, normalizeFarmBasePath } from "./base-path";
import type { HeaderConfig, RedirectConfig } from "./config";
import { isFarmRedirectStatus, type FarmRedirectStatus } from "./navigation-errors";
import type { FarmRouteRuntimeConfig } from "./route-runtime";
import { compareFarmRouteRuleSpecificity, normalizeFarmRouteRuntimeConfig } from "./route-runtime";
import { compileConfigRoutePattern, validateConfigRouteSource } from "./plugins/route-pattern";

export type FarmRouteRuleRenderMode = "static" | "dynamic";

export type FarmRouteRuleRedirect =
  | string
  | {
      to: string;
      statusCode?: FarmRedirectStatus;
      permanent?: boolean;
    };

export type FarmRouteRuleCors =
  | boolean
  | {
      origin?: string;
      methods?: string | readonly string[];
      headers?: string | readonly string[];
    };

export interface FarmRouteRule extends FarmRouteRuntimeConfig {
  prerender?: boolean;
  render?: FarmRouteRuleRenderMode;
  ssr?: boolean;
  swr?: boolean | number;
  isr?: boolean | number;
  cors?: FarmRouteRuleCors;
  headers?: Record<string, string>;
  redirect?: FarmRouteRuleRedirect;
}

export type FarmRouteRules = Record<string, FarmRouteRule>;

export function normalizeRouteRules(routeRules: FarmRouteRules | undefined): FarmRouteRules {
  if (!routeRules) return {};

  const normalized: FarmRouteRules = {};
  const normalizedSources = new Map<string, string>();
  for (const [source, rule] of Object.entries(routeRules)) {
    if (!rule) continue;
    const normalizedSource = normalizeRuleSource(source);
    validateConfigRouteSource(normalizedSource, `Route rule "${source}" source`);
    const existingSource = normalizedSources.get(normalizedSource);
    if (existingSource !== undefined) {
      throw new Error(
        `Route rules "${existingSource}" and "${source}" both normalize to "${normalizedSource}".`,
      );
    }
    normalizedSources.set(normalizedSource, source);
    if (
      typeof rule.redirect === "object" &&
      rule.redirect.statusCode !== undefined &&
      !isFarmRedirectStatus(rule.redirect.statusCode)
    ) {
      throw new RangeError(
        `Route rule "${normalizedSource}" redirect.statusCode must be one of 301, 302, 303, 307, or 308.`,
      );
    }
    normalized[normalizedSource] = {
      ...rule,
      ...normalizeFarmRouteRuntimeConfig(rule, `Route rule "${normalizedSource}"`),
    };
  }
  return normalized;
}

export function routeRulesToRedirects(routeRules: FarmRouteRules): RedirectConfig[] {
  return Object.entries(routeRules)
    .filter((entry): entry is [string, FarmRouteRule & { redirect: FarmRouteRuleRedirect }] =>
      Boolean(entry[1].redirect),
    )
    .map(([source, rule]) => {
      const redirect = typeof rule.redirect === "string" ? { to: rule.redirect } : rule.redirect;
      return {
        source,
        destination: redirect.to,
        permanent: redirect.permanent,
        statusCode: redirect.statusCode ?? (redirect.permanent === true ? 308 : undefined),
      };
    });
}

export function routeRulesToHeaders(routeRules: FarmRouteRules): HeaderConfig[] {
  const configs: HeaderConfig[] = [];

  for (const [source, rule] of Object.entries(routeRules)) {
    const headers = {
      ...normalizeCorsHeaders(rule.cors),
      ...rule.headers,
    };

    const entries = Object.entries(headers);
    if (entries.length === 0) continue;

    configs.push({
      source,
      headers: entries.map(([key, value]) => ({ key, value })),
    });
  }

  return configs;
}

export function routeRulesToNitroRouteRules(routeRules: FarmRouteRules): Record<string, any> {
  const nitroRules: Record<string, any> = {};

  for (const [source, rule] of Object.entries(routeRules)) {
    const nitroRule: Record<string, any> = { ...rule };

    if (rule.render === "static") {
      nitroRule.prerender = true;
    } else if (rule.render === "dynamic") {
      nitroRule.prerender = false;
    }

    if (rule.redirect) {
      const redirect = typeof rule.redirect === "string" ? { to: rule.redirect } : rule.redirect;
      if (hasExplicitQuery(redirect.to)) {
        // Nitro merges the incoming query into redirect targets, including when
        // the target already declares one. Farm's redirect contract replaces
        // the incoming query in that case, so let the bundled Farm handler own
        // these redirects instead of changing their meaning in production.
        delete nitroRule.redirect;
      } else {
        nitroRule.redirect = {
          to: redirect.to,
          status: redirect.statusCode ?? (redirect.permanent === true ? 308 : 307),
        };
      }
    }

    if (rule.cors) {
      nitroRule.cors = true;
      nitroRule.headers = {
        ...normalizeCorsHeaders(rule.cors),
        ...rule.headers,
      };
    }

    delete nitroRule.render;
    delete nitroRule.runtime;
    delete nitroRule.regions;
    delete nitroRule.maxDuration;
    nitroRules[source] = nitroRule;
  }

  return nitroRules;
}

/**
 * Nitro matches route rules against the full request path, and a Farm app is served below its
 * basePath, so each rule also applies at `basePath + source`: a `swr`, `cache`, `cors` or
 * `redirect` rule written for `/about` must cover the `/console/about` visitors request. The app
 * path keeps its rule, as before. Local API routes are not served below the basePath, so a rule for
 * the API path is not copied, and an app-relative redirect target moves below the basePath as
 * Farm's own redirects do.
 */
export function nitroRouteRulesBelowBasePath(
  nitroRules: Record<string, any>,
  basePath: string | undefined,
  apiServerBasePath: string,
): Record<string, any> {
  const prefix = normalizeFarmBasePath(basePath);
  if (!prefix) return nitroRules;
  const isAPISource = (source: string) =>
    source === apiServerBasePath || source.startsWith(`${apiServerBasePath}/`);

  const rules: Record<string, any> = { ...nitroRules };
  for (const [source, rule] of Object.entries(nitroRules)) {
    if (isAPISource(source)) continue;
    const publicSource = applyFarmBasePath(source, prefix);
    // A rule the app wrote for the public path itself is kept as written.
    if (publicSource in nitroRules) continue;
    const to = rule.redirect?.to;
    rules[publicSource] =
      typeof to === "string" && to.startsWith("/") && !to.startsWith("//")
        ? { ...rule, redirect: { ...rule.redirect, to: applyFarmBasePath(to, prefix) } }
        : rule;
  }
  return rules;
}

/**
 * The headers a production server answers a CORS preflight (`OPTIONS` with `Origin` and
 * `Access-Control-Request-Method`) for `pathname` with, before app middleware or routes run, or
 * `undefined` when no `cors` rule covers the path. Matching rules merge from broadest to most
 * specific, as Nitro merges them, so a more specific `cors: false` turns a broader rule off.
 */
export function resolveRouteRuleCorsPreflightHeaders(
  routeRules: FarmRouteRules | undefined,
  pathname: string,
): Record<string, string> | undefined {
  if (!routeRules) return undefined;
  let cors: FarmRouteRuleCors | undefined;
  let headers: Record<string, string> = {};
  const matches = Object.entries(routeRules)
    // The matcher the development `routeRules` headers use (routeRulesToHeaders).
    .filter(([source]) => compileConfigRoutePattern(source).regex.test(pathname))
    .sort(([left], [right]) => compareFarmRouteRuleSpecificity(left, right));
  for (const [, rule] of matches) {
    if (rule.cors !== undefined) cors = rule.cors;
    headers = { ...headers, ...normalizeCorsHeaders(rule.cors), ...rule.headers };
  }
  return cors ? headers : undefined;
}

function normalizeCorsHeaders(cors: FarmRouteRuleCors | undefined): Record<string, string> {
  if (!cors) return {};

  if (cors === true) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
    };
  }

  return {
    "Access-Control-Allow-Origin": cors.origin ?? "*",
    "Access-Control-Allow-Methods": normalizeList(cors.methods) ?? "*",
    "Access-Control-Allow-Headers": normalizeList(cors.headers) ?? "*",
  };
}

function normalizeList(value: string | readonly string[] | undefined): string | undefined {
  if (!value || typeof value === "string") return value;
  return value.join(", ");
}

function normalizeRuleSource(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new TypeError("Route rule source must be a non-empty pathname pattern.");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function hasExplicitQuery(destination: string): boolean {
  const queryIndex = destination.indexOf("?");
  if (queryIndex === -1) return false;
  const hashIndex = destination.indexOf("#");
  return hashIndex === -1 || queryIndex < hashIndex;
}
