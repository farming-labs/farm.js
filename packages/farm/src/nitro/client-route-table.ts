import fs from "node:fs/promises";
import path from "node:path";
import type { FarmIslandStrategy } from "../island";

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
  /** The page's directory with its route groups, when it differs from the pattern. */
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
