import type { FarmConfig, ParsedRoute, RouteModule, LayoutModule } from "../types";
import { parseRoutePath, matchRoute, resolveAppPath, globFiles, logger } from "../utils";
import path from "path";
import type { ViteDevServer } from "vite";

interface RouteEntry {
  route: ParsedRoute;
  modulePath: string;
  pattern: string;
}

/**
 * Manages route discovery and matching for the Farm.js application
 */
export class RouteManager {
  private config: Required<FarmConfig>;
  private routes: Map<string, RouteEntry> = new Map();
  private layouts: Map<string, RouteEntry> = new Map();
  private viteServer?: ViteDevServer;

  constructor(config: Required<FarmConfig>, viteServer?: ViteDevServer) {
    this.config = config;
    this.viteServer = viteServer;
  }

  /**
   * Discover all routes in the app directory
   */
  async discoverRoutes(): Promise<void> {
    const appDir = resolveAppPath(this.config.root, this.config.srcDir, "app");

    // Find all page and layout files
    const pageFiles = await globFiles("**/page.{ts,tsx,js,jsx}", appDir);
    const layoutFiles = await globFiles("**/layout.{ts,tsx,js,jsx}", appDir);

    // Silent discovery - only log if verbose mode enabled
    if (process.env.FARM_VERBOSE) {
      logger.info(`Discovered ${pageFiles.length} pages and ${layoutFiles.length} layouts`);
    }

    // Process page files
    for (const file of pageFiles) {
      const route = parseRoutePath(file);
      const modulePath = path.join(appDir, file);
      const pattern = this.createRoutePattern(route);

      this.routes.set(pattern, {
        route,
        modulePath,
        pattern,
      });
    }

    // Process layout files
    for (const file of layoutFiles) {
      const route = parseRoutePath(file);
      const modulePath = path.join(appDir, file);
      const pattern = this.createRoutePattern(route);

      this.layouts.set(pattern, {
        route,
        modulePath,
        pattern,
      });
    }

    if (process.env.FARM_VERBOSE) {
      this.logRoutes();
    }
  }

  /**
   * Find matching route for a given URL path
   */
  matchRoute(pathname: string): {
    route: RouteEntry | null;
    params: Record<string, string>;
    layouts: RouteEntry[];
  } {
    // Remove trailing slash except for root
    const normalizedPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    // Find matching page route
    let matchedRoute: RouteEntry | null = null;
    let params: Record<string, string> = {};

    for (const [pattern, routeEntry] of this.routes) {
      const match = matchRoute(normalizedPath, routeEntry.route.segments);
      if (match.matches) {
        matchedRoute = routeEntry;
        params = match.params;
        break;
      }
    }

    // Find all matching layouts (from root to specific)
    const layouts = this.findMatchingLayouts(normalizedPath);

    return {
      route: matchedRoute,
      params,
      layouts,
    };
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Map<string, RouteEntry> {
    return new Map(this.routes);
  }

  /**
   * Get all registered layouts
   */
  getLayouts(): Map<string, RouteEntry> {
    return new Map(this.layouts);
  }

  /**
   * Generate a client-side route manifest for SPA navigation
   * This eliminates the need for server requests during navigation
   */
  generateClientManifest(projectRoot: string): {
    routes: Array<{
      pattern: string;
      modulePath: string;
      segments: Array<{
        segment: string;
        isDynamic: boolean;
        isCatchAll?: boolean;
        isOptional?: boolean;
      }>;
    }>;
    layouts: Array<{
      pattern: string;
      modulePath: string;
    }>;
  } {
    const toUrlPath = (absolutePath: string) => {
      if (absolutePath.startsWith(projectRoot)) {
        return absolutePath.slice(projectRoot.length);
      }
      return absolutePath;
    };

    const routes = Array.from(this.routes.values()).map((entry) => ({
      pattern: entry.pattern,
      modulePath: toUrlPath(entry.modulePath),
      segments: entry.route.segments.map((seg) => ({
        segment: seg.segment,
        isDynamic: seg.isDynamic,
        isCatchAll: seg.isCatchAll,
        isOptional: seg.isOptional,
      })),
    }));

    const layouts = Array.from(this.layouts.values()).map((entry) => ({
      pattern: entry.pattern,
      modulePath: toUrlPath(entry.modulePath),
    }));

    return { routes, layouts };
  }

  /**
   * Load a route module dynamically
   */
  async loadRouteModule(modulePath: string): Promise<RouteModule> {
    try {
      if (this.viteServer) {
        const module = await this.viteServer.ssrLoadModule(modulePath);
        return module as RouteModule;
      } else {
        const module = await import(/* @vite-ignore */ modulePath);
        return module as RouteModule;
      }
    } catch (error) {
      logger.error(`Failed to load route module: ${modulePath}`);
      throw error;
    }
  }

  /**
   * Load a layout module dynamically
   */
  async loadLayoutModule(modulePath: string): Promise<LayoutModule> {
    try {
      if (this.viteServer) {
        const module = await this.viteServer.ssrLoadModule(modulePath);
        return module as LayoutModule;
      } else {
        const module = await import(/* @vite-ignore */ modulePath);
        return module as LayoutModule;
      }
    } catch (error) {
      logger.error(`Failed to load layout module: ${modulePath}`);
      throw error;
    }
  }

  /**
   * Create a route pattern from parsed route
   */
  private createRoutePattern(route: ParsedRoute): string {
    if (route.segments.length === 0) return "/";

    return (
      "/" +
      route.segments
        .map((segment) => {
          if (!segment.isDynamic) return segment.segment;

          if (segment.isCatchAll) {
            return segment.isOptional ? `[[...${segment.segment}]]` : `[...${segment.segment}]`;
          }

          return `[${segment.segment}]`;
        })
        .join("/")
    );
  }

  /**
   * Find all layouts that should wrap a given path
   */
  private findMatchingLayouts(pathname: string): RouteEntry[] {
    const matchingLayouts: RouteEntry[] = [];
    const pathSegments = pathname.split("/").filter(Boolean);

    const sortedLayouts = Array.from(this.layouts.values()).sort((a, b) => {
      return a.route.segments.length - b.route.segments.length;
    });

    for (const layoutEntry of sortedLayouts) {
      if (layoutEntry.route.segments.length > pathSegments.length) {
        continue;
      }

      let matches = true;
      for (let i = 0; i < layoutEntry.route.segments.length; i++) {
        const segment = layoutEntry.route.segments[i];
        if (!segment.isDynamic && segment.segment !== pathSegments[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        matchingLayouts.push(layoutEntry);
      }
    }

    return matchingLayouts;
  }

  /**
   * Log discovered routes for debugging
   */
  private logRoutes(): void {
    if (this.routes.size > 0) {
      logger.info("Registered routes:");
      for (const [pattern, entry] of this.routes) {
        console.log(`  ${pattern} -> ${entry.modulePath}`);
      }
    }

    if (this.layouts.size > 0) {
      logger.info("Registered layouts:");
      for (const [pattern, entry] of this.layouts) {
        console.log(`  ${pattern} -> ${entry.modulePath}`);
      }
    }
  }
}
