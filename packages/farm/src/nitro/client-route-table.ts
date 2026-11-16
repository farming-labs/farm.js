import fs from "node:fs/promises";
import path from "node:path";
import type { FarmIslandStrategy } from "../island";
import {
  getRoutePatternShape,
  getRoutePatternSpecificity,
  type RouteSegmentSpecificity,
} from "../routing/specificity";

/**
 * The production client's route table: the routes whose page, layouts or islands run in the
 * browser, in the order the client matches them.
 *
 * It used to sit in the client entry, which every page loads before it hydrates: about 147 bytes
 * a route (414 KB of entry at 1,000 routes, 282 KB at 100). The entry now imports it as its own
 * chunk on the first navigation or prefetch, and each document names the entries its page boots
 * with (`window.__FARM_CLIENT_ROUTES__`), which the server finds with the same matcher.
 */
export interface FarmClientRouteTableEntry {
  pattern: string;
  /**
   * The page's directory with its route groups, when it differs from the pattern. On a docs
   * route, the directory of the app page whose place it took (resolveFarmDocsClientRoutes).
   */
  directory?: string;
  pageShouldHydrate: boolean;
  /** A docs route without a page module, which matches before the app's pages. */
  docs?: true;
  hasIsolatedClientBoundaries?: true;
  islandStrategy: FarmIslandStrategy;
  /**
   * A page that hydrates: its module's loader in the client entry, which keeps one per such page
   * in table order, since only the bundler can name the chunk.
   */
  loader?: number;
}

/** The module the client entry imports the table from, next to the entry. */
export const FARM_CLIENT_ROUTE_TABLE_MODULE = "farm-client-routes";

/** Written next to the build output for the server, which names a document's boot entries. */
export const FARM_CLIENT_ROUTE_TABLE_FILE = "client-route-table.json";

/** Replaced in the server bundle once the client build has written the table. */
export const FARM_CLIENT_ROUTE_TABLE_PLACEHOLDER = "__farm_client_route_table__";

export function createFarmClientRouteTable(
  clientPages: ReadonlyArray<{
    pattern: string;
    directory?: string;
    pageShouldHydrate: boolean;
    docs?: true;
    hasIsolatedClientBoundaries: boolean;
    islandStrategy: FarmIslandStrategy;
  }>,
): FarmClientRouteTableEntry[] {
  let loaders = 0;
  return clientPages.map((page) => ({
    pattern: page.pattern,
    ...(page.directory ? { directory: page.directory } : {}),
    pageShouldHydrate: page.pageShouldHydrate,
    ...(page.docs ? { docs: true as const } : {}),
    ...(page.hasIsolatedClientBoundaries ? { hasIsolatedClientBoundaries: true as const } : {}),
    islandStrategy: page.islandStrategy,
    ...(page.pageShouldHydrate ? { loader: loaders++ } : {}),
  }));
}

/**
 * Give each URL one client route where the docs runtime's routes meet the app's pages, as the
 * server decides it: the docs runtime answers its own pages before any page route, in dev and
 * production, and an app page renders only at a path it has no page for.
 *
 * - An app page at a path the docs runtime has a page for (`src/app/docs/page.md`, which is the
 *   docs content by default) never renders, so it leaves the table and the docs routes match
 *   that path. In a route group it stays as a docs route with the page's directory, which the
 *   server's layouts read for that path.
 * - An app page with the URL shape of a docs route, at a path the docs runtime has no page for:
 *   a static one (`/docs` without a docs index page) renders there, so it keeps the path and the
 *   docs route goes. A catch-all renders only at the paths the docs runtime has no page for, so
 *   the docs route keeps the pattern and the page is returned in `shadowed`.
 *
 * `pages` lists the docs routes first; `docsPagePaths` are the route paths of the docs
 * runtime's pages.
 */
export function resolveFarmDocsClientRoutes<
  T extends { pattern: string; directory?: string; docs?: true },
>(pages: readonly T[], docsPagePaths: ReadonlySet<string>): { pages: T[]; shadowed: T[] } {
  const docsRoutes = new Map<string, T>();
  for (const page of pages) {
    if (page.docs) docsRoutes.set(getRoutePatternShape(page.pattern, "router"), page);
  }
  // Docs routes are layout-only, so one at another path is a copy of any of them.
  const docsTemplate = docsRoutes.values().next().value;
  const groupedDocsPages: T[] = [];
  const appPages: T[] = [];
  const shadowed: T[] = [];
  for (const page of pages) {
    if (page.docs) continue;
    const shape = getRoutePatternShape(page.pattern, "router");
    const docsRoute = docsRoutes.get(shape);
    const directory = page.directory ? { directory: page.directory } : {};
    if (docsPagePaths.has(page.pattern)) {
      if (docsRoute) docsRoutes.set(shape, { ...docsRoute, ...directory });
      else if (docsTemplate && page.directory) {
        groupedDocsPages.push({ ...docsTemplate, pattern: page.pattern, ...directory });
      }
    } else if (!docsRoute) {
      appPages.push(page);
    } else if (getRoutePatternSpecificity(docsRoute.pattern, "router").every(isStatic)) {
      docsRoutes.delete(shape);
      appPages.push(page);
    } else {
      docsRoutes.set(shape, { ...docsRoute, ...directory });
      shadowed.push(page);
    }
  }
  return { pages: [...docsRoutes.values(), ...groupedDocsPages, ...appPages], shadowed };
}

function isStatic(segment: RouteSegmentSpecificity): boolean {
  return segment === "static";
}

/** The table's module. V8 parses a large JSON string faster than the same object literal. */
export function generateFarmClientRouteTableModule(table: FarmClientRouteTableEntry[]): string {
  return `export default JSON.parse(${JSON.stringify(JSON.stringify(table))});\n`;
}

export async function writeFarmClientRouteTable(
  buildDir: string,
  table: FarmClientRouteTableEntry[],
): Promise<void> {
  await fs.mkdir(buildDir, { recursive: true });
  await fs.writeFile(path.join(buildDir, FARM_CLIENT_ROUTE_TABLE_FILE), JSON.stringify(table));
}

/** Read the table a client build wrote, or null when there is none. */
export async function readFarmClientRouteTable(
  buildDir: string,
): Promise<FarmClientRouteTableEntry[] | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(buildDir, FARM_CLIENT_ROUTE_TABLE_FILE), "utf8"),
    ) as FarmClientRouteTableEntry[] | null;
  } catch {
    return null;
  }
}
