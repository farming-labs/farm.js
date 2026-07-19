import type { HeaderConfig, RedirectConfig } from "./config";
import type { FarmRouteRuntimeConfig } from "./route-runtime";
import { normalizeFarmRouteRuntimeConfig } from "./route-runtime";

export type FarmRouteRuleRenderMode = "static" | "dynamic";

export type FarmRouteRuleRedirect =
  | string
  | {
      to: string;
      statusCode?: number;
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
  for (const [source, rule] of Object.entries(routeRules)) {
    if (!source || !rule) continue;
    const normalizedSource = normalizeRuleSource(source);
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
      ...(rule.headers || {}),
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

    if (rule.redirect && typeof rule.redirect !== "string") {
      nitroRule.redirect = rule.redirect.to;
      if (rule.redirect.statusCode) {
        nitroRule.statusCode = rule.redirect.statusCode;
      }
    }

    if (rule.cors) {
      nitroRule.cors = true;
      nitroRule.headers = {
        ...normalizeCorsHeaders(rule.cors),
        ...(rule.headers || {}),
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
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
