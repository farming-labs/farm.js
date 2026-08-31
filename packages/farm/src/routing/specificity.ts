export type RouteSegmentSpecificity = "static" | "dynamic" | "catch-all" | "optional-catch-all";

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
