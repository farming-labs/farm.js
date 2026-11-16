// The router's pattern parsing, validation, ordering, construction and matching as they were
// before the router compiled patterns in one pass and decoded a path once per match (main at
// 99c308a7c), kept verbatim as the oracle for router-parity.test.ts. `normalizePathname` did not
// change and is imported. Do not "fix" this file: it pins the behavior the router must keep.
import {
  AmbiguousRouteError,
  BrowserUnstableRouteError,
  DuplicateRouteParameterError,
  NonTerminalCatchAllRouteError,
  ReservedRouteParameterError,
  type RoutePatternSyntax,
  type RouteSegmentSpecificity,
} from "../../routing/specificity";
import { normalizePathname, type RouterSegment } from "../../routing/matcher";
import type {
  FarmRouterMatch,
  FarmRouterParams,
  FarmRouterRoute,
  FarmRouterRouteInput,
} from "../../router";

// --- routing/specificity.ts ---

const SEGMENT_RANK: Record<RouteSegmentSpecificity, number> = {
  static: 4,
  dynamic: 3,
  "catch-all": 1,
  "optional-catch-all": 0,
};

const ROUTE_END_RANK = 2;

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

const ROUTER_PARAMETER_NAME = "[A-Za-z0-9_$-]+";
const PAGE_PARAMETER_PATTERN = /^(?:\[\[\.\.\.(.+)\]\]|\[\.\.\.(.+)\]|\[(.+)\])$/;
const ROUTER_PARAMETER_PATTERN =
  /^(?:\[\[\.\.\.([A-Za-z0-9_$-]+)\]\]|\[\.\.\.([A-Za-z0-9_$-]+)\]|\[([A-Za-z0-9_$-]+)\]|:([A-Za-z0-9_$-]+)|\*([A-Za-z0-9_$-]+)\??)$/;
const RESERVED_PARAMETER_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export function assertBrowserStableRoutePath(pattern: string): void {
  if (pattern.includes("\\") || hasControlCharacter(pattern)) {
    throw new BrowserUnstableRouteError(
      `Route path "${pattern}" cannot contain backslashes or control characters.`,
    );
  }

  for (const segment of pattern.split("/").filter(Boolean)) {
    if (
      (segment.startsWith("(") && segment.endsWith(")")) ||
      (segment.startsWith("[") && segment.endsWith("]"))
    ) {
      continue;
    }

    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escapes stay literal in browser pathnames.
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
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export function assertUniqueRouteParameters(
  pattern: string,
  syntax: RoutePatternSyntax = "page",
): void {
  const parameterPattern = syntax === "router" ? ROUTER_PARAMETER_PATTERN : PAGE_PARAMETER_PATTERN;
  const names = new Set<string>();

  for (const segment of splitSpecificityPattern(pattern, syntax)) {
    const match = parameterPattern.exec(segment);
    const name = match?.slice(1).find(Boolean);
    if (!name) continue;
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
}

function splitSpecificityPattern(pattern: string, syntax: RoutePatternSyntax): string[] {
  return pattern
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .filter((segment) =>
      syntax === "api" ? true : !(segment.startsWith("(") && segment.endsWith(")")),
    );
}

export function assertTerminalCatchAll(pattern: string, syntax: RoutePatternSyntax = "page"): void {
  const segments = splitSpecificityPattern(pattern, syntax);
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

export function getRoutePatternShape(pattern: string, syntax: RoutePatternSyntax = "page"): string {
  assertTerminalCatchAll(pattern, syntax);
  const segments = splitSpecificityPattern(pattern, syntax).map((segment) => {
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

export function getRoutePatternSpecificity(
  pattern: string,
  syntax: RoutePatternSyntax = "page",
): RouteSegmentSpecificity[] {
  assertTerminalCatchAll(pattern, syntax);
  return splitSpecificityPattern(pattern, syntax).map((segment) =>
    getPatternSegmentSpecificity(segment, syntax),
  );
}

function getPatternSegmentSpecificity(
  segment: string,
  syntax: RoutePatternSyntax,
): RouteSegmentSpecificity {
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

  return "static";
}

// --- routing/matcher.ts ---

export function parseRoutePattern(pattern: string): RouterSegment[] {
  assertBrowserStableRoutePath(pattern);
  assertTerminalCatchAll(pattern, "router");
  assertUniqueRouteParameters(pattern, "router");
  return splitRoutePattern(pattern)
    .filter((part) => !isRouteGroup(part))
    .map((part) => {
      const optionalCatchAll = part.match(/^\[\[\.\.\.([A-Za-z0-9_$-]+)\]\]$/);
      if (optionalCatchAll) {
        return {
          type: "dynamic",
          name: optionalCatchAll[1],
          catchAll: true,
          optional: true,
        };
      }

      const catchAll = part.match(/^\[\.\.\.([A-Za-z0-9_$-]+)\]$/);
      if (catchAll) {
        return {
          type: "dynamic",
          name: catchAll[1],
          catchAll: true,
          optional: false,
        };
      }

      const dynamic = part.match(/^\[([A-Za-z0-9_$-]+)\]$/) || part.match(/^:([A-Za-z0-9_$-]+)$/);
      if (dynamic) {
        return {
          type: "dynamic",
          name: dynamic[1],
          catchAll: false,
          optional: false,
        };
      }

      const star = part.match(/^\*([A-Za-z0-9_$-]+)(\?)?$/);
      if (star) {
        return {
          type: "dynamic",
          name: star[1],
          catchAll: true,
          optional: !!star[2],
        };
      }

      return {
        type: "static",
        value: decodePathSegment(part),
      };
    }) as RouterSegment[];
}

export function normalizeRoutePattern(value: string) {
  let pathname = (value || "/").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

function splitRoutePattern(pattern: string) {
  return normalizeRoutePattern(pattern).split("/").filter(Boolean);
}

function isRouteGroup(part: string) {
  return part.startsWith("(") && part.endsWith(")");
}

export function matchSegmentParts(
  segments: RouterSegment[],
  parts: string[],
  allowTrailingSegments = false,
): FarmRouterParams | null {
  const params: FarmRouterParams = {};

  if (segments.length === 0) {
    return parts.length === 0 ? params : null;
  }

  let pathIndex = 0;

  for (const segment of segments) {
    if (segment.type === "static") {
      if (decodePathSegment(parts[pathIndex] || "") !== segment.value) return null;
      pathIndex++;
      continue;
    }

    if (segment.catchAll) {
      const remaining = parts.slice(pathIndex).map(decodePathSegment);
      if (remaining.length === 0 && !segment.optional) return null;
      params[segment.name] = remaining.join("/");
      pathIndex = parts.length;
      continue;
    }

    const value = parts[pathIndex];
    if (!value) return null;
    params[segment.name] = decodePathSegment(value);
    pathIndex++;
  }

  return allowTrailingSegments || pathIndex === parts.length ? params : null;
}

export function splitNormalizedPathname(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

/** `matchFarmRoute` and `isFarmRouteActive` as they were. */
export function matchFarmRoute(pattern: string, pathname: string): FarmRouterParams | null {
  return matchSegmentParts(
    parseRoutePattern(pattern),
    splitNormalizedPathname(normalizePathname(normalizePathname(pathname))),
  );
}

export function isFarmRouteActive(
  pattern: string,
  pathname: string,
  options: { exact?: boolean } = {},
): boolean {
  const normalizedPathname = normalizePathname(pathname);
  const segments = parseRoutePattern(pattern);
  const parts = splitNormalizedPathname(normalizedPathname);
  if (matchSegmentParts(segments, parts)) return true;
  if (options.exact !== false) return false;

  if (segments.length === 0) return normalizedPathname === "/";
  return matchSegmentParts(segments, parts, true) !== null;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// --- router.ts ---

interface NormalizedRouterRoute<TMeta> {
  route: FarmRouterRoute<TMeta>;
  segments: RouterSegment[];
  specificity: RouteSegmentSpecificity[];
  index: number;
}

export interface ReferenceRouter<TMeta = unknown> {
  routes: FarmRouterRoute<TMeta>[];
  match(pathname: string): FarmRouterMatch<TMeta> | null;
}

export function createReferenceRouter<TMeta = unknown>(
  routes: FarmRouterRouteInput<TMeta>[],
): ReferenceRouter<TMeta> {
  const normalizedRoutes = routes.map(normalizeRouteInput);
  const patternsByShape = new Map<string, string>();
  for (const entry of normalizedRoutes) {
    const shape = getRoutePatternShape(entry.route.path, "router");
    const existingPattern = patternsByShape.get(shape);
    if (existingPattern) {
      throw new AmbiguousRouteError(
        `Ambiguous route patterns "${existingPattern}" and "${entry.route.path}" match the same URLs. Keep only one route for this URL shape.`,
      );
    }
    patternsByShape.set(shape, entry.route.path);
  }
  normalizedRoutes.sort(compareRoutes);
  const exactRoutes = new Map<string, NormalizedRouterRoute<TMeta>>();
  for (const entry of normalizedRoutes) {
    if (entry.segments.every((segment) => segment.type === "static")) {
      const pathname = entry.segments.length
        ? `/${entry.segments.map((segment) => encodeURIComponent(segment.value)).join("/")}`
        : "/";
      exactRoutes.set(pathname, entry);
    }
  }

  return {
    routes: normalizedRoutes.map((entry) => entry.route),
    match(pathname) {
      const normalizedPathname = normalizePathname(pathname);
      const exactRoute = exactRoutes.get(normalizedPathname);
      if (exactRoute) {
        return {
          route: exactRoute.route,
          pathname: normalizedPathname,
          params: {},
        };
      }

      const parts = splitNormalizedPathname(normalizedPathname);

      for (const entry of normalizedRoutes) {
        const params = matchSegmentParts(entry.segments, parts);
        if (params) {
          return {
            route: entry.route,
            pathname: normalizedPathname,
            params,
          };
        }
      }

      return null;
    },
  };
}

function normalizeRouteInput<TMeta>(
  input: FarmRouterRouteInput<TMeta>,
  index: number,
): NormalizedRouterRoute<TMeta> {
  const route = typeof input === "string" ? { path: input } : input;
  const segments = parseRoutePattern(route.path);
  const path = normalizeRoutePattern(route.path);

  return {
    route: {
      ...route,
      path,
    },
    segments,
    specificity: segments.map(getRouterSegmentSpecificity),
    index,
  };
}

function compareRoutes<TMeta>(
  left: NormalizedRouterRoute<TMeta>,
  right: NormalizedRouterRoute<TMeta>,
) {
  const specificity = compareRouteSpecificity(left.specificity, right.specificity);
  if (specificity !== 0) return specificity;
  return left.index - right.index;
}

function getRouterSegmentSpecificity(segment: RouterSegment): RouteSegmentSpecificity {
  if (segment.type === "static") return "static";
  if (!segment.catchAll) return "dynamic";
  return segment.optional ? "optional-catch-all" : "catch-all";
}
