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

/**
 * Start the browser runtime for scroll restoration.
 *
 * - `navigation.before`: save the window scroll position under the key of
 *   the page still on screen. On Back/Forward the URL already names the
 *   destination, so the runtime tracks the rendered page itself.
 * - `navigation.rendered`: for Back/Forward (`pop`) navigations only,
 *   restore the saved position of the page being entered. New pushes keep
 *   the top, as core already scrolls them there.
 *
 * Positions live in `sessionStorage`, so they survive reloads within a tab
 * and die with it. Every storage and scroll access is try/catch-wrapped: a
 * hostile environment must never break a navigation. Registered scroll
 * elements (the `useScrollRestoration` hook) stay with core; this runtime
 * restores the window position only.
 */
export function startScrollRestorationRuntime(
  options: ResolvedScrollRestorationOptions,
  runtimeWindow: Window & typeof globalThis = window,
): ScrollRestorationRuntime {
  let closed = false;
  let currentKey = scrollKeyFor(runtimeWindow.location);

  function getStorage(): Storage | null {
    try {
      return runtimeWindow.sessionStorage ?? null;
    } catch {
      return null;
    }
  }

  function saveForNavigation(): void {
    if (closed) return;
    writeStoredScrollPosition(
      getStorage(),
      scrollStorageKey(options.storageKeyPrefix, currentKey),
      {
        x: runtimeWindow.scrollX,
        y: runtimeWindow.scrollY,
      },
    );
  }

  function restoreForNavigation(event: ScrollRestorationNavigationEvent): void {
    currentKey = scrollKeyFor(event.to);
    if (closed || event.action !== "pop") return;
    // A fragment in the destination URL is an explicit scroll target; core
    // scrolls to it, and this runtime must not fight it.
    if (event.to.hash) return;
    const saved = readStoredScrollPosition(
      getStorage(),
      scrollStorageKey(options.storageKeyPrefix, currentKey),
    );
    if (!saved) return;
    try {
      runtimeWindow.scrollTo(saved.x, saved.y);
    } catch {
      // A hostile scrollTo must never break the rendered navigation.
    }
  }

  return {
    saveForNavigation,
    restoreForNavigation,
    close() {
      closed = true;
    },
  };
}
