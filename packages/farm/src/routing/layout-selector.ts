import { farmLayoutScopeContains, getFarmLayoutPatternScope } from "./layout-scope";
import {
  matchSegmentParts,
  normalizePathname,
  parseRoutePattern,
  splitNormalizedPathname,
} from "./matcher";

/**
 * Internal: the production builder owns these immutable, depth-ordered descriptors. A route-group
 * layout (`"/(home)"`) applies only when `pageDirectory`, the matched page's folder, is inside its
 * group, as in Next.js; with no page (not-found, docs), it doesn't apply.
 */
export function createFarmLayoutSelector<T extends { pattern: string }>(layouts: readonly T[]) {
  const prepared = layouts.map((layout) => ({
    layout,
    scope: getFarmLayoutPatternScope(layout.pattern),
    segments: layout.pattern === "/" ? null : parseRoutePattern(layout.pattern),
  }));

  return (pathname: string, pageDirectory?: string): T[] => {
    const applicable: T[] = [];
    let parts: string[] | undefined;
    for (const { layout, scope, segments } of prepared) {
      if (scope !== undefined) {
        if (farmLayoutScopeContains(scope, pageDirectory)) applicable.push(layout);
        continue;
      }
      // Root-only apps retain their no-URL-parsing path. No request paths are cached.
      if (segments === null) {
        applicable.push(layout);
        continue;
      }
      parts ??= splitNormalizedPathname(normalizePathname(pathname.replace(/\/$/, "") || "/"));
      // Prefix matching includes exact matches.
      if (matchSegmentParts(segments, parts, true) !== null) applicable.push(layout);
    }
    return applicable;
  };
}
