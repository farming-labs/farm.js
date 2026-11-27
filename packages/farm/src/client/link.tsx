"use client";

import type React from "react";
import { forwardRef, useEffect, useRef, useCallback, type AnchorHTMLAttributes } from "react";
import { isFarmBlockedNavigationURL, resolveFarmNavigationURL } from "./navigation-url";
import { targetsCurrentContext } from "./link-navigation";
import type { FarmViewTransitionMode } from "./spa-router";
import { isFarmLocaleChangeHref, rememberFarmLinkLocale } from "../i18n/client-state";
import { useOptionalFarm } from "../provider";
import { resolveFarmLink, type DefaultRouteHref, type FarmLinkOptions } from "./link-attributes";

export type {
  DefaultRouteHref,
  DefaultRoutePath,
  DefaultRoutePattern,
  ExternalHref,
  FarmLinkAttributes,
  FarmLinkOptions,
  LinkDefaultRoute,
  LinkExternalUriSchemes,
  PrefetchBehavior,
  ResolvedRouteHref,
  RouteHref,
  RouteOptionalParamValue,
  RouteParams,
  RouteParamValue,
} from "./link-attributes";

export type LinkProps<
  TRoute extends string = DefaultRouteHref,
  THref extends string = string,
> = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & FarmLinkOptions<TRoute, THref>;

function isModifierEvent(e: React.MouseEvent): boolean {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
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

function LinkInner<TRoute extends string = DefaultRouteHref, THref extends string = string>(
  {
    href,
    params,
    query,
    hash,
    trailingSlash,
    prefetch,
    prefetchDelay: prefetchDelayOption,
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
  }: LinkProps<TRoute, THref>,
  ref: React.ForwardedRef<HTMLAnchorElement>,
) {
  const elementRef = useRef<HTMLAnchorElement | null>(null);
  const intentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePrefetch = useRef<symbol | null>(null);
  const farm = useOptionalFarm();

  const link = resolveFarmLink(
    {
      href,
      params,
      query,
      hash,
      trailingSlash,
      prefetch,
      prefetchDelay: prefetchDelayOption,
      replace,
      scroll,
      viewTransition,
      locale,
    } as FarmLinkOptions<string>,
    farm?.basePath,
  );
  const { intent, viewport, render } = link.prefetch;
  const { prefetchDelay, localizedHref } = link;
  const resolvedHref = link.href;
  const isExternal = link.external;
  const isScriptHref = link.script;

  const doPrefetch = useCallback(() => {
    if (isExternal || activePrefetch.current) return;
    const router = getRouter();
    if (!router) return;
    const token = Symbol(resolvedHref);
    activePrefetch.current = token;
    const reset = () => {
      if (activePrefetch.current === token) activePrefetch.current = null;
    };
    try {
      void router.prefetch(resolvedHref).then(reset, reset);
    } catch {
      reset();
    }
  }, [resolvedHref, isExternal]);

  useEffect(() => {
    activePrefetch.current = null;
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
      if (cancelled || activePrefetch.current) return;

      const router = getRouter();
      if (!router) {
        timeoutId = setTimeout(tryRenderPrefetch, 30);
        return;
      }

      doPrefetch();
    };

    tryRenderPrefetch();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [render, isExternal, resolvedHref, doPrefetch]);

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
    if (isExternal || !intent || activePrefetch.current) return;
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
      if (isScriptHref) {
        event.preventDefault();
        isFarmBlockedNavigationURL(resolveFarmNavigationURL(resolvedHref, window.location.href));
        return;
      }
      if (event.defaultPrevented) return;
      if (isExternal) return;
      if (event.currentTarget.hasAttribute("download")) return;
      if (!targetsCurrentContext(event.currentTarget)) return;
      if (isModifierEvent(event)) return;
      if (event.button !== 0) return;

      if (typeof window !== "undefined") {
        event.preventDefault();
        if (isFarmLocaleChangeHref(localizedHref)) {
          rememberFarmLinkLocale(event.currentTarget);
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
    [
      localizedHref,
      resolvedHref,
      replace,
      scroll,
      viewTransition,
      isExternal,
      isScriptHref,
      onClick,
    ],
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
      target={target}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTouchStart={handleTouchStart}
      {...props}
      {...link.attributes}
    />
  );
}

const LinkWithRef = forwardRef(LinkInner);
LinkWithRef.displayName = "Link";

type LinkComponentType = <TRoute extends string = DefaultRouteHref, THref extends string = string>(
  props: LinkProps<TRoute, THref> & { ref?: React.ForwardedRef<HTMLAnchorElement> },
) => React.ReactElement;

export const Link = LinkWithRef as unknown as LinkComponentType;
