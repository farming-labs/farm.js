import { isRouteSlotSegment, parseInterceptionMarker } from "../routing/route-slots";

/**
 * URL path a middleware file in `directoryName` guards. Route groups and
 * parallel route slots add no URL segment: `dashboard/@team/middleware.ts`
 * guards `/dashboard`, the URL the slot renders under. An intercepting folder
 * guards the URL it intercepts: `feed/@modal/(.)photo/middleware.ts` guards
 * `/feed/photo`, `(..)photo` one level above the slot's owner, `(...)photo` `/photo`.
 */
export function appendMiddlewareRoutePath(routePath: string, directoryName: string): string {
  const marker = parseInterceptionMarker(directoryName);
  if (marker) {
    const owner = routePath.split("/").filter(Boolean);
    const parts = [
      ...(marker.root ? [] : owner.slice(0, Math.max(0, owner.length - marker.up))),
      ...(marker.remainder ? [marker.remainder] : []),
    ];
    return `/${parts.join("/")}`;
  }

  if (
    (directoryName.startsWith("(") && directoryName.endsWith(")")) ||
    isRouteSlotSegment(directoryName)
  ) {
    return routePath;
  }

  return routePath === "/" ? `/${directoryName}` : `${routePath}/${directoryName}`;
}

/** A discovered middleware file: the URL path it guards and its folder relative to the app directory. */
export interface MiddlewareRouteLocation {
  path: string;
  /** `/`-separated folder relative to its app directory; `""` for the root. */
  directory: string;
}

export function appendMiddlewareDirectory(directory: string, directoryName: string): string {
  return directory === "" ? directoryName : `${directory}/${directoryName}`;
}

function countSegments(value: string): number {
  return value.split("/").filter(Boolean).length;
}

/**
 * Cascade order for file middleware, shared by dev and production discovery:
 * shallower URL paths first, then shallower folders, so the root middleware runs
 * before every route group's middleware that guards the same URL path.
 */
export function compareMiddlewareRouteLocations(
  left: MiddlewareRouteLocation,
  right: MiddlewareRouteLocation,
): number {
  return (
    countSegments(left.path) - countSegments(right.path) ||
    left.path.localeCompare(right.path) ||
    countSegments(left.directory) - countSegments(right.directory) ||
    left.directory.localeCompare(right.directory)
  );
}
