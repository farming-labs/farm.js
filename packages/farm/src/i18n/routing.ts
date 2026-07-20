import type { FarmI18nDirection, FarmI18nRouting, ResolvedFarmI18nConfig } from "./types";

export interface FarmLocalePathConfig {
  locales: readonly string[];
  defaultLocale: string;
  routing: FarmI18nRouting;
}

export interface FarmLocalePathMatch {
  locale?: string;
  pathname: string;
  explicit: boolean;
}

const RTL_LANGUAGES = new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "he",
  "ku",
  "nqo",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

export function resolveFarmLocalePath(
  pathname: string,
  config: FarmLocalePathConfig,
): FarmLocalePathMatch {
  const normalized = normalizePathname(pathname);
  if (config.routing === "none") {
    return { pathname: normalized, explicit: false };
  }

  const segments = normalized.split("/").filter(Boolean);
  const firstSegment = segments[0];
  const locale = config.locales.find(
    (candidate) => candidate.toLowerCase() === firstSegment?.toLowerCase(),
  );
  if (!locale) {
    return { pathname: normalized, explicit: false };
  }

  const remaining = segments.slice(1);
  return {
    locale,
    pathname: remaining.length > 0 ? `/${remaining.join("/")}` : "/",
    explicit: true,
  };
}

export function stripFarmLocaleFromPathname(
  pathname: string,
  config: FarmLocalePathConfig,
): string {
  return resolveFarmLocalePath(pathname, config).pathname;
}

export function localizeFarmPathname(
  pathname: string,
  locale: string,
  config: FarmLocalePathConfig,
): string {
  const internalPathname = resolveFarmLocalePath(pathname, config).pathname;
  if (config.routing === "none") return internalPathname;
  if (config.routing === "prefix-except-default" && locale === config.defaultLocale) {
    return internalPathname;
  }
  return internalPathname === "/" ? `/${locale}` : `/${locale}${internalPathname}`;
}

export function localizeFarmHref(
  href: string,
  locale: string,
  config: FarmLocalePathConfig,
): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "http://farm.local");
  url.pathname = localizeFarmPathname(url.pathname, locale, config);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getFarmLocaleDirection(
  locale: string,
  direction: ResolvedFarmI18nConfig["direction"] | undefined,
): FarmI18nDirection {
  const configured = direction?.[locale];
  if (configured) return configured;
  const language = locale.split("-")[0]?.toLowerCase() || locale.toLowerCase();
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

function normalizePathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
}
