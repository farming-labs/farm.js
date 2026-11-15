/** Route params and link resolution for native screens. Pure, so web tests cover them. */

export type FarmRouteParams = Record<string, string | string[]>;

export interface FarmRouteMatchOptions {
  /** The app's basePath ("" or "/base"). */
  basePath?: string;
  /** i18n locales whose prefix the client router strips before matching. */
  locales?: readonly string[];
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchSegments(route: string[], path: string[]): FarmRouteParams | null {
  const params: FarmRouteParams = {};
  for (let index = 0; index < route.length; index++) {
    const segment = route[index]!;
    const optionalRest = segment.startsWith("[[...") && segment.endsWith("]]");
    if (optionalRest || (segment.startsWith("[...") && segment.endsWith("]"))) {
      const rest = path.slice(index).map(decode);
      if (rest.length === 0 && !optionalRest) return null;
      params[segment.slice(optionalRest ? 5 : 4, optionalRest ? -2 : -1)] = rest;
      return params;
    }
    const value = path[index];
    if (value === undefined) return null;
    if (segment.startsWith("[") && segment.endsWith("]")) {
      params[segment.slice(1, -1)] = decode(value);
    } else if (decode(value) !== segment) {
      return null;
    }
  }
  return route.length === path.length ? params : null;
}

/**
 * The params of `pathname` for a page route such as `/notes/[id]`, after the base path and an
 * optional locale prefix. `null` when the path is not that route.
 */
export function matchFarmRoute(
  route: string,
  pathname: string,
  options: FarmRouteMatchOptions = {},
): FarmRouteParams | null {
  const basePath = options.basePath && options.basePath !== "/" ? options.basePath : "";
  let path = pathname;
  if (basePath) {
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return null;
    path = path.slice(basePath.length);
  }
  const routeSegments = route.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  const direct = matchSegments(routeSegments, pathSegments);
  if (direct) return direct;
  const first = pathSegments[0]?.toLowerCase();
  if (first && options.locales?.some((locale) => locale.toLowerCase() === first)) {
    return matchSegments(routeSegments, pathSegments.slice(1));
  }
  return null;
}

const ABSOLUTE = /^[a-z][a-z\d+.-]*:/i;

/**
 * An absolute URL for `href` as a browser resolves a link on the page at `base`: absolute URLs
 * stay, `/path` takes the page's origin, `?query` and `#hash` keep the path, and relative paths
 * resolve against the page's directory.
 */
export function resolveFarmHref(href: string, base: string): string {
  if (ABSOLUTE.test(href)) return href;
  const match = /^([a-z][a-z\d+.-]*:\/\/[^/?#]*)([^?#]*)(\?[^#]*)?/i.exec(base);
  if (!match) throw new TypeError(`Cannot resolve ${href} against ${base}.`);
  const [, origin, basePathname = "/", baseSearch = ""] = match;
  if (href.startsWith("//")) return `${origin.split("//")[0]}${href}`;
  if (href.startsWith("#")) return `${origin}${basePathname || "/"}${baseSearch}${href}`;
  if (href.startsWith("?")) return `${origin}${basePathname || "/"}${href}`;
  const suffixAt = href.search(/[?#]/);
  const hrefPath = suffixAt === -1 ? href : href.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? "" : href.slice(suffixAt);
  const segments = href.startsWith("/") ? [] : (basePathname || "/").split("/").slice(1, -1);
  for (const segment of hrefPath.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment !== "." && segment !== "") segments.push(segment);
  }
  const trailing = hrefPath.endsWith("/") && segments.length > 0 ? "/" : "";
  return `${origin}/${segments.join("/")}${trailing}${suffix}`;
}
