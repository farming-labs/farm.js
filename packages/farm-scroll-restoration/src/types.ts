/** Options for the `scrollRestoration()` server plugin. Only JSON-safe
 * values travel to the browser (see
 * `packages/farm/src/client-plugin-build.ts`). */
export interface ScrollRestorationOptions {
  /** Prefix for the `sessionStorage` keys that hold saved scroll
   * positions. Defaults to `"farm-scroll-restore"`. Change it only to
   * avoid a collision with another entry in the same storage. */
  storageKeyPrefix?: string;
}

/** The resolved, frozen options the browser runtime runs with. */
export interface ResolvedScrollRestorationOptions {
  storageKeyPrefix: string;
}

/** The browser runtime created by `startScrollRestorationRuntime`. */
export interface ScrollRestorationRuntime {
  /** Save the current window scroll position for the page being left.
   * Called from the plugin's `navigation.before` hook. */
  saveForNavigation(event: ScrollRestorationNavigationEvent): void;
  /** Restore the saved window scroll position for the page being entered,
   * when the navigation is a back/forward traversal. Called from the
   * plugin's `navigation.rendered` hook. */
  restoreForNavigation(event: ScrollRestorationNavigationEvent): void;
  /** Drop the opt-out recorded for a navigation that never rendered
   * (aborted or failed). */
  discard(navigationId: string): void;
  close(): void;
}

/** The smallest navigation shape this runtime needs. The framework's
 * `FarmClientNavigationSession` satisfies it; a route is carried only when
 * the router populates `session.route`. */
export interface ScrollRestorationNavigationEvent {
  id: string;
  from: { href: string; pathname: string; search: string; hash: string } | null;
  to: { href: string; pathname: string; search: string; hash: string };
  action: "push" | "replace" | "pop";
  route?: {
    pattern?: string | null;
    params?: Record<string, string>;
  };
}
