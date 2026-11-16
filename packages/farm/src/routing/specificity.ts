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

export class ReservedRouteParameterError extends AmbiguousRouteError {
  constructor(message: string) {
    super(message);
    this.name = "ReservedRouteParameterError";
  }
}

export class BrowserUnstableRouteError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnstableRouteError";
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

// A rank as one character, higher ranks first: "a" (static) to "e" (optional catch-all).
const rankKey = (rank: number) => String.fromCharCode(101 - rank);
const SEGMENT_KEY = Object.fromEntries(
  Object.entries(SEGMENT_RANK).map(([specificity, rank]) => [specificity, rankKey(rank)]),
) as Record<RouteSegmentSpecificity, string>;
const ROUTE_END_KEY = rankKey(ROUTE_END_RANK);

/**
 * `compareRouteSpecificity` as a string: the key of the more specific sequence sorts first, and
 * equal keys compare equal. A router sorting many routes compares keys natively instead.
 */
export function getRouteSpecificityKey(specificity: readonly RouteSegmentSpecificity[]): string {
  let key = "";
  for (const segment of specificity) key += SEGMENT_KEY[segment];
  return key + ROUTE_END_KEY;
}

/**
 * Order two route patterns from most to least specific.
 *
 * This is the single ordering contract for file routes. The development route
 * manager, the generated client matcher, and the production route table must
 * all use it: a build whose server ordering disagrees with its client ordering
 * renders one page on first load and a different one after a client navigation.
 */
export function compareRoutePatternSpecificity(
  left: string,
  right: string,
  syntax: RoutePatternSyntax = "page",
): number {
  return compareRouteSpecificity(
    getRoutePatternSpecificity(left, syntax),
    getRoutePatternSpecificity(right, syntax),
  );
}

export type RoutePatternSyntax = "page" | "router" | "api";

const PAGE_PARAMETER_PATTERN = /^(?:\[\[\.\.\.(.+)\]\]|\[\.\.\.(.+)\]|\[(.+)\])$/;
const ROUTER_PARAMETER_PATTERN =
  /^(?:\[\[\.\.\.([A-Za-z0-9_$-]+)\]\]|\[\.\.\.([A-Za-z0-9_$-]+)\]|\[([A-Za-z0-9_$-]+)\]|:([A-Za-z0-9_$-]+)|\*([A-Za-z0-9_$-]+)\??)$/;
const RESERVED_PARAMETER_NAMES = new Set(["__proto__", "constructor", "prototype"]);

// Compiled once: building a RegExp per segment was most of the cost of creating a router.
// Page and API names are any text (`.+`); the router also takes `:name`, `*name` and `*name?`.
interface SegmentPatterns {
  optionalCatchAll: RegExp;
  catchAll: RegExp;
  dynamic: RegExp;
  terminalCatchAll: RegExp;
}

const PAGE_SEGMENT_PATTERNS: SegmentPatterns = {
  optionalCatchAll: /^\[\[\.\.\..+\]\]$/,
  catchAll: /^\[\.\.\..+\]$/,
  dynamic: /^\[.+\]$/,
  terminalCatchAll: /^(?:\[\[\.\.\..+\]\]|\[\.\.\..+\])$/,
};

const ROUTER_SEGMENT_PATTERNS: SegmentPatterns = {
  optionalCatchAll: /^(?:\[\[\.\.\.[A-Za-z0-9_$-]+\]\]|\*[A-Za-z0-9_$-]+\?)$/,
  catchAll: /^(?:\[\.\.\.[A-Za-z0-9_$-]+\]|\*[A-Za-z0-9_$-]+)$/,
  dynamic: /^(?:\[[A-Za-z0-9_$-]+\]|:[A-Za-z0-9_$-]+)$/,
  terminalCatchAll:
    /^(?:\[\[\.\.\.[A-Za-z0-9_$-]+\]\]|\[\.\.\.[A-Za-z0-9_$-]+\]|\*[A-Za-z0-9_$-]+\??)$/,
};

function getSegmentPatterns(syntax: RoutePatternSyntax): SegmentPatterns {
  return syntax === "router" ? ROUTER_SEGMENT_PATTERNS : PAGE_SEGMENT_PATTERNS;
}

export function assertBrowserStableRoutePath(pattern: string): void {
  assertBrowserStableRouteCharacters(pattern);
  for (const segment of pattern.split("/").filter(Boolean)) {
    assertBrowserStableRouteSegment(pattern, segment);
  }
}

/** The whole-path half of `assertBrowserStableRoutePath`, which comes before its segments. */
export function assertBrowserStableRouteCharacters(pattern: string): void {
  if (pattern.includes("\\") || hasControlCharacter(pattern)) {
    throw new BrowserUnstableRouteError(
      `Route path "${pattern}" cannot contain backslashes or control characters.`,
    );
  }
}

/** One segment of `assertBrowserStableRoutePath`, for a path that passed its characters check. */
export function assertBrowserStableRouteSegment(pattern: string, segment: string): void {
  if (
    (segment.startsWith("(") && segment.endsWith(")")) ||
    (segment.startsWith("[") && segment.endsWith("]"))
  ) {
    return;
  }

  let decoded = segment;
  if (segment.includes("%")) {
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escapes stay literal in browser pathnames.
    }
  }
  if (
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    hasControlCharacter(decoded)
  ) {
    throw new BrowserUnstableRouteError(
      `Route path "${pattern}" contains browser-unstable segment "${segment}".`,
    );
  }
}

function hasControlCharacter(value: string): boolean {
  // C0 and C1 controls are single UTF-16 code units; surrogates never fall in either range.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

export function assertUniqueRouteParameters(
  pattern: string,
  syntax: RoutePatternSyntax = "page",
): void {
  const parameterPattern = syntax === "router" ? ROUTER_PARAMETER_PATTERN : PAGE_PARAMETER_PATTERN;
  const names = new Set<string>();

  for (const segment of splitRoutePattern(pattern, syntax)) {
    const match = parameterPattern.exec(segment);
    const name = match?.slice(1).find(Boolean);
    if (name) assertUniqueRouteParameter(pattern, name, names);
  }
}

/** Add one parameter name of `pattern` to `names`, rejecting reserved and repeated names. */
export function assertUniqueRouteParameter(
  pattern: string,
  name: string,
  names: Set<string>,
): void {
  if (RESERVED_PARAMETER_NAMES.has(name)) {
    throw new ReservedRouteParameterError(
      `Route parameter "${name}" in route "${pattern}" is reserved. Use a different parameter name.`,
    );
  }
  if (names.has(name)) {
    throw new DuplicateRouteParameterError(
      `Duplicate route parameter "${name}" in route "${pattern}". Each dynamic segment must use a unique name.`,
    );
  }
  names.add(name);
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
  const catchAllPattern = getSegmentPatterns(syntax).terminalCatchAll;
  const catchAllIndex = segments.findIndex((segment) => catchAllPattern.test(segment));
  assertTerminalCatchAllIndex(pattern, segments, catchAllIndex);
}

/** Reject `pattern` unless its first catch-all segment, at `catchAllIndex` (-1: none), is its last. */
export function assertTerminalCatchAllIndex(
  pattern: string,
  segments: readonly string[],
  catchAllIndex: number,
): void {
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
    const specificity = getPatternSegmentSpecificity(segment, syntax);
    if (specificity !== "static") return specificity;

    try {
      return `static:${decodeURIComponent(segment)}`;
    } catch {
      return `static:${segment}`;
    }
  });

  return segments.length === 0 ? "/" : JSON.stringify(segments);
}

/** Return the specificity of every URL-consuming segment in a route pattern. */
export function getRoutePatternSpecificity(
  pattern: string,
  syntax: RoutePatternSyntax = "page",
): RouteSegmentSpecificity[] {
  assertTerminalCatchAll(pattern, syntax);
  return splitRoutePattern(pattern, syntax).map((segment) =>
    getPatternSegmentSpecificity(segment, syntax),
  );
}

function getPatternSegmentSpecificity(
  segment: string,
  syntax: RoutePatternSyntax,
): RouteSegmentSpecificity {
  const patterns = getSegmentPatterns(syntax);
  if (patterns.optionalCatchAll.test(segment)) return "optional-catch-all";
  if (patterns.catchAll.test(segment)) return "catch-all";
  if (patterns.dynamic.test(segment)) return "dynamic";
  return "static";
}
