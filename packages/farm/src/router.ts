export type FarmRouterPrimitiveParam = string | number | boolean;
export type FarmRouterPathParam =
  | FarmRouterPrimitiveParam
  | readonly FarmRouterPrimitiveParam[]
  | null
  | undefined;
export type FarmRouterPathParams = Record<string, FarmRouterPathParam>;
export type FarmRouterParams = Record<string, string>;

export interface FarmRouterRoute<TMeta = unknown> {
  path: string;
  name?: string;
  meta?: TMeta;
}

export type FarmRouterRouteInput<TMeta = unknown> = string | FarmRouterRoute<TMeta>;

export interface FarmRouterMatch<TMeta = unknown> {
  route: FarmRouterRoute<TMeta>;
  pathname: string;
  params: FarmRouterParams;
}

export type FarmRouterQueryValue =
  | FarmRouterPrimitiveParam
  | readonly FarmRouterPrimitiveParam[]
  | null
  | undefined;

export interface FarmRouterBuildOptions {
  query?: URLSearchParams | Record<string, FarmRouterQueryValue>;
  hash?: string;
  trailingSlash?: boolean;
}

export interface FarmRouterActiveOptions {
  exact?: boolean;
}

export interface FarmRouter<TMeta = unknown> {
  routes: FarmRouterRoute<TMeta>[];
  match(pathname: string): FarmRouterMatch<TMeta> | null;
  build(pattern: string, params?: FarmRouterPathParams, options?: FarmRouterBuildOptions): string;
  isActive(pattern: string, pathname: string, options?: FarmRouterActiveOptions): boolean;
}

type RouterSegment =
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

interface NormalizedRouterRoute<TMeta> {
  route: FarmRouterRoute<TMeta>;
  segments: RouterSegment[];
  score: number;
  index: number;
}

export function createFarmRouter<TMeta = unknown>(
  routes: FarmRouterRouteInput<TMeta>[],
): FarmRouter<TMeta> {
  const normalizedRoutes = routes.map(normalizeRouteInput).sort(compareRoutes);

  return {
    routes: normalizedRoutes.map((entry) => entry.route),
    match(pathname) {
      const normalizedPathname = normalizePathname(pathname);

      for (const entry of normalizedRoutes) {
        const params = matchSegments(entry.segments, normalizedPathname);
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
    build: buildFarmRoutePath,
    isActive: isFarmRouteActive,
  };
}

export function matchFarmRoute(pattern: string, pathname: string): FarmRouterParams | null {
  return matchSegments(parseRoutePattern(pattern), normalizePathname(pathname));
}

export function buildFarmRoutePath(
  pattern: string,
  params: FarmRouterPathParams = {},
  options: FarmRouterBuildOptions = {},
): string {
  const parts: string[] = [];

  for (const segment of parseRoutePattern(pattern)) {
    if (segment.type === "static") {
      parts.push(encodePathSegment(segment.value));
      continue;
    }

    const value = params[segment.name];
    const values = Array.isArray(value) ? value : value == null ? [] : [value];

    if (values.length === 0) {
      if (segment.optional) continue;
      throw new Error(`Missing route param "${segment.name}" for ${pattern}.`);
    }

    if (!segment.catchAll && values.length > 1) {
      throw new Error(`Route param "${segment.name}" for ${pattern} expects a single value.`);
    }

    parts.push(...values.map((item) => encodePathSegment(String(item))));
  }

  let pathname = parts.length ? `/${parts.join("/")}` : "/";

  if (options.trailingSlash && pathname !== "/") {
    pathname = `${pathname}/`;
  }

  return appendQueryAndHash(pathname, options);
}

export function isFarmRouteActive(
  pattern: string,
  pathname: string,
  options: FarmRouterActiveOptions = {},
): boolean {
  const normalizedPathname = normalizePathname(pathname);
  if (matchFarmRoute(pattern, normalizedPathname)) return true;
  if (options.exact !== false) return false;

  const normalizedPattern = normalizePathname(pattern);
  if (normalizedPattern === "/") return normalizedPathname === "/";
  return normalizedPathname.startsWith(`${normalizedPattern}/`);
}

function normalizeRouteInput<TMeta>(
  input: FarmRouterRouteInput<TMeta>,
  index: number,
): NormalizedRouterRoute<TMeta> {
  const route = typeof input === "string" ? { path: input } : input;
  const path = normalizePathname(route.path);
  const segments = parseRoutePattern(path);

  return {
    route: {
      ...route,
      path,
    },
    segments,
    score: scoreSegments(segments),
    index,
  };
}

function parseRoutePattern(pattern: string): RouterSegment[] {
  return splitPathname(pattern)
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

function matchSegments(segments: RouterSegment[], pathname: string): FarmRouterParams | null {
  const parts = splitPathname(pathname);
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

  return pathIndex === parts.length ? params : null;
}

function compareRoutes<TMeta>(
  left: NormalizedRouterRoute<TMeta>,
  right: NormalizedRouterRoute<TMeta>,
) {
  if (right.score !== left.score) return right.score - left.score;
  return left.index - right.index;
}

function scoreSegments(segments: RouterSegment[]) {
  return segments.reduce((score, segment) => {
    if (segment.type === "static") return score + 100;
    if (!segment.catchAll) return score + 50;
    return score + (segment.optional ? 5 : 10);
  }, segments.length);
}

function normalizePathname(value: string) {
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

function splitPathname(pathname: string) {
  return normalizePathname(pathname).split("/").filter(Boolean);
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

function encodePathSegment(value: string) {
  return encodeURIComponent(value);
}

function appendQueryAndHash(pathname: string, options: FarmRouterBuildOptions) {
  const search = createSearchParams(options.query);
  const hash = options.hash ? `#${options.hash.replace(/^#/, "")}` : "";
  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

function createSearchParams(query: FarmRouterBuildOptions["query"]) {
  if (query instanceof URLSearchParams) return query;

  const search = new URLSearchParams();
  if (!query) return search;

  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item == null) continue;
      search.append(key, String(item));
    }
  }

  return search;
}
