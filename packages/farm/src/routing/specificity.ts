export type RouteSegmentSpecificity = "static" | "dynamic" | "catch-all" | "optional-catch-all";

export class AmbiguousRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousRouteError";
  }
}

const SEGMENT_RANK: Record<RouteSegmentSpecificity, number> = {
  static: 4,
  dynamic: 3,
  "catch-all": 1,
  "optional-catch-all": 0,
};

// Ending a route is more specific than consuming the same path through a
// catch-all, while a following static or dynamic segment remains more specific.
const ROUTE_END_RANK = 2;

/** Sort route patterns from the most specific segment sequence to the least specific. */
export function compareRouteSpecificity(
  left: readonly RouteSegmentSpecificity[],
  right: readonly RouteSegmentSpecificity[],
): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const leftRank = index < left.length ? SEGMENT_RANK[left[index]!] : ROUTE_END_RANK;
    const rightRank = index < right.length ? SEGMENT_RANK[right[index]!] : ROUTE_END_RANK;
    if (leftRank !== rightRank) return rightRank - leftRank;
  }

  return 0;
}

export type RoutePatternSyntax = "page" | "router" | "api";

const ROUTER_PARAMETER_NAME = "[A-Za-z0-9_$-]+";

/** Return the URL-matching shape of a route without its parameter names. */
export function getRoutePatternShape(pattern: string, syntax: RoutePatternSyntax = "page"): string {
  const segments = pattern
    .split("/")
    .filter(Boolean)
    .filter((segment) => syntax === "api" || !/^\([^/]+\)$/.test(segment))
    .map((segment) => {
      const parameterName = syntax === "router" ? ROUTER_PARAMETER_NAME : ".+";
      const supportsColonAndStar = syntax === "router";
      if (
        new RegExp(`^\\[\\[\\.\\.\\.${parameterName}\\]\\]$`).test(segment) ||
        (supportsColonAndStar && new RegExp(`^\\*${parameterName}\\?$`).test(segment))
      ) {
        return "optional-catch-all";
      }
      if (
        new RegExp(`^\\[\\.\\.\\.${parameterName}\\]$`).test(segment) ||
        (supportsColonAndStar && new RegExp(`^\\*${parameterName}$`).test(segment))
      ) {
        return "catch-all";
      }
      if (
        new RegExp(`^\\[${parameterName}\\]$`).test(segment) ||
        (supportsColonAndStar && new RegExp(`^:${parameterName}$`).test(segment))
      ) {
        return "dynamic";
      }

      try {
        return `static:${decodeURIComponent(segment)}`;
      } catch {
        return `static:${segment}`;
      }
    });

  return segments.length === 0 ? "/" : JSON.stringify(segments);
}
