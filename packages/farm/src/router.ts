import {
  AmbiguousRouteError,
  compareRouteSpecificity,
  getRoutePatternShape,
  type RouteSegmentSpecificity,
} from "./routing/specificity";
import {
  matchSegmentParts,
  normalizePathname,
  normalizeRoutePattern,
  parseRoutePattern,
  splitNormalizedPathname,
  splitPathname,
  type RouterSegment,
} from "./routing/matcher";

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

interface NormalizedRouterRoute<TMeta> {
  route: FarmRouterRoute<TMeta>;
  segments: RouterSegment[];
  specificity: RouteSegmentSpecificity[];
  index: number;
}

export function createFarmRouter<TMeta = unknown>(
  routes: FarmRouterRouteInput<TMeta>[],
): FarmRouter<TMeta> {
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
        ? `/${entry.segments.map((segment) => encodePathSegment(segment.value)).join("/")}`
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

    const encodedValues = values.map((item) => {
      const value = String(item);
      if (!value) {
        throw new Error(
          `Route param "${segment.name}" for ${pattern} cannot contain an empty path segment.`,
        );
      }
      return encodePathSegment(value);
    });
    parts.push(...encodedValues);
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
  const segments = parseRoutePattern(pattern);
  const parts = splitNormalizedPathname(normalizedPathname);
  if (matchSegmentParts(segments, parts)) return true;
  if (options.exact !== false) return false;

  if (segments.length === 0) return normalizedPathname === "/";
  return matchSegmentParts(segments, parts, true) !== null;
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

function matchSegments(
  segments: RouterSegment[],
  pathname: string,
  allowTrailingSegments = false,
): FarmRouterParams | null {
  return matchSegmentParts(segments, splitPathname(pathname), allowTrailingSegments);
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
