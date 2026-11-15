/**
 * Server side of page shells (`mobile.shells`, RFC 0004 7.2). `farm build --mobile` builds its
 * server with a random token and asks it for each page route's shell: the route's layouts around
 * its `loading.tsx`, rendered with no params, data, or page metadata. Only that build's server has
 * the mode, and it answers only requests that carry the token, so a deployed server never renders
 * shells. Loaded by the generated server entry only when the build has a token.
 */

/** Carries the build's token. Without the right one, the request renders as usual. */
export const FARM_SHELL_RENDER_HEADER = "X-Farm-Shell-Render";
/** The page route the build asks a shell for, such as `/notes/[id]`, route groups removed. */
export const FARM_SHELL_ROUTE_HEADER = "X-Farm-Shell-Route";
/**
 * The URL segment that stands in for each dynamic segment of a route, so the request matches it.
 * Shells render with no params, so the value never reaches a layout or the loading file.
 */
export const FARM_SHELL_PARAM_SEGMENT = "__farm_shell__";

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** True when `request` carries this build's shell token. An empty token never matches. */
export function _isFarmMobileShellRenderRequest(request: Request, token: string): boolean {
  const value = request.headers.get(FARM_SHELL_RENDER_HEADER);
  return token.length > 0 && value !== null && constantTimeEqual(value, token);
}

function stripRouteGroups(pattern: string): string {
  const segments = pattern
    .split("/")
    .filter((segment) => segment && !(segment.startsWith("(") && segment.endsWith(")")));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function isDynamicPattern(pattern: string): boolean {
  return pattern.split("/").some((segment) => segment.startsWith("["));
}

export interface FarmMobileShellRouteCheck {
  /** The route the build asked for (`X-Farm-Shell-Route`). */
  requested: string | null;
  /** The page route the request matched. */
  route: string;
  /** Patterns of the layouts that wrap the page, root first. */
  layouts: readonly string[];
  /** Pattern of the page's nearest `loading` file, or null when it has none. */
  loading: string | null;
}

/**
 * Why a route has no shell, or null when it has one. A shell is the same HTML for every URL of
 * the route, so the loading file and every layout around the page must sit in static folders:
 * nothing in it may depend on a param.
 */
export function _checkFarmMobileShellRoute(check: FarmMobileShellRouteCheck): string | null {
  const route = stripRouteGroups(check.route);
  if (check.requested === null || stripRouteGroups(check.requested) !== route) {
    return `the request matched ${route}, not ${check.requested ?? "a requested route"}`;
  }
  if (check.loading === null) return "it has no loading file";
  if (isDynamicPattern(check.loading)) {
    return `its loading file is in a dynamic folder (${stripRouteGroups(check.loading)})`;
  }
  const layout = check.layouts.find(isDynamicPattern);
  if (layout !== undefined) {
    return `a layout is in a dynamic folder (${stripRouteGroups(layout)})`;
  }
  return null;
}

/**
 * The URL path the build requests a route's shell at: each dynamic segment becomes
 * {@link FARM_SHELL_PARAM_SEGMENT}, an optional catch-all is dropped. Route groups are removed.
 */
export function createFarmMobileShellRenderPath(route: string): string {
  const segments: string[] = [];
  for (const segment of route.split("/")) {
    if (!segment || (segment.startsWith("(") && segment.endsWith(")"))) continue;
    if (segment.startsWith("[[...") && segment.endsWith("]]")) continue;
    segments.push(segment.startsWith("[") ? FARM_SHELL_PARAM_SEGMENT : segment);
  }
  return `/${segments.join("/")}`;
}
