"use client";

import {
  createScrollEntryId,
  readScrollEntryId,
  readStoredScrollPosition,
  SCROLL_ENTRY_STATE_KEY,
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
 * Every history entry gets an id in its `history.state`, and positions are
 * saved per id, the way the browser and React Router keep them. Visiting the
 * same URL twice gives two entries with two positions.
 *
 * - `navigation.before`: save the window scroll position under the id of
 *   the entry still on screen. On Back/Forward the URL and `history.state`
 *   already name the destination, so the runtime remembers the id itself.
 * - `navigation.resolved`: the new page is in place. Give a pushed or
 *   replaced entry a fresh id, or read the id of the entry Back/Forward
 *   reached. This runs before `rendered` because core skips `rendered` when
 *   a newer navigation starts, and the runtime must still know which entry
 *   is on screen.
 * - `navigation.rendered`: for Back/Forward (`pop`) navigations only,
 *   restore the saved position of the entry being entered. New pushes keep
 *   the top, as core already scrolls them there.
 *
 * Positions live in `sessionStorage`, so they survive reloads within a tab
 * and die with it. Every history, storage and scroll access is
 * try/catch-wrapped: a hostile environment must never break a navigation.
 * Registered scroll elements (the `useScrollRestoration` hook) stay with
 * core; this runtime restores the window position only.
 */
export function startScrollRestorationRuntime(
  options: ResolvedScrollRestorationOptions,
  runtimeWindow: Window & typeof globalThis = window,
): ScrollRestorationRuntime {
  let closed = false;
  let currentEntry = readScrollEntryId(readHistoryState()) ?? tagCurrentEntry();
  let pendingRestore: { navigationId: string; entry: string } | null = null;

  function readHistoryState(): unknown {
    try {
      return runtimeWindow.history.state;
    } catch {
      return null;
    }
  }

  /** Give the entry on screen a new id, kept next to the router's own state. */
  function tagCurrentEntry(): string {
    const id = createScrollEntryId();
    try {
      const state = readHistoryState();
      runtimeWindow.history.replaceState(
        { ...(state && typeof state === "object" ? state : {}), [SCROLL_ENTRY_STATE_KEY]: id },
        "",
      );
    } catch {
      // Safari throws when replaceState is called too often. The entry then
      // has no id and Back to it leaves the scroll to core.
    }
    return id;
  }

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
      scrollStorageKey(options.storageKeyPrefix, currentEntry),
      {
        x: runtimeWindow.scrollX,
        y: runtimeWindow.scrollY,
      },
    );
  }

  function enterForNavigation(event: ScrollRestorationNavigationEvent): void {
    if (closed) return;
    pendingRestore = null;
    if (event.action !== "pop") {
      // A push or replace shows a new page. Routers may copy the previous
      // entry's state into it, so an id already there is not this page's.
      currentEntry = tagCurrentEntry();
      return;
    }
    const entry = readScrollEntryId(readHistoryState());
    currentEntry = entry ?? tagCurrentEntry();
    // A fragment in the destination URL is an explicit scroll target; core
    // scrolls to it, and this runtime must not fight it.
    if (entry && !event.to.hash) pendingRestore = { navigationId: event.id, entry };
  }

  function restoreForNavigation(event: ScrollRestorationNavigationEvent): void {
    if (closed || pendingRestore?.navigationId !== event.id) return;
    const { entry } = pendingRestore;
    pendingRestore = null;
    const saved = readStoredScrollPosition(
      getStorage(),
      scrollStorageKey(options.storageKeyPrefix, entry),
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
    enterForNavigation,
    restoreForNavigation,
    close() {
      closed = true;
    },
  };
}
