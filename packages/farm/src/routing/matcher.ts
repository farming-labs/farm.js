// Shared by the public router and immutable production layout tables.
// Keep URL normalization, validation and decoding identical across both paths.
import type { FarmRouterParams } from "../router";
import {
  assertBrowserStableRouteCharacters,
  assertBrowserStableRouteSegment,
  assertTerminalCatchAllIndex,
  assertUniqueRouteParameter,
} from "./specificity";

export type RouterSegment =
  | {
      type: "static";
      value: string;
    }
  | {
      type: "dynamic";
      name: string;
      catchAll: boolean;
      optional: boolean;
    };

// `[[...name]]`, `[...name]`, `[name]`, `:name`, `*name` and `*name?`; anything else is static.
const ROUTER_PARAMETER_SEGMENT =
  /^(?:\[\[\.\.\.([A-Za-z0-9_$-]+)\]\]|\[\.\.\.([A-Za-z0-9_$-]+)\]|\[([A-Za-z0-9_$-]+)\]|:([A-Za-z0-9_$-]+)|\*([A-Za-z0-9_$-]+)(\?)?)$/;

// A normalized pattern of static segments made of unreserved URL characters (no `%`, group,
// parameter or `.`/`..` segment), such as most docs and content routes.
const PLAIN_STATIC_ROUTE_PATTERN = /^(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/;

/**
 * Parse a router pattern in one pass over its segments. It validates as
 * `assertBrowserStableRoutePath`, `assertTerminalCatchAll(pattern, "router")` and
 * `assertUniqueRouteParameters(pattern, "router")` do, in that order, with their errors.
 */
export function parseRoutePattern(pattern: string): RouterSegment[] {
  if (PLAIN_STATIC_ROUTE_PATTERN.test(pattern)) {
    // Every check below passes for these segments, and each decodes to itself.
    const parts = pattern.split("/");
    const segments: RouterSegment[] = [];
    for (let index = 1; index < parts.length; index++) {
      segments.push({ type: "static", value: parts[index]! });
    }
    return segments;
  }

  assertBrowserStableRouteCharacters(pattern);
  const parts = splitRoutePattern(pattern);
  const segments: RouterSegment[] = [];
  let catchAllIndex = -1;
  for (const part of parts) {
    assertBrowserStableRouteSegment(pattern, part);
    if (isRouteGroup(part)) continue;
    const segment = parseRouteSegment(part);
    if (catchAllIndex < 0 && segment.type === "dynamic" && segment.catchAll) {
      catchAllIndex = segments.length;
    }
    segments.push(segment);
  }

  if (catchAllIndex >= 0) {
    assertTerminalCatchAllIndex(
      pattern,
      parts.filter((part) => !isRouteGroup(part)),
      catchAllIndex,
    );
  }
  let names: Set<string> | undefined;
  for (const segment of segments) {
    if (segment.type === "dynamic") {
      assertUniqueRouteParameter(pattern, segment.name, (names ??= new Set()));
    }
  }
  return segments;
}

function parseRouteSegment(part: string): RouterSegment {
  const parameter = ROUTER_PARAMETER_SEGMENT.exec(part);
  if (!parameter) return { type: "static", value: decodePathSegment(part) };
  if (parameter[1]) return { type: "dynamic", name: parameter[1], catchAll: true, optional: true };
  if (parameter[2]) return { type: "dynamic", name: parameter[2], catchAll: true, optional: false };
  if (parameter[5]) {
    return { type: "dynamic", name: parameter[5], catchAll: true, optional: !!parameter[6] };
  }
  return {
    type: "dynamic",
    name: (parameter[3] || parameter[4])!,
    catchAll: false,
    optional: false,
  };
}

/**
 * Match parsed segments against a path's decoded segments (`splitDecodedPathname`). A path is
 * decoded once and then compared with every candidate route, instead of once per candidate.
 */
export function matchDecodedParts(
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
      if (parts[pathIndex] !== segment.value) return null;
      pathIndex++;
      continue;
    }

    if (segment.catchAll) {
      const remaining = parts.slice(pathIndex);
      if (remaining.length === 0 && !segment.optional) return null;
      params[segment.name] = remaining.join("/");
      pathIndex = parts.length;
      continue;
    }

    // A decoded segment is empty only when there is none: a non-empty escape decodes to text.
    const value = parts[pathIndex];
    if (!value) return null;
    params[segment.name] = value;
    pathIndex++;
  }

  return allowTrailingSegments || pathIndex === parts.length ? params : null;
}

export function normalizePathname(value: string) {
  const raw = value || "/";
  let pathname = raw;

  try {
    pathname = new URL(raw, "http://farm.local").pathname;
  } catch {
    pathname = raw.split(/[?#]/, 1)[0] || "/";
  }

  pathname = pathname.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}

/** The decoded segments of a normalized pathname, which `matchDecodedParts` reads. */
export function splitDecodedPathname(pathname: string) {
  return pathname.split("/").filter(Boolean).map(decodePathSegment);
}

export function normalizeRoutePattern(value: string) {
  // Most patterns are already normal: rooted, no repeated or trailing slash, no backslash.
  if (
    value &&
    value.charCodeAt(0) === 47 &&
    (value.length === 1 || value.charCodeAt(value.length - 1) !== 47) &&
    !value.includes("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
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

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
