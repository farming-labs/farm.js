/** When a link is prefetched. The same values as core `Link`'s `prefetch` prop:
 * `"intent"` on hover, focus or touch, `"viewport"` when it nears the viewport,
 * `"render"` as soon as it is on the page, `"none"` never. */
export type PrefetchMode = "intent" | "viewport" | "render" | "none";

/** Options for the `prefetch()` server plugin. Only JSON-safe values travel
 * to the browser (see `packages/farm/src/client-plugin-build.ts`). */
export interface PrefetchOptions {
  /** How plain same-origin links are prefetched. Defaults to `"intent"`. A
   * link overrides it with `data-farm-prefetch="intent|viewport|render|none"`. */
  mode?: PrefetchMode;
  /** Delay after hover, focus or touch before an intent prefetch. Defaults
   * to `50`, the same as `Link`'s `prefetchDelay`. */
  intentDelayMs?: number;
  /** Route patterns that may be prefetched, in Farm route syntax
   * (`/posts/[id]`, `/docs/[...slug]`). Applies to every prefetch, `Link`'s
   * included. Patterns match the path the browser requests, so a `basePath`
   * or locale prefix is part of it. Empty (the default) allows every path. */
  allow?: string[];
  /** Route patterns that are never prefetched, `Link`'s included. Checked
   * before `allow`, so `deny` wins. Defaults to `[]`. */
  deny?: string[];
}

/** The resolved, frozen options the browser runtime runs with. */
export interface ResolvedPrefetchOptions {
  mode: PrefetchMode;
  intentDelayMs: number;
  allow: readonly string[];
  deny: readonly string[];
}

/** The browser runtime created by `startPrefetchRuntime`. */
export interface PrefetchRuntime {
  close(): void;
}
