import type { HeaderConfig, RedirectConfig, RewriteConfig } from "../config";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { isFarmRedirectStatus } from "../navigation-errors";
import { appendFarmRedirectQuery } from "../redirect-query";
import {
  compileConfigRoutePattern,
  interpolateConfigRouteDestination,
  localizeConfigRouteDestination,
  resolveConfigRedirectDestination,
  resolveConfigRoutePathname,
} from "./route-pattern";

/**
 * Matchers for the config `redirects()`, `rewrites()` and `headers()`, shared by the dev plugins
 * and the servers that answer with Web `Response`s (the React Server Components pipeline). Each
 * source matches the app-relative path: the basePath and any locale prefix are stripped first.
 */
export interface FarmConfigRouteMatchOptions {
  i18n?: ResolvedFarmI18nConfig;
  /** Sources match the app-relative path; internal redirect destinations get the basePath back. */
  basePath?: string;
}

export type FarmConfigRedirectMatcher = (
  url: URL,
) => { destination: string; statusCode: number } | null;

/** The destination a request URL is rewritten to (its query kept when it names none), or null. */
export type FarmConfigRewriteMatcher = (url: URL) => URL | null;

/** The `headers` of every config entry whose source matches the request URL, in config order. */
export type FarmConfigHeadersMatcher = (url: URL) => HeaderConfig["headers"][];

export function createConfigRedirectMatcher(
  redirects: readonly RedirectConfig[],
  { i18n, basePath }: FarmConfigRouteMatchOptions = {},
): FarmConfigRedirectMatcher {
  for (const redirect of redirects) {
    if (redirect.statusCode !== undefined && !isFarmRedirectStatus(redirect.statusCode)) {
      throw new RangeError(
        `Redirect "${redirect.source}" statusCode must be one of 301, 302, 303, 307, or 308.`,
      );
    }
  }
  const compiledRedirects = redirects.map((redirect) => ({
    redirect,
    pattern: compileConfigRoutePattern(redirect.source),
  }));

  return (url) => {
    if (compiledRedirects.length === 0) return null;
    const routePath = resolveConfigRoutePathname(url.pathname, i18n, basePath);
    for (const { redirect, pattern } of compiledRedirects) {
      const match = routePath.pathname.match(pattern.regex);
      if (!match) continue;
      const localizedDestination = resolveConfigRedirectDestination(
        interpolateConfigRouteDestination(redirect.destination, match, pattern.tokens),
        routePath.locale,
        i18n,
        basePath,
      );
      return {
        destination: appendFarmRedirectQuery(localizedDestination, url.search),
        statusCode: redirect.statusCode ?? (redirect.permanent ? 308 : 307),
      };
    }
    return null;
  };
}

export function createConfigRewriteMatcher(
  rewrites: readonly RewriteConfig[],
  { i18n, basePath }: FarmConfigRouteMatchOptions = {},
): FarmConfigRewriteMatcher {
  const compiledRewrites = rewrites.map((rewrite) => ({
    rewrite,
    pattern: compileConfigRoutePattern(rewrite.source),
  }));

  return (url) => {
    if (compiledRewrites.length === 0) return null;
    const routePath = resolveConfigRoutePathname(url.pathname, i18n, basePath);
    for (const { rewrite, pattern } of compiledRewrites) {
      const match = routePath.pathname.match(pattern.regex);
      if (!match) continue;
      const destinationUrl = new URL(
        localizeConfigRouteDestination(
          interpolateConfigRouteDestination(rewrite.destination, match, pattern.tokens),
          routePath.locale,
          i18n,
        ),
        url,
      );
      if (!destinationUrl.search && url.search) {
        destinationUrl.search = url.search;
      }
      return destinationUrl;
    }
    return null;
  };
}

export function createConfigHeadersMatcher(
  headers: readonly HeaderConfig[],
  { i18n, basePath }: FarmConfigRouteMatchOptions = {},
): FarmConfigHeadersMatcher {
  const compiledHeaders = headers.map((config) => ({
    config,
    pattern: compileConfigRoutePattern(config.source),
  }));

  return (url) => {
    if (compiledHeaders.length === 0) return [];
    const pathname = resolveConfigRoutePathname(url.pathname, i18n, basePath).pathname;
    return compiledHeaders
      .filter(({ pattern }) => pattern.regex.test(pathname))
      .map(({ config }) => config.headers);
  };
}

function getSetCookieValues(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

/**
 * The response with the matched config headers, as the production entry applies them: a `Link`
 * value is appended, a `Set-Cookie` value is added unless the response already sets it, and any
 * other header replaces the response's own. Returns the response itself when nothing changes.
 */
export function applyConfigResponseHeaders(
  response: Response,
  matchedHeaders: readonly HeaderConfig["headers"][],
): Response {
  let headers: Headers | undefined;
  for (const group of matchedHeaders) {
    for (const header of group) {
      const current = headers ?? response.headers;
      const key = header.key.toLowerCase();
      if (key === "set-cookie") {
        if (getSetCookieValues(current).includes(header.value)) continue;
        headers ??= new Headers(response.headers);
        headers.append("Set-Cookie", header.value);
        continue;
      }
      const currentValue = current.get(header.key);
      if (currentValue === header.value) continue;
      if (key === "link" && currentValue) {
        if (currentValue.endsWith(`, ${header.value}`)) continue;
        headers ??= new Headers(response.headers);
        headers.set("Link", `${currentValue}, ${header.value}`);
      } else {
        headers ??= new Headers(response.headers);
        headers.set(header.key, header.value);
      }
    }
  }
  if (!headers) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
