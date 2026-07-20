import { localizeFarmPathname, resolveFarmLocalePath } from "./routing";
import type { FarmI18nLocaleSource, ResolvedFarmI18nConfig } from "./types";

export interface FarmLocaleResolution {
  locale: string;
  source: FarmI18nLocaleSource;
  pathname: string;
  redirect?: string;
  persist: boolean;
}

export function getFarmLocaleVaryHeaders(
  config: ResolvedFarmI18nConfig,
  resolution: FarmLocaleResolution,
): string[] {
  if (!config.enabled || resolution.source === "url") return [];

  const headers: string[] = [];
  if (config.detection.includes("cookie")) headers.push("Cookie");
  if (config.detection.includes("accept-language")) headers.push("Accept-Language");
  return headers;
}

export function resolveFarmLocaleRequest(
  request: Request,
  config: ResolvedFarmI18nConfig,
  options: { redirect?: boolean } = {},
): FarmLocaleResolution {
  const url = new URL(request.url);
  if (!config.enabled) {
    return {
      locale: config.defaultLocale,
      source: "default",
      pathname: url.pathname,
      persist: false,
    };
  }

  const pathMatch = resolveFarmLocalePath(url.pathname, config);
  if (pathMatch.explicit && pathMatch.locale) {
    const canonicalPath = localizeFarmPathname(pathMatch.pathname, pathMatch.locale, config);
    const redirect =
      options.redirect !== false && canonicalPath !== url.pathname
        ? `${canonicalPath}${url.search}${url.hash}`
        : undefined;
    return {
      locale: pathMatch.locale,
      source: "url",
      pathname: pathMatch.pathname,
      redirect,
      // Locale-prefixed pages are canonical and can be cached publicly. Locale
      // switchers persist the same choice before navigating in the browser.
      persist: false,
    };
  }

  const detected = detectLocale(request, config);
  const shouldRedirect =
    options.redirect !== false &&
    !isInternalOrApiPath(url.pathname) &&
    config.routing !== "none" &&
    (config.routing === "prefix-always" || detected.locale !== config.defaultLocale);

  return {
    locale: detected.locale,
    source: detected.source,
    pathname: pathMatch.pathname,
    redirect: shouldRedirect
      ? `${localizeFarmPathname(pathMatch.pathname, detected.locale, config)}${url.search}${url.hash}`
      : undefined,
    persist: detected.source !== "default",
  };
}

export function createFarmLocaleCookie(
  locale: string,
  config: Pick<ResolvedFarmI18nConfig, "cookie">,
): string {
  const cookie = config.cookie;
  let value = `${encodeURIComponent(cookie.name)}=${encodeURIComponent(locale)}`;
  value += `; Max-Age=${cookie.maxAge}`;
  value += `; Path=${cookie.path}`;
  value += `; SameSite=${capitalize(cookie.sameSite)}`;
  if (cookie.secure) value += "; Secure";
  return value;
}

export function matchFarmLocale(
  requested: string | null | undefined,
  locales: readonly string[],
): string | undefined {
  if (!requested) return undefined;
  let canonical: string;
  try {
    canonical = Intl.getCanonicalLocales(requested)[0]!;
  } catch {
    return undefined;
  }

  const exact = locales.find((locale) => locale.toLowerCase() === canonical.toLowerCase());
  if (exact) return exact;

  const language = canonical.split("-")[0]?.toLowerCase();
  return locales.find((locale) => locale.split("-")[0]?.toLowerCase() === language);
}

function detectLocale(
  request: Request,
  config: ResolvedFarmI18nConfig,
): { locale: string; source: FarmI18nLocaleSource } {
  for (const signal of config.detection) {
    if (signal === "url") continue;

    if (signal === "cookie") {
      const locale = matchFarmLocale(
        readCookie(request.headers.get("cookie"), config.cookie.name),
        config.locales,
      );
      if (locale) return { locale, source: "cookie" };
    }

    if (signal === "accept-language") {
      const locale = resolveAcceptLanguage(request.headers.get("accept-language"), config.locales);
      if (locale) return { locale, source: "accept-language" };
    }
  }

  return { locale: config.defaultLocale, source: "default" };
}

function resolveAcceptLanguage(
  header: string | null,
  locales: readonly string[],
): string | undefined {
  if (!header) return undefined;
  const candidates = header
    .split(",")
    .map((entry, index) => {
      const [locale = "", ...parameters] = entry.trim().split(";");
      const qualityValue = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      const quality = qualityValue ? Number(qualityValue.slice(2)) : 1;
      return { locale, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((candidate) => candidate.locale && candidate.locale !== "*" && candidate.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

  for (const candidate of candidates) {
    const locale = matchFarmLocale(candidate.locale, locales);
    if (locale) return locale;
  }
  return undefined;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    let key: string;
    try {
      key = decodeURIComponent(part.slice(0, separator).trim());
    } catch {
      continue;
    }
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function isInternalOrApiPath(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/__farm/") ||
    pathname.startsWith("/_farm/")
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
