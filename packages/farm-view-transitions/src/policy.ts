/**
 * Pure, DOM-free decisions for the view-transitions runtime: capability
 * detection, the reduced-motion preference, and route-pattern matching
 * for the per-route opt-out.
 */

/** The smallest document surface capability detection needs. */
export interface ViewTransitionCapability {
  startViewTransition?: unknown;
}

/** True when the document offers the View Transitions API. Never throws:
 * a hostile or partial document reads as "unsupported". */
export function supportsViewTransitions(doc: ViewTransitionCapability | null | undefined): boolean {
  try {
    return typeof doc?.startViewTransition === "function";
  } catch {
    return false;
  }
}

/** The smallest window surface the reduced-motion check needs. */
export interface ReducedMotionWindow {
  matchMedia?: unknown;
}

/** True when the user prefers reduced motion. A missing or throwing
 * `matchMedia` reads as "no preference", so the feature still runs. */
export function prefersReducedMotion(win: ReducedMotionWindow | null | undefined): boolean {
  try {
    if (typeof win?.matchMedia !== "function") return false;
    const query = (win.matchMedia as (q: string) => { matches?: unknown }).call(
      win,
      "(prefers-reduced-motion: reduce)",
    );
    return query?.matches === true;
  } catch {
    return false;
  }
}

function segments(path: string): string[] {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed.split("/").filter((segment) => segment.length > 0);
}

/**
 * Match a pathname against one route pattern. Pattern segments are
 * literals, `:param` (exactly one segment), or `*` (the rest of the path,
 * only meaningful as the last segment) — the same shapes farm route
 * patterns use. The whole pathname must match unless the pattern ends
 * with `*`.
 */
export function matchRoutePattern(pattern: string, pathname: string): boolean {
  const wanted = segments(pattern);
  const actual = segments(pathname);
  for (let i = 0; i < wanted.length; i++) {
    const part = wanted[i]!;
    if (part === "*") return true;
    if (i >= actual.length) return false;
    if (part.startsWith(":")) continue;
    if (part !== actual[i]) return false;
  }
  return wanted.length === actual.length;
}

/** True when any opt-out pattern matches the destination pathname. */
export function isRouteExcluded(patterns: readonly string[], pathname: string): boolean {
  return patterns.some((pattern) => matchRoutePattern(pattern, pathname));
}
