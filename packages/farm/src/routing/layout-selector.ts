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

/**
 * Internal: whether two layout directory patterns can both cover one page, so a
 * client tree that renders one of them also renders the other. A dynamic segment
 * matches any segment and a catch-all matches the rest, like URL matching does.
 */
export function layoutsCanCoverSamePage(a: string, b: string): boolean {
  const scopeA = getRouteGroupScope(a);
  const scopeB = getRouteGroupScope(b);
  if (
    scopeA !== null &&
    scopeB !== null &&
    !isInRouteGroupScope(scopeA, scopeB) &&
    !isInRouteGroupScope(scopeB, scopeA)
  ) {
    return false;
  }
  const segmentsA = a === "/" ? [] : parseRoutePattern(a);
  const segmentsB = b === "/" ? [] : parseRoutePattern(b);
  const length = Math.min(segmentsA.length, segmentsB.length);
  for (let index = 0; index < length; index++) {
    const segmentA = segmentsA[index]!;
    const segmentB = segmentsB[index]!;
    if (segmentA.type === "dynamic" && segmentA.catchAll) return true;
    if (segmentB.type === "dynamic" && segmentB.catchAll) return true;
    if (segmentA.type === "dynamic" || segmentB.type === "dynamic") continue;
    if (segmentA.value !== segmentB.value) return false;
  }
  return true;
}

/**
 * Internal, islands mode: the layouts the browser rebuilds from their server trees instead of
 * importing their modules. A server layout that hydrates as one root renders as a tree, and so
 * does every other server layout on the same pages, since that root renders the page's whole
 * layout chain. A `"use client"` layout keeps its module.
 */
export function getFarmServerTreeLayoutPatterns(
  layouts: ReadonlyArray<{ pattern: string; shouldHydrate: boolean; serverTreeLayout?: true }>,
): Set<string> {
  const hydrating = layouts
    .filter((layout) => layout.shouldHydrate)
    .map((layout) => layout.pattern);
  const patterns = new Set<string>();
  for (const layout of layouts) {
    if (
      layout.serverTreeLayout ||
      (!layout.shouldHydrate &&
        hydrating.some((pattern) => layoutsCanCoverSamePage(layout.pattern, pattern)))
    ) {
      patterns.add(layout.pattern);
    }
  }
  return patterns;
}
