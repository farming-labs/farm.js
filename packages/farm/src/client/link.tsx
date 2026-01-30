"use client";

import type React from "react";
import { forwardRef, useEffect, useRef, useCallback, type AnchorHTMLAttributes } from "react";

type PrefetchMode = boolean | "hover" | "viewport" | "none";

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /** The URL to navigate to */
  href: string;
  /** Prefetch strategy: true (viewport+hover), "hover", "viewport", "none", or false */
  prefetch?: PrefetchMode;
  /** Replace current history entry instead of pushing */
  replace?: boolean;
  /** Scroll to top after navigation (default: true) */
  scroll?: boolean;
}

/**
 * Helper: detect modifier keys (Ctrl/Cmd+Click should open in new tab)
 */
function isModifierEvent(e: React.MouseEvent): boolean {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}

/**
 * Helper: check if external URL
 */
function isExternalUrl(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//");
}

/**
 * Get the SPA router instance
 */
function getRouter() {
  if (typeof window !== "undefined" && (window as any).__FARM_SPA_ROUTER__) {
    return (window as any).__FARM_SPA_ROUTER__;
  }
  return null;
}

/**
 * Next.js-style Link component for client-side SPA navigation
 *
 * Features:
 * - Prevents full page reload for internal links
 * - Uses History API for smooth SPA navigation
 * - Prefetch on viewport intersection (IntersectionObserver)
 * - Prefetch on hover
 * - Preserves href for SEO, accessibility, and right-click behavior
 * - Handles external links normally
 * - Respects modifier keys (Ctrl+Click opens in new tab)
 * - Scroll restoration
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, prefetch = true, replace = false, scroll = true, onClick, target, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const elementRef = useRef<HTMLAnchorElement | null>(null);
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasPrefetched = useRef(false);

    // Determine prefetch modes
    const prefetchOnViewport = prefetch === true || prefetch === "viewport";
    const prefetchOnHover = prefetch === true || prefetch === "hover";
    const isExternal = isExternalUrl(href);

    // Set up intersection observer for viewport prefetching
    useEffect(() => {
      const element = elementRef.current;
      if (!element || isExternal || !prefetchOnViewport) return;

      const router = getRouter();
      if (!router) return;

      router.observeForPrefetch(element);

      return () => {
        router.unobserveForPrefetch(element);
      };
    }, [href, prefetchOnViewport, isExternal]);

    // Handle mouse enter for hover prefetching
    const handleMouseEnter = useCallback(
      (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (onMouseEnter) {
          onMouseEnter(event);
        }

        if (isExternal || !prefetchOnHover || hasPrefetched.current) return;

        const router = getRouter();
        if (!router) return;

        // Delay prefetch slightly to avoid prefetching on quick scroll-by
        hoverTimeoutRef.current = setTimeout(() => {
          router.prefetch(href);
          hasPrefetched.current = true;
        }, 65);
      },
      [href, prefetchOnHover, isExternal, onMouseEnter]
    );

    // Handle mouse leave to cancel pending prefetch
    const handleMouseLeave = useCallback(
      (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (onMouseLeave) {
          onMouseLeave(event);
        }

        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
      },
      [onMouseLeave]
    );

    // Handle click for SPA navigation
    const handleClick = useCallback(
      (event: React.MouseEvent<HTMLAnchorElement>) => {
        // Call custom onClick if provided
        if (onClick) {
          onClick(event);
        }

        // Don't intercept if already prevented
        if (event.defaultPrevented) return;

        // Don't intercept external links
        if (isExternal) return;

        // Don't intercept if opening in new tab/window
        if (target && target !== "_self") return;

        // Don't intercept modifier clicks (Ctrl+Click = new tab)
        if (isModifierEvent(event)) return;

        // Don't intercept non-left clicks
        if (event.button !== 0) return;

        // Use SPA router if available
        if (typeof window !== "undefined") {
          event.preventDefault();

          const router = getRouter();
          if (router) {
            router.navigate(href, { replace, scroll });
          } else {
            // Fallback to full page navigation
            if (replace) {
              window.location.replace(href);
            } else {
              window.location.href = href;
            }
          }
        }
      },
      [href, replace, scroll, target, isExternal, onClick]
    );

    // Combine refs
    const setRefs = useCallback(
      (node: HTMLAnchorElement | null) => {
        elementRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref]
    );

    return (
      <a
        ref={setRefs}
        href={href}
        target={target}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      />
    );
  }
);

Link.displayName = "Link";
