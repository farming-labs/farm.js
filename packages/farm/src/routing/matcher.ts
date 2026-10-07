// Shared by the public router and immutable production layout tables.
// Keep URL normalization, validation and decoding identical across both paths.
import type { FarmRouterParams } from "../router";
import {
  assertBrowserStableRoutePath,
  assertTerminalCatchAll,
  assertUniqueRouteParameters,
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
    });
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

export function splitPathname(pathname: string) {
  return splitNormalizedPathname(normalizePathname(pathname));
}

export function splitNormalizedPathname(pathname: string) {
  return pathname.split("/").filter(Boolean);
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

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
