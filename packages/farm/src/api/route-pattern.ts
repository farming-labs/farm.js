import { compareRouteSpecificity, type RouteSegmentSpecificity } from "../routing/specificity";

export type APIRouteParamValue = string | string[];
export type APIRouteParams = Record<string, APIRouteParamValue>;

export interface APIRouteMatch<T extends { path: string }> {
  route: T;
  params: APIRouteParams;
}

interface CompiledAPIRouteSegment {
  value?: string;
  dynamic?: { name: string; catchAll: boolean; optional: boolean };
}

interface CompiledAPIRouteEntry {
  path: string;
  segments: CompiledAPIRouteSegment[];
  specificity: RouteSegmentSpecificity[];
}

// Cache only route metadata, not table membership or winners. Live Map mutations,
// HMR replacement, and edits to route.path therefore remain visible immediately.
const compiledEntries = new WeakMap<object, CompiledAPIRouteEntry>();

interface IndexedAPIRoute<T extends { path: string }> {
  route: T;
  compiled: CompiledAPIRouteEntry;
  order: number;
}

interface APIRoutePrefix<T extends { path: string }> {
  children: Map<string, APIRoutePrefix<T>>;
  candidates: IndexedAPIRoute<T>[];
}

/**
 * @internal Snapshot matcher for the generated production route table only.
 * The public live-Map matcher below intentionally does not use this index.
 */
export function createStaticAPIRouteMatcher<T extends { path: string }>(routes: readonly T[]) {
  const table = new Map(routes.map((route) => [route.path, Object.freeze({ ...route })]));
  const root: APIRoutePrefix<T> = { children: new Map(), candidates: [] };
  let order = 0;
  for (const route of table.values()) {
    const compiled = compileRouteEntry(route.path);
    let node = root;
    // Only prune by a proven static prefix. Dynamic/catch-all tails still use
    // the authoritative matcher, including its existing specificity rules.
    for (const segment of compiled.segments) {
      if (segment.dynamic) break;
      let child = node.children.get(segment.value!);
      if (!child) {
        child = { children: new Map(), candidates: [] };
        node.children.set(segment.value!, child);
      }
      node = child;
    }
    node.candidates.push({ route, compiled, order: order++ });
  }

  return (pathname: string): APIRouteMatch<T> | null => {
    const exactRoute = table.get(pathname);
    if (exactRoute) return { route: exactRoute, params: {} };
    const normalizedPathname = normalizePathname(pathname);
    if (normalizedPathname !== pathname) {
      const normalizedRoute = table.get(normalizedPathname);
      if (normalizedRoute) return { route: normalizedRoute, params: {} };
    }
    const segments = getPathSegments(normalizedPathname).map(decodePathSegment);
    let best: IndexedAPIRoute<T> | undefined;
    let bestMatch: APIRouteMatch<T> | null = null;
    let node: APIRoutePrefix<T> | undefined = root;
    let depth = 0;
    while (node) {
      for (const candidate of node.candidates) {
        const params = matchRouteEntry(candidate.compiled, segments);
        if (!params) continue;
        const comparison = best
          ? compareRouteSpecificity(candidate.compiled.specificity, best.compiled.specificity)
          : -1;
        if (comparison < 0 || (comparison === 0 && candidate.order < best!.order)) {
          best = candidate;
          bestMatch = { route: candidate.route, params };
        }
      }
      node = depth < segments.length ? node.children.get(segments[depth++]!) : undefined;
    }
    return bestMatch;
  };
}

export function matchAPIRoute<T extends { path: string }>(
  routes: Map<string, T>,
  pathname: string,
): APIRouteMatch<T> | null {
  const exactRoute = routes.get(pathname);
  if (exactRoute) return { route: exactRoute, params: {} };

  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname !== pathname) {
    const normalizedRoute = routes.get(normalizedPathname);
    if (normalizedRoute) return { route: normalizedRoute, params: {} };
  }

  const pathnameSegments = getPathSegments(normalizedPathname).map(decodePathSegment);
  let bestMatch: APIRouteMatch<T> | null = null;
  let bestSpecificity: RouteSegmentSpecificity[] | null = null;
  for (const route of routes.values()) {
    const routePath = route.path;
    let entry = compiledEntries.get(route);
    if (!entry || entry.path !== routePath) {
      entry = compileRouteEntry(routePath);
      compiledEntries.set(route, entry);
    }
    const params = matchRouteEntry(entry, pathnameSegments);
    if (!params) continue;
    if (
      bestSpecificity === null ||
      compareRouteSpecificity(entry.specificity, bestSpecificity) < 0
    ) {
      bestMatch = { route, params };
      bestSpecificity = entry.specificity;
    }
  }
  return bestMatch;
}

function compileRouteEntry(path: string): CompiledAPIRouteEntry {
  const segments = getPathSegments(path).map((segment) => {
    const dynamic = parseDynamicSegment(segment);
    return dynamic ? { dynamic } : { value: decodePathSegment(segment) };
  });
  return {
    path,
    segments,
    specificity: segments.map((segment) => {
      const dynamic = segment.dynamic;
      if (!dynamic) return "static";
      if (!dynamic.catchAll) return "dynamic";
      return dynamic.optional ? "optional-catch-all" : "catch-all";
    }),
  };
}

function matchRouteEntry(
  entry: CompiledAPIRouteEntry,
  pathnameSegments: readonly string[],
): APIRouteParams | null {
  const params: APIRouteParams = {};
  let pathIndex = 0;

  for (const routeSegment of entry.segments) {
    const dynamicSegment = routeSegment.dynamic;

    if (dynamicSegment?.catchAll) {
      const remainingSegments = pathnameSegments.slice(pathIndex);
      if (remainingSegments.length === 0 && !dynamicSegment.optional) {
        return null;
      }
      if (remainingSegments.length > 0) {
        params[dynamicSegment.name] = remainingSegments;
      }
      pathIndex = pathnameSegments.length;
      continue;
    }

    const pathnameSegment = pathnameSegments[pathIndex];
    if (pathnameSegment === undefined) {
      return null;
    }

    if (dynamicSegment) {
      params[dynamicSegment.name] = pathnameSegment;
      pathIndex++;
      continue;
    }

    if (routeSegment.value !== pathnameSegment) {
      return null;
    }

    pathIndex++;
  }

  return pathIndex === pathnameSegments.length ? params : null;
}

function getPathSegments(pathname: string): string[] {
  return normalizePathname(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

export function parseDynamicSegment(
  segment: string,
): { name: string; catchAll: boolean; optional: boolean } | null {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll?.[1]) {
    return { name: optionalCatchAll[1], catchAll: true, optional: true };
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll?.[1]) {
    return { name: catchAll[1], catchAll: true, optional: false };
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic?.[1]) {
    return { name: dynamic[1], catchAll: false, optional: false };
  }

  return null;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
