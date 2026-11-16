/**
 * The routes whose `search.preserve` Farm links honor, on both sides of hydration. A link must
 * render the same href on the server and in the browser, so the server render and the page both
 * read this table: the development renderer and the production server set it before rendering,
 * and a production document carries it to the browser. Development documents carry the route
 * manifest instead, which the browser falls back to.
 */
export interface FarmSearchPreserveRoute {
  pattern: string;
  segments: ReadonlyArray<{
    segment: string;
    isDynamic: boolean;
    isCatchAll?: boolean;
    isOptional?: boolean;
  }>;
  search: { preserve: readonly string[] };
}

const SEARCH_PRESERVE_ROUTES_KEY = Symbol.for("farm.searchPreserveRoutes");

type GlobalWithSearchPreserveRoutes = typeof globalThis & {
  [SEARCH_PRESERVE_ROUTES_KEY]?: readonly FarmSearchPreserveRoute[];
};

/** @internal Set by the development renderer and the production server. */
export function _setFarmSearchPreserveRoutes(
  routes: readonly FarmSearchPreserveRoute[] | undefined,
): void {
  (globalThis as GlobalWithSearchPreserveRoutes)[SEARCH_PRESERVE_ROUTES_KEY] = routes;
}

/** Routes that may declare `search.preserve`; entries without it are ignored by the caller. */
export function getFarmSearchPreserveRoutes(): readonly unknown[] {
  const routes = (globalThis as GlobalWithSearchPreserveRoutes)[SEARCH_PRESERVE_ROUTES_KEY];
  if (Array.isArray(routes)) return routes;
  if (typeof window === "undefined") return [];
  const manifest = (window as { __FARM_MANIFEST__?: { routes?: unknown } }).__FARM_MANIFEST__;
  return manifest?.routes && typeof manifest.routes === "object"
    ? Object.values(manifest.routes)
    : [];
}
