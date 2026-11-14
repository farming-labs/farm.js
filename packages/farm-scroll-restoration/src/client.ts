"use client";

import {
  readStoredScrollPosition,
  scrollKeyFor,
  scrollStorageKey,
  writeStoredScrollPosition,
} from "./policy.js";
import type {
  ResolvedScrollRestorationOptions,
  ScrollRestorationNavigationEvent,
  ScrollRestorationRuntime,
} from "./types.js";

const OPTOUT_ATTRIBUTE = "data-farm-scroll-restore";
const OPTOUT_VALUE = "off";

/**
 * Start the browser runtime for per-route scroll restoration.
 *
 * Core already saves a scroll position per path and restores it on
 * back/forward — but it restores synchronously, right after the new page
 * data arrives and before the route has rendered, so the scroll is often
 * clamped to the not-yet-rendered document and the visit lands at the top.
 * This plugin re-does the restore at the moment the layout is final:
 *
 * - `navigation.before`: save the window scroll position under the key of
 *   the page being left (route pattern + params when the session carries
 *   a route, otherwise the pathname).
 * - `navigation.rendered`: for back/forward (`pop`) navigations only,
 *   restore the saved position for the page being entered. New pushes
 *   keep the top, as core already scrolls them there.
 *
 * Positions live in `sessionStorage`, so they survive reloads within a tab
 * and die with it. Every storage access is try/catch-wrapped: a hostile
 * storage must never break a navigation. Registered scroll elements (the
 * `useScrollRestoration` hook) stay with core; this plugin restores the
 * window position only.
 *
 * A link opts its navigation out with `data-farm-scroll-restore="off"` —
 * the runtime records the click and skips both the save and the restore
 * for the navigation that click starts.
 */
export function startScrollRestorationRuntime(
  options: ResolvedScrollRestorationOptions,
  runtimeWindow: Window & typeof globalThis = window,
): ScrollRestorationRuntime {
  let closed = false;
  let currentKey = scrollKeyFor({ pathname: runtimeWindow.location.pathname });
  let pendingOptOutPath: string | null = null;
  const optedOut = new Set<string>();

  function getStorage(): Storage | null {
    try {
      const storage = runtimeWindow.sessionStorage;
      return storage ?? null;
    } catch {
      return null;
    }
  }

  function readCurrentPosition(): { x: number; y: number } {
    return { x: runtimeWindow.scrollX, y: runtimeWindow.scrollY };
  }

  function onClick(event: MouseEvent): void {
    if (closed) return;
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    if (anchor.getAttribute(OPTOUT_ATTRIBUTE) !== OPTOUT_VALUE) return;
    try {
      const url = new URL(anchor.getAttribute("href") ?? "", runtimeWindow.location.href);
      pendingOptOutPath = url.pathname + url.search;
    } catch {
      pendingOptOutPath = null;
    }
  }

  runtimeWindow.addEventListener("click", onClick, true);

  function consumeOptOut(event: ScrollRestorationNavigationEvent): boolean {
    if (pendingOptOutPath === null) return false;
    const path = pendingOptOutPath;
    pendingOptOutPath = null;
    return path === event.to.pathname + event.to.search;
  }

  function saveForNavigation(event: ScrollRestorationNavigationEvent): void {
    if (closed) return;
    if (consumeOptOut(event)) {
      optedOut.add(event.id);
      return;
    }
    writeStoredScrollPosition(
      getStorage(),
      scrollStorageKey(options.storageKeyPrefix, currentKey),
      readCurrentPosition(),
    );
  }

  function restoreForNavigation(event: ScrollRestorationNavigationEvent): void {
    const nextKey = scrollKeyFor(event.to, event.route);
    if (closed) {
      currentKey = nextKey;
      return;
    }
    if (optedOut.has(event.id)) {
      optedOut.delete(event.id);
      currentKey = nextKey;
      return;
    }
    currentKey = nextKey;
    if (event.action !== "pop") return;
    // A fragment in the destination URL is an explicit scroll target; core
    // scrolls to it, and this plugin must not fight it.
    if (event.to.hash) return;
    const saved = readStoredScrollPosition(
      getStorage(),
      scrollStorageKey(options.storageKeyPrefix, nextKey),
    );
    if (!saved) return;
    try {
      runtimeWindow.scrollTo(saved.x, saved.y);
    } catch {
      // A hostile scrollTo must never break the rendered navigation.
    }
  }

  function discard(navigationId: string): void {
    optedOut.delete(navigationId);
  }

  return {
    saveForNavigation,
    restoreForNavigation,
    discard,
    close() {
      if (closed) return;
      closed = true;
      runtimeWindow.removeEventListener("click", onClick, true);
      optedOut.clear();
      pendingOptOutPath = null;
    },
  };
}
