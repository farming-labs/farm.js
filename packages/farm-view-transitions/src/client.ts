"use client";

import { isRouteExcluded, prefersReducedMotion, supportsViewTransitions } from "./policy.js";
import type {
  ResolvedViewTransitionsOptions,
  ViewTransitionDocument,
  ViewTransitionsNavigationEvent,
  ViewTransitionsRuntime,
} from "./types.js";

/**
 * Start the browser runtime for view transitions.
 *
 * - `navigation.before`: the old page is still on screen. When the
 *   browser supports the View Transitions API, the user has not asked
 *   for reduced motion, and the destination is not excluded, the runtime
 *   calls `document.startViewTransition` with an update callback that
 *   stays pending — the browser captures the old page and waits.
 * - `navigation.resolved`: the new page is in place. The runtime resolves
 *   the update callback of the transition started for the same
 *   navigation, so the browser captures the new page and animates
 *   between the two snapshots.
 *
 * A navigation that starts while a transition is still pending releases
 * the pending update callback first: the browser skips the superseded
 * transition, and its callback must never hang. Unsupported browsers,
 * reduced motion, and excluded routes navigate exactly as they do
 * without the plugin. Every browser call is try/catch-wrapped and every
 * transition promise gets a rejection handler: a skipped transition
 * rejects its promises, and none of that may break or noisily fail a
 * navigation.
 */
export function startViewTransitionsRuntime(
  options: ResolvedViewTransitionsOptions,
  runtimeWindow: Window & typeof globalThis = window,
): ViewTransitionsRuntime {
  let closed = false;
  let pending: { navigationId: string; release: () => void } | null = null;

  function releasePending(): void {
    const current = pending;
    pending = null;
    current?.release();
  }

  function beginForNavigation(event: ViewTransitionsNavigationEvent): void {
    if (closed) return;
    // A newer navigation supersedes any transition still waiting for its
    // page: release its update callback so it can never hang.
    releasePending();

    const doc = runtimeWindow.document as unknown as ViewTransitionDocument | undefined;
    if (!supportsViewTransitions(doc)) return;
    if (prefersReducedMotion(runtimeWindow)) return;
    if (isRouteExcluded(options.exclude, event.to.pathname)) return;

    let release!: () => void;
    const updated = new Promise<void>((resolve) => {
      release = resolve;
    });
    let transition: ReturnType<ViewTransitionDocument["startViewTransition"]>;
    try {
      transition = doc!.startViewTransition(() => updated);
    } catch {
      // A throwing startViewTransition must never break the navigation.
      return;
    }
    pending = { navigationId: event.id, release };
    // Skipped or superseded transitions reject these promises; swallow
    // the rejections so they never surface as unhandled.
    transition.updateCallbackDone.catch(() => {});
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  }

  function finishForNavigation(event: ViewTransitionsNavigationEvent): void {
    if (closed || pending?.navigationId !== event.id) return;
    releasePending();
  }

  return {
    beginForNavigation,
    finishForNavigation,
    close() {
      closed = true;
      releasePending();
    },
  };
}
