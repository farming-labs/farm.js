import {
  matchSegmentParts,
  normalizePathname,
  parseRoutePattern,
  splitNormalizedPathname,
} from "./matcher";

/** Internal: the production builder owns these immutable, depth-ordered descriptors. */
export function createFarmLayoutSelector<T extends { pattern: string }>(layouts: readonly T[]) {
  const prepared = layouts.map((layout) => ({
    layout,
    segments: layout.pattern === "/" ? null : parseRoutePattern(layout.pattern),
  }));

  return (pathname: string): T[] => {
    const applicable: T[] = [];
    let parts: string[] | undefined;
    for (const { layout, segments } of prepared) {
      // Root-only apps retain their no-URL-parsing path. No request paths are cached.
      if (segments === null) {
        applicable.push(layout);
        continue;
      }
      parts ??= splitNormalizedPathname(normalizePathname(pathname.replace(/\/$/, "") || "/"));
      // Prefix matching includes exact matches. Empty (group-only) patterns still
      // match only the root, as they do in isFarmRouteActive.
      if (matchSegmentParts(segments, parts, true) !== null) applicable.push(layout);
    }
    return applicable;
  };
}
