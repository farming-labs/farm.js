import {
  matchSegmentParts,
  normalizePathname,
  parseRoutePattern,
  splitNormalizedPathname,
} from "./matcher";
import { getRouteGroupScope, isInRouteGroupScope } from "./route-groups";

/**
 * Internal: the production builder owns these immutable, depth-ordered descriptors.
 *
 * A layout's pattern is its directory, so a route group stays in it (`/(auth)`).
 * The URL decides whether a layout covers a pathname; a layout inside a group also
 * needs the selected page to sit in that group. `resolveRouteDirectory` finds that
 * page's directory, and runs only when such a layout's URL matches.
 */
export function createFarmLayoutSelector<T extends { pattern: string }>(
  layouts: readonly T[],
  resolveRouteDirectory?: (pathname: string) => string | null | undefined,
) {
  const prepared = layouts.map((layout) => {
    // Group-only patterns have no URL segments and cover every pathname, like the root.
    const segments = layout.pattern === "/" ? [] : parseRoutePattern(layout.pattern);
    return {
      layout,
      segments: segments.length === 0 ? null : segments,
      groupScope: getRouteGroupScope(layout.pattern),
    };
  });

  /**
   * `routeDirectory` is the selected page's directory when the caller knows it, or
   * null when no page applies. Left undefined, it is resolved on demand.
   */
  return (pathname: string, routeDirectory?: string | null): T[] => {
    const applicable: T[] = [];
    let parts: string[] | undefined;
    let directory = routeDirectory;
    for (const { layout, segments, groupScope } of prepared) {
      // Root-only apps retain their no-URL-parsing path. No request paths are cached.
      if (segments !== null) {
        parts ??= splitNormalizedPathname(normalizePathname(pathname.replace(/\/$/, "") || "/"));
        // Prefix matching includes exact matches.
        if (matchSegmentParts(segments, parts, true) === null) continue;
      }
      if (groupScope !== null) {
        if (directory === undefined) directory = resolveRouteDirectory?.(pathname) ?? null;
        if (!isInRouteGroupScope(directory, groupScope)) continue;
      }
      applicable.push(layout);
    }
    return applicable;
  };
}
