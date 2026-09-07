export type RouteSegmentSpecificity = "static" | "dynamic" | "catch-all" | "optional-catch-all";

export class AmbiguousRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousRouteError";
  }
}

export class NonTerminalCatchAllRouteError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "NonTerminalCatchAllRouteError";
  }
}

export class DuplicateRouteParameterError extends AmbiguousRouteError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateRouteParameterError";
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
const PAGE_PARAMETER_PATTERN = /^(?:\[\[\.\.\.(.+)\]\]|\[\.\.\.(.+)\]|\[(.+)\])$/;
const ROUTER_PARAMETER_PATTERN =
  /^(?:\[\[\.\.\.([A-Za-z0-9_$-]+)\]\]|\[\.\.\.([A-Za-z0-9_$-]+)\]|\[([A-Za-z0-9_$-]+)\]|:([A-Za-z0-9_$-]+)|\*([A-Za-z0-9_$-]+)\??)$/;

export function assertUniqueRouteParameters(
  pattern: string,
  syntax: RoutePatternSyntax = "page",
): void {
  const parameterPattern = syntax === "router" ? ROUTER_PARAMETER_PATTERN : PAGE_PARAMETER_PATTERN;
  const names = new Set<string>();

  for (const segment of splitRoutePattern(pattern, syntax)) {
    const match = parameterPattern.exec(segment);
    const name = match?.slice(1).find(Boolean);
    if (!name) continue;
    if (names.has(name)) {
      throw new DuplicateRouteParameterError(
        `Duplicate route parameter "${name}" in route "${pattern}". Each dynamic segment must use a unique name.`,
      );
    }
    names.add(name);
  }
}

function splitRoutePattern(pattern: string, syntax: RoutePatternSyntax): string[] {
  return pattern
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .filter((segment) =>
      syntax === "api" ? true : !(segment.startsWith("(") && segment.endsWith(")")),
    );
}

export function assertTerminalCatchAll(pattern: string, syntax: RoutePatternSyntax = "page"): void {
  const segments = splitRoutePattern(pattern, syntax);
  const parameterName = syntax === "router" ? ROUTER_PARAMETER_NAME : ".+";
  const catchAllPattern = new RegExp(
    syntax === "router"
      ? `^(?:\\[\\[\\.\\.\\.${parameterName}\\]\\]|\\[\\.\\.\\.${parameterName}\\]|\\*${parameterName}\\??)$`
      : `^(?:\\[\\[\\.\\.\\.${parameterName}\\]\\]|\\[\\.\\.\\.${parameterName}\\])$`,
  );
  const catchAllIndex = segments.findIndex((segment) => catchAllPattern.test(segment));
  if (catchAllIndex >= 0 && catchAllIndex !== segments.length - 1) {
    throw new NonTerminalCatchAllRouteError(
      `Catch-all segment "${segments[catchAllIndex]}" must be the final segment in route "${pattern}".`,
    );
  }
}

/** Return the URL-matching shape of a route without its parameter names. */
export function getRoutePatternShape(pattern: string, syntax: RoutePatternSyntax = "page"): string {
  assertTerminalCatchAll(pattern, syntax);
  const segments = splitRoutePattern(pattern, syntax).map((segment) => {
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
