/** Which plain-anchor triggers prefetch a page. */
export type PrefetchStrategy = "hover" | "viewport" | "both";

/** Options for the `prefetch()` server plugin. Only JSON-safe values travel
 * to the browser (see `packages/farm/src/client-plugin-build.ts`). */
export interface PrefetchOptions {
  /** Which triggers prefetch plain anchors. Defaults to `"both"`. */
  strategy?: PrefetchStrategy;
  /** Maximum concurrent `router.prefetch` calls. Defaults to `6`. The core
   * router already dedupes in-flight and cached URLs; the cap bounds how
   * many page-data fetches run at once. */
  maxConcurrent?: number;
  /** Route patterns that may be prefetched, in Farm route syntax
   * (`/posts/[id]`, `/docs/[...slug]`, `/pricing`). Empty (the default)
   * allows every same-origin path. A path matches when any pattern matches. */
  allow?: string[];
  /** Route patterns that are never prefetched. Checked before `allow`, so a
   * denied pattern wins over an allowed one. Defaults to `[]`. */
  deny?: string[];
  /** Delay in milliseconds after pointerenter/focus before a hover
   * prefetch fires. Defaults to `50` (the same default as core `Link`). */
  hoverDelayMs?: number;
}

/** The resolved, frozen options the browser runtime runs with. */
export interface ResolvedPrefetchOptions {
  strategy: PrefetchStrategy;
  maxConcurrent: number;
  allow: readonly string[];
  deny: readonly string[];
  hoverDelayMs: number;
}

/** The browser runtime created by `startPrefetchRuntime`. */
export interface PrefetchRuntime {
  close(): void;
}
