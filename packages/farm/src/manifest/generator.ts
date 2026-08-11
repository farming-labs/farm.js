/**
 * Build-time manifest generator
 * Generates route → chunk mapping for SPA navigation
 */

import * as fs from "fs";
import * as path from "path";
import type {
  AppManifest,
  RouteManifestEntry,
  LayoutManifestEntry,
  RouterManagedTag,
} from "./types";
import { getClientModuleMetadata } from "../utils/client-component";
import { createFarmRouteRenderPlan } from "../navigation/render-plan";

function layoutAppliesToRoute(layoutPattern: string, routePattern: string): boolean {
  if (layoutPattern === "/") return true;
  const normalizedLayout = layoutPattern.replace(/\/$/, "");
  const normalizedRoute = routePattern.replace(/\/$/, "");
  return normalizedRoute === normalizedLayout || normalizedRoute.startsWith(`${normalizedLayout}/`);
}

interface RouteInfo {
  pattern: string;
  modulePath: string;
  segments: RouteManifestEntry["segments"];
}

interface ChunkInfo {
  fileName: string;
  imports?: string[];
  css?: string[];
}

/**
 * Parse route path from file path
 */
function parseRoutePath(filePath: string): {
  segments: RouteManifestEntry["segments"];
  pattern: string;
} {
  // Remove page.tsx or layout.tsx from path
  const routePath = filePath
    .replace(/\/page\.(tsx?|jsx?)$/, "")
    .replace(/\/layout\.(tsx?|jsx?)$/, "");

  if (!routePath || routePath === ".") {
    return { segments: [], pattern: "/" };
  }

  const parts = routePath.split("/").filter(Boolean);
  const segments: RouteManifestEntry["segments"] = [];

  for (const part of parts) {
    if (part.startsWith("[[...") && part.endsWith("]]")) {
      // Optional catch-all: [[...slug]]
      segments.push({
        segment: part.slice(5, -2),
        isDynamic: true,
        isCatchAll: true,
        isOptional: true,
      });
    } else if (part.startsWith("[...") && part.endsWith("]")) {
      // Catch-all: [...slug]
      segments.push({
        segment: part.slice(4, -1),
        isDynamic: true,
        isCatchAll: true,
      });
    } else if (part.startsWith("[") && part.endsWith("]")) {
      // Dynamic: [id]
      segments.push({
        segment: part.slice(1, -1),
        isDynamic: true,
      });
    } else {
      // Static segment
      segments.push({
        segment: part,
        isDynamic: false,
      });
    }
  }

  // Build pattern
  const pattern =
    "/" +
    segments
      .map((seg) => {
        if (!seg.isDynamic) return seg.segment;
        if (seg.isCatchAll) {
          return seg.isOptional ? `[[...${seg.segment}]]` : `[...${seg.segment}]`;
        }
        return `[${seg.segment}]`;
      })
      .join("/");

  return { segments, pattern: pattern || "/" };
}

/**
 * Discover routes and layouts in app directory
 */
async function discoverRoutes(
  appDir: string,
): Promise<{ routes: RouteInfo[]; layouts: RouteInfo[] }> {
  const routes: RouteInfo[] = [];
  const layouts: RouteInfo[] = [];

  async function scanDir(dir: string, relativePath: string = ""): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath, path.join(relativePath, entry.name));
      } else if (entry.name.match(/^page\.(tsx?|jsx?)$/)) {
        const { segments, pattern } = parseRoutePath(relativePath);
        routes.push({
          pattern,
          modulePath: fullPath,
          segments,
        });
      } else if (entry.name.match(/^layout\.(tsx?|jsx?)$/)) {
        const { segments, pattern } = parseRoutePath(relativePath);
        layouts.push({
          pattern,
          modulePath: fullPath,
          segments,
        });
      }
    }
  }

  if (fs.existsSync(appDir)) {
    await scanDir(appDir);
  }

  return { routes, layouts };
}

/**
 * Generate manifest for development mode
 * In dev, we don't have chunk info, so we use module paths directly
 */
export async function generateDevManifest(
  appDir: string,
  projectRoot: string,
): Promise<AppManifest> {
  const { routes, layouts } = await discoverRoutes(appDir);
  const layoutMetadata = new Map(
    layouts.map((layout) => [
      layout.pattern,
      getClientModuleMetadata(layout.modulePath, projectRoot),
    ]),
  );

  const toUrlPath = (absolutePath: string): string => {
    if (absolutePath.startsWith(projectRoot)) {
      return absolutePath.slice(projectRoot.length);
    }
    return absolutePath;
  };

  const routeManifest: Record<string, RouteManifestEntry> = {};
  for (const route of routes) {
    const metadata = getClientModuleMetadata(route.modulePath, projectRoot);
    const routeLayouts = layouts.filter((layout) =>
      layoutAppliesToRoute(layout.pattern, route.pattern),
    );
    const layoutShouldHydrate = routeLayouts.some(
      (layout) => layoutMetadata.get(layout.pattern)?.shouldHydrate === true,
    );
    routeManifest[route.pattern] = {
      modulePath: toUrlPath(route.modulePath),
      pattern: route.pattern,
      segments: route.segments,
      isClientComponent: metadata.isClientComponent,
      shouldHydrate: metadata.shouldHydrate,
      islandStrategy: metadata.islandStrategy,
      renderPlan: createFarmRouteRenderPlan({
        pageShouldHydrate: metadata.shouldHydrate,
        layoutShouldHydrate,
        islandStrategy: metadata.islandStrategy,
      }),
      preloads: [],
      assets: [],
    };
  }

  const layoutManifest: Record<string, LayoutManifestEntry> = {};
  for (const layout of layouts) {
    const metadata = layoutMetadata.get(layout.pattern);
    layoutManifest[layout.pattern] = {
      modulePath: toUrlPath(layout.modulePath),
      pattern: layout.pattern,
      preloads: [],
      assets: [],
      shouldHydrate: metadata?.shouldHydrate === true,
      islandStrategy: metadata?.islandStrategy ?? null,
    };
  }

  return {
    clientEntry: "/@farm/client.js",
    routes: routeManifest,
    layouts: layoutManifest,
    sharedAssets: [
      {
        tag: "link",
        attrs: {
          rel: "stylesheet",
          href: "/src/app/globals.css",
        },
      },
    ],
  };
}

/**
 * Generate manifest for production build
 * Uses Vite's bundle output to map routes to chunks
 */
export async function generateProdManifest(
  appDir: string,
  projectRoot: string,
  clientBundle: Record<string, ChunkInfo>,
): Promise<AppManifest> {
  const { routes, layouts } = await discoverRoutes(appDir);
  const layoutMetadata = new Map(
    layouts.map((layout) => [
      layout.pattern,
      getClientModuleMetadata(layout.modulePath, projectRoot),
    ]),
  );

  const toUrlPath = (absolutePath: string): string => {
    if (absolutePath.startsWith(projectRoot)) {
      return absolutePath.slice(projectRoot.length);
    }
    return absolutePath;
  };

  // Map module paths to chunk info
  const moduleToChunk = new Map<string, ChunkInfo>();
  for (const [chunkName, chunk] of Object.entries(clientBundle)) {
    // The module path is usually the key or can be derived
    moduleToChunk.set(chunkName, chunk);
  }

  const routeManifest: Record<string, RouteManifestEntry> = {};
  for (const route of routes) {
    const urlPath = toUrlPath(route.modulePath);
    const chunk = moduleToChunk.get(urlPath) || moduleToChunk.get(route.modulePath);

    const preloads: string[] = [];
    const assets: RouterManagedTag[] = [];

    if (chunk) {
      // Add the chunk itself
      preloads.push(`/assets/${chunk.fileName}`);

      // Add imports
      if (chunk.imports) {
        preloads.push(...chunk.imports.map((i) => `/assets/${i}`));
      }

      // Add CSS
      if (chunk.css) {
        for (const css of chunk.css) {
          assets.push({
            tag: "link",
            attrs: { rel: "stylesheet", href: `/assets/${css}` },
          });
        }
      }
    }

    const metadata = getClientModuleMetadata(route.modulePath, projectRoot);
    const routeLayouts = layouts.filter((layout) =>
      layoutAppliesToRoute(layout.pattern, route.pattern),
    );
    const layoutShouldHydrate = routeLayouts.some(
      (layout) => layoutMetadata.get(layout.pattern)?.shouldHydrate === true,
    );
    routeManifest[route.pattern] = {
      modulePath: urlPath,
      pattern: route.pattern,
      segments: route.segments,
      isClientComponent: metadata.isClientComponent,
      shouldHydrate: metadata.shouldHydrate,
      islandStrategy: metadata.islandStrategy,
      renderPlan: createFarmRouteRenderPlan({
        pageShouldHydrate: metadata.shouldHydrate,
        layoutShouldHydrate,
        islandStrategy: metadata.islandStrategy,
      }),
      preloads,
      assets,
    };
  }

  const layoutManifest: Record<string, LayoutManifestEntry> = {};
  for (const layout of layouts) {
    const urlPath = toUrlPath(layout.modulePath);
    const metadata = layoutMetadata.get(layout.pattern);
    layoutManifest[layout.pattern] = {
      modulePath: urlPath,
      pattern: layout.pattern,
      preloads: [],
      assets: [],
      shouldHydrate: metadata?.shouldHydrate === true,
      islandStrategy: metadata?.islandStrategy ?? null,
    };
  }

  return {
    clientEntry: "/assets/client.js", // Will be replaced with actual entry
    routes: routeManifest,
    layouts: layoutManifest,
    sharedAssets: [],
  };
}
