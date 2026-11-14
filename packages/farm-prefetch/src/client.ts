"use client";

import { isDataSaving, isPathAllowed, PrefetchQueue, resolvePrefetchTarget } from "./policy.js";
import type { PrefetchRuntime, ResolvedPrefetchOptions } from "./types.js";

/** The smallest router surface this runtime needs. The framework router
 * (`FarmClientPluginRouter`) satisfies it; a runtime without `prefetch`
 * disables the plugin instead of failing. */
export interface PrefetchRouter {
  prefetch?(href: string): Promise<void> | void;
}

const LINK_MANAGED_ATTRIBUTE = "data-farm-link";
const OPTOUT_ATTRIBUTE = "data-farm-prefetch";
const OPTOUT_VALUE = "off";

/**
 * Start the browser runtime for app-wide link prefetching.
 *
 * Core `Link` already prefetches its own links (intent / viewport / render);
 * this runtime covers the links core never sees — plain `<a>` elements in
 * rendered HTML, Markdown and CMS content — through the same
 * `router.prefetch` primitive, so fetching, caching and dedupe stay in one
 * place. `Link`-managed anchors (`data-farm-link`) are skipped, as are
 * external, download, `_blank` and opted-out (`data-farm-prefetch="off"`)
 * links.
 */
export function startPrefetchRuntime(
  options: ResolvedPrefetchOptions,
  runtimeWindow: Window & typeof globalThis = window,
  router?: PrefetchRouter | null,
): PrefetchRuntime {
  let closed = false;
  const noop: PrefetchRuntime = {
    close() {
      closed = true;
    },
  };

  // Data-saving users asked for no speculative traffic, and without a
  // router prefetch there is nothing to call — stay inert either way.
  if (isDataSaving(runtimeWindow)) return noop;
  if (typeof router?.prefetch !== "function") return noop;

  const prefetch = router.prefetch.bind(router);
  const queue = new PrefetchQueue(async (href: string) => {
    await prefetch(href);
  }, options.maxConcurrent);
  const attached = new WeakSet<Element>();
  const hoverTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  let viewportObserver: IntersectionObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  function isPrefetchable(anchor: HTMLAnchorElement): string | null {
    if (anchor.hasAttribute(LINK_MANAGED_ATTRIBUTE)) return null;
    if (anchor.getAttribute(OPTOUT_ATTRIBUTE) === OPTOUT_VALUE) return null;
    if (anchor.hasAttribute("download")) return null;
    const target = anchor.getAttribute("target");
    if (target !== null && target !== "_self") return null;
    const href = anchor.getAttribute("href");
    if (!href) return null;
    const resolved = resolvePrefetchTarget({ href, baseHref: runtimeWindow.location.href });
    if (!resolved.ok) return null;
    if (!isPathAllowed(resolved.pathname, options.allow, options.deny)) return null;
    return resolved.href;
  }

  function requestPrefetch(anchor: HTMLAnchorElement): void {
    if (closed) return;
    const href = isPrefetchable(anchor);
    if (href !== null) queue.enqueue(href);
  }

  function cancelHover(anchor: Element): void {
    const timer = hoverTimers.get(anchor);
    if (timer !== undefined) {
      runtimeWindow.clearTimeout(timer);
      hoverTimers.delete(anchor);
    }
  }

  function scheduleHover(anchor: HTMLAnchorElement): void {
    if (closed) return;
    cancelHover(anchor);
    if (options.hoverDelayMs === 0) {
      requestPrefetch(anchor);
      return;
    }
    hoverTimers.set(
      anchor,
      runtimeWindow.setTimeout(() => {
        hoverTimers.delete(anchor);
        requestPrefetch(anchor);
      }, options.hoverDelayMs),
    );
  }

  function attach(anchor: HTMLAnchorElement): void {
    if (closed || attached.has(anchor)) return;
    // An anchor with no prefetchable href today may gain one later (the
    // href can change); only skip the ones that are structurally out of
    // scope, and re-check the href at trigger time.
    if (
      anchor.hasAttribute(LINK_MANAGED_ATTRIBUTE) ||
      anchor.getAttribute(OPTOUT_ATTRIBUTE) === OPTOUT_VALUE ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    attached.add(anchor);
    if (options.strategy === "hover" || options.strategy === "both") {
      anchor.addEventListener("pointerenter", () => scheduleHover(anchor));
      anchor.addEventListener("focus", () => scheduleHover(anchor));
      anchor.addEventListener("pointerleave", () => cancelHover(anchor));
      anchor.addEventListener("blur", () => cancelHover(anchor));
    }
    if (
      (options.strategy === "viewport" || options.strategy === "both") &&
      viewportObserver !== null
    ) {
      viewportObserver.observe(anchor);
    }
  }

  function scan(root: ParentNode): void {
    for (const anchor of root.querySelectorAll("a[href]")) {
      attach(anchor as HTMLAnchorElement);
    }
  }

  if (options.strategy === "viewport" || options.strategy === "both") {
    const Observer = runtimeWindow.IntersectionObserver;
    if (typeof Observer === "function") {
      viewportObserver = new Observer((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const anchor = entry.target as HTMLAnchorElement;
          viewportObserver?.unobserve(anchor);
          requestPrefetch(anchor);
        }
      });
    }
  }

  scan(runtimeWindow.document);

  const MutationObserverConstructor = runtimeWindow.MutationObserver;
  if (typeof MutationObserverConstructor === "function") {
    mutationObserver = new MutationObserverConstructor((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof runtimeWindow.HTMLAnchorElement) {
            attach(node);
          } else if (node instanceof runtimeWindow.Element) {
            scan(node);
          }
        }
      }
    });
    mutationObserver.observe(runtimeWindow.document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  return {
    close() {
      if (closed) return;
      closed = true;
      viewportObserver?.disconnect();
      viewportObserver = null;
      mutationObserver?.disconnect();
      mutationObserver = null;
      for (const timer of hoverTimers.values()) runtimeWindow.clearTimeout(timer);
      hoverTimers.clear();
      queue.clear();
    },
  };
}
