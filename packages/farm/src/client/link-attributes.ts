import {
  buildFarmRoutePath,
  type FarmRouterBuildOptions,
  type FarmRouterPathParam,
  type FarmRouterPathParams,
} from "../router";
import { isFarmScriptURL, resolveFarmNavigationURL } from "./navigation-url";
import type { FarmViewTransitionMode } from "./spa-router";
import { localizeActiveFarmHref } from "../i18n/client-state";
import type { FarmI18nLocale } from "../i18n/types";
import { getFarmTrailingSlashPreference } from "../trailing-slash";
import { applyFarmBasePath, getFarmBasePath } from "../base-path";
import { FARM_LINK_PREFETCH_DELAY } from "./link-prefetch";
import { getFarmSearchPreserveRoutes } from "./search-preserve-routes";
import { _peekCurrentRequest } from "../server/request-bridge";

/**
 * Prefetch strategy (TanStack Router–style):
 * - "intent": prefetch on hover and touchstart (with prefetchDelay)
 * - "viewport": prefetch when link enters viewport (IntersectionObserver)
 * - "render": prefetch as soon as the link is mounted
 * - "none" | false: no prefetch
 */
export type PrefetchBehavior = false | "intent" | "viewport" | "render" | "none";

/** @internal Legacy prefetch mode for backward compatibility */
type PrefetchLegacy = boolean | "hover" | "viewport" | "none";

/**
 * Augment this interface via the generated farm.d.ts so Link href is typed
 * without passing a generic. Defaults to string when not augmented.
 */
export interface LinkDefaultRoute {}

export type DefaultRoutePath = LinkDefaultRoute extends { _: infer TRoute extends string }
  ? TRoute
  : string;

export type DefaultRoutePattern = LinkDefaultRoute extends {
  pattern: infer TRoute extends string;
}
  ? TRoute
  : DefaultRoutePath;

export type DefaultRouteHref = DefaultRoutePath | DefaultRoutePattern;

export type RouteHref<TRoute extends string> =
  | TRoute
  | `${TRoute}?${string}`
  | `${TRoute}#${string}`
  | `${TRoute}?${string}#${string}`;

/** A generated route with params already filled into its pathname. */
export type ResolvedRouteHref = RouteHref<DefaultRoutePath>;

export type RouteParamValue = Exclude<FarmRouterPathParam, null | undefined>;
export type RouteOptionalParamValue = FarmRouterPathParam;
export type RouteParams<TRoute extends string> = string extends TRoute
  ? FarmRouterPathParams
  : ExtractRouteParams<StripRouteSuffix<TRoute>>;

/** URI schemes recognized as typed external Link targets. Apps may augment this interface. */
export interface LinkExternalUriSchemes {
  about: true;
  blob: true;
  data: true;
  file: true;
  ftp: true;
  ftps: true;
  geo: true;
  git: true;
  http: true;
  https: true;
  im: true;
  intent: true;
  irc: true;
  ircs: true;
  magnet: true;
  mailto: true;
  market: true;
  sms: true;
  ssh: true;
  tel: true;
  urn: true;
  vscode: true;
  webcal: true;
  ws: true;
  wss: true;
}

type ExternalUriScheme = Extract<keyof LinkExternalUriSchemes, string>;

type UriSchemeLetter =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";
type UriSchemeStart = UriSchemeLetter | Uppercase<UriSchemeLetter>;
type UriSchemeCharacter =
  | UriSchemeStart
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "+"
  | "-"
  | ".";
type IsUriSchemeTail<TValue extends string> = TValue extends ""
  ? true
  : TValue extends `${infer First}${infer Rest}`
    ? First extends UriSchemeCharacter
      ? IsUriSchemeTail<Rest>
      : false
    : false;
type IsUriScheme<TValue extends string> = TValue extends `${infer First}${infer Rest}`
  ? First extends UriSchemeStart
    ? IsUriSchemeTail<Rest>
    : false
  : false;

type KnownExternalHref = `//${string}` | `${ExternalUriScheme}:${string}`;

/** External URLs; these are never type-checked as routes. */
export type ExternalHref<THref extends string = string> = string extends THref
  ? KnownExternalHref
  : THref extends `//${string}`
    ? THref
    : THref extends `${infer Scheme}:${string}`
      ? IsUriScheme<Scheme> extends true
        ? THref
        : never
      : never;

type StripRouteSuffix<TRoute extends string> = TRoute extends `${infer Path}?${string}`
  ? StripRouteSuffix<Path>
  : TRoute extends `${infer Path}#${string}`
    ? StripRouteSuffix<Path>
    : TRoute;

type ExtractRouteParams<TRoute extends string> = Simplify<
  ExtractOptionalCatchAllParams<TRoute> &
    ExtractCatchAllParams<TRoute> &
    ExtractDynamicParams<TRoute>
>;

type ExtractOptionalCatchAllParams<TRoute extends string> =
  TRoute extends `${string}[[...${infer Param}]]${infer Rest}`
    ? { [Key in Param]?: RouteOptionalParamValue } & ExtractOptionalCatchAllParams<Rest>
    : {};

type ExtractCatchAllParams<TRoute extends string> =
  TRoute extends `${string}[...${infer Param}]${infer Rest}`
    ? Param extends `[...${string}`
      ? ExtractCatchAllParams<Rest>
      : { [Key in Param]: RouteParamValue } & ExtractCatchAllParams<Rest>
    : {};

type ExtractDynamicParams<TRoute extends string> =
  TRoute extends `${string}[${infer Param}]${infer Rest}`
    ? Param extends `...${string}` | `[...${string}`
      ? ExtractDynamicParams<Rest>
      : { [Key in Param]: RouteParamValue } & ExtractDynamicParams<Rest>
    : {};

type Simplify<T> = { [Key in keyof T]: T[Key] } & {};

type HasRouteParams<TRoute extends string> = keyof RouteParams<TRoute> extends never ? false : true;

type RoutesWithRequiredParams<TRoute extends string> = TRoute extends string
  ? HasRouteParams<TRoute> extends true
    ? TRoute
    : never
  : never;

type LinkRouteParamsProps<TRoute extends string> = string extends TRoute
  ? { params?: FarmRouterPathParams }
  : HasRouteParams<TRoute> extends true
    ? { params: RouteParams<TRoute> }
    : { params?: FarmRouterPathParams };

type LinkRouteTargetProps<TRoute extends string> = [RoutesWithRequiredParams<TRoute>] extends [
  never,
]
  ? {
      /** Internal route path with all params already resolved. */
      href: RouteHref<TRoute>;
      params?: FarmRouterPathParams;
    }
  : TRoute extends string
    ? {
        /** Internal route path or route pattern. */
        href: RouteHref<TRoute>;
      } & LinkRouteParamsProps<TRoute>
    : never;

type LinkExternalTargetProps<THref extends string = string> = {
  /** External URL; these are never type-checked as app routes. */
  href: ExternalHref<THref>;
  params?: never;
};

export type LinkTargetProps<TRoute extends string, THref extends string> =
  | LinkExternalTargetProps<THref>
  | LinkRouteTargetProps<TRoute>;

/** What a `Link` takes besides its anchor attributes, in every renderer. */
export type FarmLinkOptions<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
> = LinkTargetProps<TRoute, THref> & {
  /**
   * When to prefetch. TanStack-style: "intent" (hover+touch), "viewport", "render", or "none".
   * Legacy: true (intent+viewport), "hover" (intent), "viewport", false/"none".
   */
  prefetch?: PrefetchBehavior | PrefetchLegacy;
  /** Search params appended after route params are resolved. */
  query?: FarmRouterBuildOptions["query"];
  /** Hash appended after route params and search params are resolved. */
  hash?: string;
  /** Add a trailing slash to the generated internal href. */
  trailingSlash?: boolean;
  /** Delay in ms before intent-based prefetch (hover/touch). Default 50. */
  prefetchDelay?: number;
  /** Replace current history entry instead of pushing */
  replace?: boolean;
  /** Scroll to top after navigation (default: true) */
  scroll?: boolean;
  /** Wrap this SPA navigation in a browser View Transition when supported. */
  viewTransition?: FarmViewTransitionMode;
  /** Preserve the active locale by default, or navigate using this locale. */
  locale?: FarmI18nLocale;
};

/** The keys of {@link FarmLinkOptions}, which a `Link` keeps off its anchor. */
export const FARM_LINK_OPTION_KEYS = [
  "href",
  "params",
  "query",
  "hash",
  "trailingSlash",
  "prefetch",
  "prefetchDelay",
  "replace",
  "scroll",
  "viewTransition",
  "locale",
] as const satisfies readonly (keyof FarmLinkOptions<string>)[];

/**
 * The attributes a `Link` puts on its anchor. The app's router reads them: a click on the anchor
 * navigates with `data-replace`, `data-no-scroll` and `data-view-transition`, and it prefetches
 * as `data-farm-prefetch` says, so an anchor with these attributes behaves as a `Link` without
 * any event handler of its own. `href` is absent for a `javascript:` URL, which never runs.
 */
export interface FarmLinkAttributes {
  href: string | undefined;
  "data-farm-link": "";
  "data-farm-locale": FarmI18nLocale | undefined;
  "data-farm-prefetch": string | undefined;
  "data-farm-prefetch-delay": string | undefined;
  "data-replace": "" | undefined;
  "data-no-scroll": "" | undefined;
  "data-view-transition": "auto" | "true" | undefined;
}

/** @internal What {@link resolveLinkAttributes} resolved, for React's `Link` event handlers. */
export interface FarmResolvedLink {
  attributes: FarmLinkAttributes;
  /** The href with the base path applied. */
  href: string;
  /** The href before the base path, which tells a locale change. */
  localizedHref: string;
  external: boolean;
  /** A `javascript:` URL, rendered without an href. */
  script: boolean;
  prefetch: { intent: boolean; viewport: boolean; render: boolean };
  prefetchDelay: number;
}

/** @internal */
export function resolveFarmLink(
  {
    href,
    params,
    query,
    hash,
    trailingSlash,
    prefetch = true,
    prefetchDelay = FARM_LINK_PREFETCH_DELAY,
    replace = false,
    scroll = true,
    viewTransition = false,
    locale,
  }: FarmLinkOptions<string>,
  basePath: string = getFarmBasePath(),
): FarmResolvedLink {
  const prefetchModes = normalizePrefetch(prefetch);
  const linkTrailingSlash = trailingSlash ?? getFarmTrailingSlashPreference();
  const baseHref = resolveLinkHref(href, params, {
    query,
    hash,
    trailingSlash: linkTrailingSlash,
  });
  // A locale home ("/" localized to "/fr") gets the slash the link asked for too.
  const localizedHref = withLinkTrailingSlash(
    localizeActiveFarmHref(baseHref, locale),
    linkTrailingSlash,
  );
  const resolvedHref = isExternalUrl(localizedHref)
    ? localizedHref
    : applyFarmBasePath(localizedHref, basePath);
  // Rendered without an href, so neither a click nor "open in new tab" runs it.
  const script = isFarmScriptURL(resolvedHref);
  return {
    href: resolvedHref,
    localizedHref,
    external: isExternalUrl(resolvedHref),
    script,
    prefetch: prefetchModes,
    prefetchDelay,
    attributes: {
      href: script ? undefined : resolvedHref,
      "data-farm-link": "",
      "data-farm-locale": locale,
      "data-farm-prefetch": prefetchAttribute(prefetchModes),
      "data-farm-prefetch-delay":
        prefetchModes.intent && prefetchDelay !== FARM_LINK_PREFETCH_DELAY
          ? String(prefetchDelay)
          : undefined,
      "data-replace": replace ? "" : undefined,
      "data-no-scroll": !scroll ? "" : undefined,
      "data-view-transition":
        viewTransition === "auto" ? "auto" : viewTransition ? "true" : undefined,
    },
  };
}

/**
 * Resolves `Link` options into the attributes of its anchor: the href with route params, query,
 * hash, locale, trailing slash and base path applied, and the data attributes the app's router
 * reads to navigate and prefetch. Spread them on an `<a>` in any renderer to get a `Link`.
 *
 * ```ts
 * resolveLinkAttributes({ href: "/products/[id]", params: { id: "42" }, prefetch: "intent" });
 * // { href: "/products/42", "data-farm-link": "", "data-farm-prefetch": "intent", ... }
 * ```
 */
export function resolveLinkAttributes<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
>(options: FarmLinkOptions<TRoute, THref>): FarmLinkAttributes {
  return resolveFarmLink(options as FarmLinkOptions<string>).attributes;
}

/** @internal */
export function isExternalUrl(href: string): boolean {
  return href.startsWith("//") || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href);
}

function normalizePrefetch(prefetch: FarmLinkOptions["prefetch"]): {
  intent: boolean;
  viewport: boolean;
  render: boolean;
} {
  if (prefetch === false || prefetch === "none") {
    return { intent: false, viewport: false, render: false };
  }
  if (prefetch === true) {
    return { intent: true, viewport: true, render: false };
  }
  if (prefetch === "hover") {
    return { intent: true, viewport: false, render: false };
  }
  if (prefetch === "intent") {
    return { intent: true, viewport: false, render: false };
  }
  if (prefetch === "viewport") {
    return { intent: false, viewport: true, render: false };
  }
  if (prefetch === "render") {
    return { intent: false, viewport: false, render: true };
  }
  return { intent: false, viewport: false, render: false };
}

/**
 * The mode written into the HTML, so the router prefetches the anchor as this `Link` would when
 * it never hydrates (installFarmLinkPrefetch). The default writes nothing.
 */
function prefetchAttribute(modes: ReturnType<typeof normalizePrefetch>): string | undefined {
  if (modes.intent && modes.viewport) return undefined;
  if (modes.render) return "render";
  if (modes.viewport) return "viewport";
  if (modes.intent) return "intent";
  return "none";
}

function resolveLinkHref(
  href: string,
  params: FarmRouterPathParams | undefined,
  options: FarmRouterBuildOptions,
) {
  if (isExternalUrl(href)) return href;
  // A link to a place on this page: the browser resolves it against the current URL, as it does
  // for any anchor, and the router scrolls to it. Resolved here, it would point at the root.
  if (href.startsWith("#") && !params && !options.query && options.hash === undefined) return href;

  const { pathname, query, hash } = splitInternalHref(href);

  const resolvedHref = buildFarmRoutePath(pathname, params, {
    query: mergeQueryParams(query, options.query),
    hash: options.hash ?? hash,
    trailingSlash: options.trailingSlash,
  });

  return applyPreservedSearchParams(resolvedHref);
}

function withLinkTrailingSlash(href: string, trailingSlash: boolean): string {
  if (!trailingSlash || !href.startsWith("/") || href.startsWith("//")) return href;
  const end = href.search(/[?#]/);
  const pathname = end === -1 ? href : href.slice(0, end);
  if (pathname === "/" || pathname.endsWith("/")) return href;
  return `${pathname}/${end === -1 ? "" : href.slice(end)}`;
}

function splitInternalHref(href: string) {
  try {
    const url = new URL(href, "http://farm.local");
    return {
      pathname: url.pathname || "/",
      query: url.searchParams,
      hash: url.hash ? url.hash.slice(1) : undefined,
    };
  } catch {
    const [withoutHash, rawHash] = href.split("#", 2);
    const [pathname, rawQuery] = withoutHash.split("?", 2);
    return {
      pathname: pathname || "/",
      query: new URLSearchParams(rawQuery || ""),
      hash: rawHash,
    };
  }
}

function mergeQueryParams(
  current: URLSearchParams,
  next: FarmRouterBuildOptions["query"],
): URLSearchParams | undefined {
  const merged = new URLSearchParams(current);

  if (next instanceof URLSearchParams) {
    for (const [key, value] of next.entries()) {
      merged.append(key, value);
    }
  } else if (next) {
    for (const [key, value] of Object.entries(next)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item == null) continue;
        merged.append(key, String(item));
      }
    }
  }

  return merged.toString() ? merged : undefined;
}

function applyPreservedSearchParams(href: string): string {
  const routes = getFarmSearchPreserveRoutes();
  if (routes.length === 0) return href;
  // The server render reads the request URL, so the href it renders is the one the page hydrates.
  const documentUrl =
    typeof window === "undefined" ? _peekCurrentRequest()?.url : window.location.href;
  if (!documentUrl) return href;

  const url = resolveFarmNavigationURL(href, documentUrl);
  const route = routes.find((candidate: any) => matchManifestRoute(url.pathname, candidate));
  const preserve = Array.isArray((route as any)?.search?.preserve)
    ? ((route as any).search.preserve as string[])
    : [];
  if (preserve.length === 0) return href;

  const current = new URL(documentUrl).searchParams;
  let changed = false;

  for (const key of preserve) {
    if (url.searchParams.has(key) || !current.has(key)) continue;
    for (const value of current.getAll(key)) {
      url.searchParams.append(key, value);
      changed = true;
    }
  }

  if (!changed) return href;
  return `${url.pathname}${url.search}${url.hash}`;
}

function matchManifestRoute(pathname: string, route: any): boolean {
  if (!route || !Array.isArray(route.segments)) return false;
  const routeSegments = route.segments;
  const normalized = pathname === "/" ? "" : pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  const pathSegments = normalized ? normalized.split("/") : [];
  const hasCatchAll = routeSegments.some((segment: any) => segment.isCatchAll);

  if (!hasCatchAll && pathSegments.length !== routeSegments.length) {
    return false;
  }

  for (let index = 0; index < routeSegments.length; index++) {
    const routeSegment = routeSegments[index];
    const pathSegment = pathSegments[index];

    if (routeSegment.isCatchAll) {
      return true;
    }

    if (pathSegment === undefined) {
      if (routeSegment.isOptional) continue;
      return false;
    }

    if (!routeSegment.isDynamic && routeSegment.segment !== pathSegment) {
      return false;
    }
  }

  return pathSegments.length === routeSegments.length || hasCatchAll;
}
