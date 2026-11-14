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
  /** Save the current window scroll position for the page still on
   * screen. Called from the plugin's `navigation.before` hook. */
  saveForNavigation(event: ScrollRestorationNavigationEvent): void;
  /** Record the page now on screen and, for a Back/Forward traversal,
   * restore its saved window scroll position. Called from the plugin's
   * `navigation.rendered` hook. */
  restoreForNavigation(event: ScrollRestorationNavigationEvent): void;
  close(): void;
}

/** The smallest navigation shape this runtime needs. The framework's
 * `FarmClientNavigationSession` satisfies it. */
export interface ScrollRestorationNavigationEvent {
  id: string;
  to: { href: string; pathname: string; search: string; hash: string };
  action: "push" | "replace" | "pop";
}
