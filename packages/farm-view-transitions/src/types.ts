/** Options for the `viewTransitions()` server plugin. Only JSON-safe
 * values travel to the browser (see
 * `packages/farm/src/client-plugin-build.ts`). */
export interface ViewTransitionsOptions {
  /** Route patterns that never animate, matched against the destination
   * pathname. A pattern is a pathname whose segments are literals,
   * `:param` (one segment), or a trailing `*` (the rest of the path), the
   * same shapes route patterns use: `"/checkout"`, `"/admin/:section"`,
   * `"/print/*"`. Defaults to no exclusions. */
  exclude?: string[];
}

/** The resolved, frozen options the browser runtime runs with. */
export interface ResolvedViewTransitionsOptions {
  exclude: string[];
}

/** The browser runtime created by `startViewTransitionsRuntime`. */
export interface ViewTransitionsRuntime {
  /** Start a view transition for the navigation that is about to run, so
   * the browser captures the page still on screen. Called from the
   * plugin's `navigation.before` hook. A no-op where the View Transitions
   * API is unsupported, where the user prefers reduced motion, or where
   * the destination route is excluded. */
  beginForNavigation(event: ViewTransitionsNavigationEvent): void;
  /** Complete the transition started for the same navigation: the new
   * page is in place, so the transition's update promise resolves and the
   * browser animates to it. Called from the plugin's
   * `navigation.resolved` hook. */
  finishForNavigation(event: ViewTransitionsNavigationEvent): void;
  close(): void;
}

/** The smallest navigation shape this runtime needs. The framework's
 * `FarmClientNavigationSession` satisfies it. */
export interface ViewTransitionsNavigationEvent {
  id: string;
  to: { href: string; pathname: string; search: string; hash: string };
  action: "push" | "replace" | "pop";
}

/** The part of the View Transitions API this runtime drives. Declared
 * locally so the runtime does not depend on the DOM lib carrying
 * `document.startViewTransition` yet. */
export interface ViewTransitionHandle {
  updateCallbackDone: Promise<void>;
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition(): void;
}

/** The smallest document surface the runtime needs. A real `Document`
 * satisfies it where the View Transitions API exists. */
export interface ViewTransitionDocument {
  startViewTransition(callback: () => Promise<void>): ViewTransitionHandle;
}
