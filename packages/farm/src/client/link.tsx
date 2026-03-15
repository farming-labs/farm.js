"use client";

import type React from "react";
import { forwardRef, useEffect, useRef, useCallback, type AnchorHTMLAttributes } from "react";

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
 * Augment this interface via your generated farm-routes.d.ts so Link href is typed
 * without passing a generic. Defaults to string when not augmented.
 */
export interface LinkDefaultRoute {}

export type DefaultRoutePath = LinkDefaultRoute extends { _: infer TRoute extends string }
  ? TRoute
  : string;

/** External URLs; these are never type-checked as routes. */
export type ExternalHref =
  | `http://${string}`
  | `https://${string}`
  | `//${string}`
  | `mailto:${string}`;

export interface LinkProps<TRoute extends string = DefaultRoutePath> extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  /** Internal route path (typed when route types are generated) or external URL. */
  href: TRoute | ExternalHref;
  /**
   * When to prefetch. TanStack-style: "intent" (hover+touch), "viewport", "render", or "none".
   * Legacy: true (intent+viewport), "hover" (intent), "viewport", false/"none".
   */
  prefetch?: PrefetchBehavior | PrefetchLegacy;
  /** Delay in ms before intent-based prefetch (hover/touch). Default 50. */
  prefetchDelay?: number;
  /** Replace current history entry instead of pushing */
  replace?: boolean;
  /** Scroll to top after navigation (default: true) */
  scroll?: boolean;
}

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
  navigate(href: string, opts: { replace?: boolean; scroll?: boolean }): void;
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

function LinkInner<TRoute extends string = DefaultRoutePath>(
  {
    href,
    prefetch = true,
    prefetchDelay = 50,
    replace = false,
    scroll = true,
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
  const isExternal = isExternalUrl(href);

  const doPrefetch = useCallback(() => {
    if (isExternal || hasPrefetched.current) return;
    const router = getRouter();
    if (!router) return;
    hasPrefetched.current = true;
    router.prefetch(href);
  }, [href, isExternal]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || isExternal) return;

    const router = getRouter();
    if (!router) return;

    if (viewport) {
      router.observeForPrefetch(element);
      return () => router.unobserveForPrefetch(element);
    }
  }, [href, viewport, isExternal]);

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
      router.prefetch(href);
    };

    tryRenderPrefetch();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [render, isExternal, href]);

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
        const router = getRouter();
        if (router) {
          router.navigate(href, { replace, scroll });
        } else {
          if (replace) window.location.replace(href);
          else window.location.href = href;
        }
      }
    },
    [href, replace, scroll, target, isExternal, onClick],
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
      href={href}
      target={target}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTouchStart={handleTouchStart}
      {...props}
    />
  );
}

const LinkWithRef = forwardRef(LinkInner);
LinkWithRef.displayName = "Link";

type LinkComponentType = <TRoute extends string = DefaultRoutePath>(
  props: LinkProps<TRoute> & { ref?: React.ForwardedRef<HTMLAnchorElement> },
) => React.ReactElement;

export const Link = LinkWithRef as unknown as LinkComponentType;
