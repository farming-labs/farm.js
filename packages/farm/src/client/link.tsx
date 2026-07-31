"use client";

import type React from "react";
import { forwardRef, useEffect, useRef, useCallback, type AnchorHTMLAttributes } from "react";
import {
  buildFarmRoutePath,
  type FarmRouterBuildOptions,
  type FarmRouterPathParam,
  type FarmRouterPathParams,
} from "../router";
import type { FarmViewTransitionMode } from "./spa-router";
import { isFarmLocaleChangeHref, localizeActiveFarmHref } from "../i18n/client-runtime";
import type { FarmI18nLocale } from "../i18n/types";

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

/** External URLs; these are never type-checked as routes. */
export type ExternalHref =
  | `http://${string}`
  | `https://${string}`
  | `//${string}`
  | `mailto:${string}`;

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

type LinkExternalTargetProps = {
  /** External URL; these are never type-checked as app routes. */
  href: ExternalHref;
  params?: never;
};

type LinkTargetProps<TRoute extends string> =
  | LinkExternalTargetProps
  | LinkRouteTargetProps<TRoute>;

export type LinkProps<TRoute extends string = DefaultRouteHref> = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> &
  LinkTargetProps<TRoute> & {
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

function isModifierEvent(e: React.MouseEvent): boolean {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}

function isExternalUrl(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}

function getRouter(): {
  prefetch(href: string): Promise<void>;
  observeForPrefetch(el: HTMLAnchorElement): void;
  unobserveForPrefetch(el: HTMLAnchorElement): void;
  navigate(
    href: string,
    opts: { replace?: boolean; scroll?: boolean; viewTransition?: FarmViewTransitionMode },
  ): void;
} | null {
  if (typeof window !== "undefined" && (window as any).__FARM_SPA_ROUTER__) {
    return (window as any).__FARM_SPA_ROUTER__;
  }
  return null;
}

function normalizePrefetch(prefetch: LinkProps["prefetch"]): {
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

function LinkInner<TRoute extends string = DefaultRouteHref>(
  {
    href,
    params,
    query,
    hash,
    trailingSlash,
    prefetch = true,
    prefetchDelay = 50,
    replace = false,
    scroll = true,
    viewTransition = false,
    locale,
    onClick,
    target,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onTouchStart,
    ...props
  }: LinkProps<TRoute>,
  ref: React.ForwardedRef<HTMLAnchorElement>,
) {
  const elementRef = useRef<HTMLAnchorElement | null>(null);
  const intentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPrefetched = useRef(false);

  const { intent, viewport, render } = normalizePrefetch(prefetch);
  const baseHref = resolveLinkHref(href, params, {
    query,
    hash,
    trailingSlash,
  });
  const resolvedHref = localizeActiveFarmHref(baseHref, locale);
  const isExternal = isExternalUrl(resolvedHref);

  const doPrefetch = useCallback(() => {
    if (isExternal || hasPrefetched.current) return;
    const router = getRouter();
    if (!router) return;
    hasPrefetched.current = true;
    router.prefetch(resolvedHref);
  }, [resolvedHref, isExternal]);

  useEffect(() => {
    hasPrefetched.current = false;
  }, [resolvedHref]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || isExternal) return;

    const router = getRouter();
    if (!router) return;

    if (viewport) {
      router.observeForPrefetch(element);
      return () => router.unobserveForPrefetch(element);
    }
  }, [resolvedHref, viewport, isExternal]);

  useEffect(() => {
    if (!render || isExternal) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tryRenderPrefetch = () => {
      if (cancelled || hasPrefetched.current) return;

      const router = getRouter();
      if (!router) {
        timeoutId = setTimeout(tryRenderPrefetch, 30);
        return;
      }

      hasPrefetched.current = true;
      router.prefetch(resolvedHref);
    };

    tryRenderPrefetch();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [render, isExternal, resolvedHref]);

  useEffect(() => {
    return () => {
      if (intentTimeoutRef.current) {
        clearTimeout(intentTimeoutRef.current);
        intentTimeoutRef.current = null;
      }
    };
  }, []);

  const cancelIntent = useCallback(() => {
    if (intentTimeoutRef.current) {
      clearTimeout(intentTimeoutRef.current);
      intentTimeoutRef.current = null;
    }
  }, []);

  const scheduleIntentPrefetch = useCallback(() => {
    if (isExternal || !intent || hasPrefetched.current) return;
    cancelIntent();
    intentTimeoutRef.current = setTimeout(() => {
      intentTimeoutRef.current = null;
      doPrefetch();
    }, prefetchDelay);
  }, [intent, isExternal, prefetchDelay, doPrefetch, cancelIntent]);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onMouseEnter?.(event);
      scheduleIntentPrefetch();
    },
    [onMouseEnter, scheduleIntentPrefetch],
  );

  const handleMouseLeave = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onMouseLeave?.(event);
      cancelIntent();
    },
    [onMouseLeave, cancelIntent],
  );

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLAnchorElement>) => {
      onTouchStart?.(event);
      scheduleIntentPrefetch();
    },
    [onTouchStart, scheduleIntentPrefetch],
  );

  const handleFocus = useCallback(
    (event: React.FocusEvent<HTMLAnchorElement>) => {
      onFocus?.(event);
      scheduleIntentPrefetch();
    },
    [onFocus, scheduleIntentPrefetch],
  );

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLAnchorElement>) => {
      onBlur?.(event);
      cancelIntent();
    },
    [onBlur, cancelIntent],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (isExternal) return;
      if (target && target !== "_self") return;
      if (isModifierEvent(event)) return;
      if (event.button !== 0) return;

      if (typeof window !== "undefined") {
        event.preventDefault();
        if (isFarmLocaleChangeHref(resolvedHref)) {
          window.location.assign(resolvedHref);
          return;
        }
        const router = getRouter();
        if (router) {
          router.navigate(resolvedHref, { replace, scroll, viewTransition });
        } else {
          if (replace) window.location.replace(resolvedHref);
          else window.location.href = resolvedHref;
        }
      }
    },
    [resolvedHref, replace, scroll, viewTransition, target, isExternal, onClick],
  );

  const setRefs = useCallback(
    (node: HTMLAnchorElement | null) => {
      elementRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLAnchorElement | null>).current = node;
    },
    [ref],
  );

  return (
    <a
      ref={setRefs}
      href={resolvedHref}
      target={target}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTouchStart={handleTouchStart}
      {...props}
      data-farm-link=""
      data-replace={replace ? "" : undefined}
      data-no-scroll={!scroll ? "" : undefined}
      data-view-transition={
        viewTransition === "auto" ? "auto" : viewTransition ? "true" : undefined
      }
    />
  );
}

const LinkWithRef = forwardRef(LinkInner);
LinkWithRef.displayName = "Link";

type LinkComponentType = <TRoute extends string = DefaultRouteHref>(
  props: LinkProps<TRoute> & { ref?: React.ForwardedRef<HTMLAnchorElement> },
) => React.ReactElement;

export const Link = LinkWithRef as unknown as LinkComponentType;

function resolveLinkHref(
  href: string,
  params: FarmRouterPathParams | undefined,
  options: FarmRouterBuildOptions,
) {
  if (isExternalUrl(href)) return href;

  const { pathname, query, hash } = splitInternalHref(href);

  const resolvedHref = buildFarmRoutePath(pathname, params, {
    query: mergeQueryParams(query, options.query),
    hash: options.hash ?? hash,
    trailingSlash: options.trailingSlash,
  });

  return applyPreservedSearchParams(resolvedHref);
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
  if (typeof window === "undefined") return href;

  const manifest = (window as any).__FARM_MANIFEST__;
  const routes =
    manifest?.routes && typeof manifest.routes === "object" ? Object.values(manifest.routes) : [];
  if (routes.length === 0) return href;

  const url = new URL(href, window.location.origin);
  const route = routes.find((candidate: any) => matchManifestRoute(url.pathname, candidate));
  const preserve = Array.isArray((route as any)?.search?.preserve)
    ? ((route as any).search.preserve as string[])
    : [];
  if (preserve.length === 0) return href;

  const current = new URLSearchParams(window.location.search);
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
