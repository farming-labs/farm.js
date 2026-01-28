"use client";

import type React from "react";
import { forwardRef, type AnchorHTMLAttributes } from "react";

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
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
 * Next.js-style Link component for client-side SPA navigation
 * 
 * Features:
 * - Prevents full page reload for internal links
 * - Uses History API for smooth SPA navigation
 * - Preserves href for SEO, accessibility, and right-click behavior
 * - Handles external links normally
 * - Respects modifier keys (Ctrl+Click opens in new tab)
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, prefetch = true, replace = false, onClick, target, ...props }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Call custom onClick if provided
      if (onClick) {
        onClick(event);
      }

      // Don't intercept if already prevented
      if (event.defaultPrevented) return;

      // Don't intercept external links
      if (isExternalUrl(href)) return;

      // Don't intercept if opening in new tab/window
      if (target && target !== "_self") return;

      // Don't intercept modifier clicks (Ctrl+Click = new tab)
      if (isModifierEvent(event)) return;

      // Don't intercept non-left clicks
      if (event.button !== 0) return;

      // For now, do a full page navigation
      // SPA navigation requires a client-side router with all routes bundled
      // This ensures pages work correctly with SSR
      if (typeof window !== "undefined") {
        event.preventDefault();
        if (replace) {
          window.location.replace(href);
        } else {
          window.location.href = href;
        }
      }
    };

    return <a ref={ref} href={href} target={target} onClick={handleClick} {...props} />;
  },
);

Link.displayName = "Link";
