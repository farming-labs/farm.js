import { normalizeFarmBasePath } from "../base-path";
import { compareRoutePatternSpecificity } from "../routing/specificity";
import type { FarmI18nRouting } from "../i18n/types";
import type {
  FarmMobileOS,
  FarmMobilePrefetch,
  FarmMobilePresentation,
  FarmMobileScreen,
  FarmMobileTab,
  ResolvedFarmMobileConfig,
} from "./config";
import {
  resolveFarmMobileScreens,
  type FarmMobileScreenDecision,
  type FarmMobileScreenSource,
} from "./screens";

/**
 * One navigator rule. The shell tests `pattern` against a link's decoded URL path, top to
 * bottom, and uses the first match.
 */
export interface FarmMobileRouteRule {
  /** The app route pattern the rule came from, such as `"/notes/[id]"`. */
  route?: string;
  pattern: string;
  /** `"tab"` switches to tab `tab` instead of presenting a screen. */
  presentation: FarmMobilePresentation | "tab";
  tab?: number;
  screen: FarmMobileScreen;
  /** What decided `screen`: the page export, config, a screen file, the analyzer, or the default. */
  source?: FarmMobileScreenSource;
  /** Native module id derived from the route, such as `"app/notes/[id]"`. Not on web screens. */
  module?: string;
  /** Only when the page overrides the manifest's `prefetch`. */
  prefetch?: FarmMobilePrefetch;
}

/** `.farm/output/mobile/farm-routes.json` (RFC 0004, 7.2). */
export interface FarmMobileRouteManifest {
  version: 1;
  server: string;
  /** Tab roots; `path` includes the base path. */
  tabs: FarmMobileTab[];
  /** Default for every rule; a rule's own `prefetch` wins. */
  prefetch: FarmMobilePrefetch;
  rules: FarmMobileRouteRule[];
}

export interface FarmMobileRouteManifestOptions {
  /** The app's page route patterns. */
  routes: readonly string[];
  /** Server origin; defaults to `mobile.server`. The CLI passes the dev server's in dev. */
  server?: string;
  basePath?: string;
  i18n?: { locales: readonly string[]; routing: FarmI18nRouting } | null;
  /** Per-route screens; resolved from config alone (no page files) when omitted. */
  screens?: Readonly<Record<string, FarmMobileScreenDecision>>;
  /** The OS for the config-only fallback; defaults to `"android"`. */
  os?: FarmMobileOS;
}

const REGEX_SPECIAL = /[\\^$.|?*+()[\]{}]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIAL, "\\$&");
}

/** Case-insensitive without inline flags, which shells' regex engines spell differently. */
function caseInsensitive(value: string): string {
  return Array.from(value)
    .map((character) => {
      const lower = character.toLowerCase();
      const upper = character.toUpperCase();
      return lower === upper ? escapeRegex(character) : `[${upper}${lower}]`;
    })
    .join("");
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A regular expression, in the subset Kotlin, Swift, and JavaScript share, that matches the
 * decoded URL paths the client router sends to `pattern`: the base path, an optional locale
 * prefix, `[param]` as one segment, `[...rest]` as one or more, `[[...rest]]` as zero or more,
 * route groups removed, and an optional trailing slash.
 */
export function createFarmMobileRoutePattern(
  pattern: string,
  options: Pick<FarmMobileRouteManifestOptions, "basePath" | "i18n"> = {},
): string {
  let source = `^${escapeRegex(normalizeFarmBasePath(options.basePath))}`;
  const i18n = options.i18n;
  if (i18n && i18n.routing !== "none" && i18n.locales.length > 0) {
    // A locale prefix, or a first segment that is not a locale: the client router strips the
    // locale before matching, so `/fr` is the French home page, never `[slug]` = "fr".
    const locale = `/(?:${i18n.locales.map(caseInsensitive).join("|")})`;
    source += `(?:${locale}|(?!${locale}(?:/|$)))`;
  }
  for (const segment of pattern.split("/").filter(Boolean)) {
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    if (segment.startsWith("[[...") && segment.endsWith("]]")) source += "(?:/[^/]+)*";
    else if (segment.startsWith("[...") && segment.endsWith("]")) source += "(?:/[^/]+)+";
    else if (segment.startsWith("[") && segment.endsWith("]")) source += "/[^/]+";
    else source += `/${escapeRegex(decodeSegment(segment))}`;
  }
  return `${source}/?$`;
}

function stripRouteGroups(pattern: string): string {
  const segments = pattern
    .split("/")
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * The navigator manifest for a resolved `mobile` block: a rule for every page route, most
 * specific first (the client router's order), then a catch-all push for other same-origin paths.
 */
export function createFarmMobileRouteManifest(
  mobile: ResolvedFarmMobileConfig,
  options: FarmMobileRouteManifestOptions,
): FarmMobileRouteManifest {
  const server = options.server ?? mobile.server;
  if (!server) {
    throw new TypeError(
      'mobile: server is required, such as server: "https://notes.example.com" (the web ' +
        "deployment the app loads pages from).",
    );
  }
  const basePath = normalizeFarmBasePath(options.basePath);
  const tabIndex = new Map(mobile.tabs.map((tab, index) => [tab.path, index]));
  const routes = [...new Set(options.routes.map(stripRouteGroups))]
    .sort()
    .sort((left, right) => compareRoutePatternSpecificity(left, right));
  const screens =
    options.screens ??
    resolveFarmMobileScreens({ root: "", os: options.os ?? "android", routes, mobile }).screens;
  const rules: FarmMobileRouteRule[] = routes.map((route) => {
    const decision = screens[route] ?? {
      screen: "web" as const,
      source: "default" as const,
      presentation: "push" as const,
      prefetch: mobile.native.prefetch,
    };
    const tab = tabIndex.get(route);
    return {
      route,
      pattern: createFarmMobileRoutePattern(route, options),
      presentation: tab !== undefined ? "tab" : decision.presentation,
      ...(tab !== undefined ? { tab } : {}),
      screen: decision.screen,
      source: decision.source,
      ...(decision.module ? { module: decision.module } : {}),
      ...(decision.prefetch !== mobile.native.prefetch ? { prefetch: decision.prefetch } : {}),
    };
  });
  // Same-origin paths that are not page routes (API documents, server 404s) still push.
  rules.push({ pattern: "^/", presentation: "push", screen: "web" });
  return {
    version: 1,
    server,
    tabs: mobile.tabs.map((tab) => ({
      ...tab,
      path: basePath ? (tab.path === "/" ? basePath : `${basePath}${tab.path}`) : tab.path,
    })),
    prefetch: mobile.native.prefetch,
    rules,
  };
}
