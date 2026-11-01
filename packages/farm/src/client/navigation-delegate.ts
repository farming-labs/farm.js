"use client";

import type { FarmNavigationBlockerContext } from "./spa-router";

/** A navigation offered to a delegate, after every blocker let it through. */
export interface FarmNavigationDelegateContext extends FarmNavigationBlockerContext {
  /** The resolved absolute URL, with its search and hash. */
  url: string;
  /** `"replace"` for `Link replace`, `router.replace()` and `{ replace: true }`, else `"push"`. */
  action: "push" | "replace";
}

/**
 * Return `true` to take the navigation: the router leaves the page as it is, so the delegate shows
 * the URL itself, for example in a new native screen. Anything else lets the router navigate.
 */
export type FarmNavigationDelegate = (
  context: FarmNavigationDelegateContext,
) => boolean | void | Promise<boolean | void>;

// On globalThis, so a delegate registered before the router starts, or from another copy of this
// module, reaches the router that runs.
const DELEGATES = Symbol.for("farm.navigation.delegates");

type DelegateHost = typeof globalThis & { [DELEGATES]?: Set<FarmNavigationDelegate> };

/**
 * Hand in-app navigations to a host, such as a native shell that opens each page on its own
 * screen, instead of navigating in place. Covers `Link`, plain same-origin anchors, `navigateTo`,
 * and router `push`/`replace`, after blockers. Back/forward, refreshes, same-page hash changes and
 * document navigations (other origins, locale switches) are not offered. Returns a function that
 * removes the delegate.
 */
export function delegateNavigation(delegate: FarmNavigationDelegate): () => void {
  const host = globalThis as DelegateHost;
  const delegates = (host[DELEGATES] ??= new Set());
  delegates.add(delegate);
  return () => {
    delegates.delete(delegate);
  };
}

/**
 * @internal The router's step after its blockers: true when a delegate took the navigation. A
 * delegate that throws is reported and counts as declining, so the page still navigates.
 */
export async function runFarmNavigationDelegates(
  context: FarmNavigationDelegateContext,
): Promise<boolean> {
  const delegates = (globalThis as DelegateHost)[DELEGATES];
  if (!delegates?.size) return false;
  for (const delegate of delegates) {
    try {
      if ((await delegate(context)) === true) return true;
    } catch (error) {
      console.error("[Farm.js] A navigation delegate failed; navigating in place.", error);
    }
  }
  return false;
}
