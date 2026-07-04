import type { ResolvedFarmConfig } from "../config";
import { resolveDeployOutputPath } from "../config";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import type { PluginManager } from "../plugin";
import { build as viteBuild, type Rollup } from "vite";
import * as nitro from "nitro";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { builtinModules, createRequire } from "module";
import { logger } from "../utils";
import { getClientModuleMetadata } from "../utils/client-component";
import { virtualBundlePlugin } from "./virtual-bundle-plugin";
import type { NitroConfig } from "nitro/config";

// Type alias for OutputBundle
type OutputBundle = Rollup.OutputBundle;

// Get __dirname equivalent for ESM
const _filename = typeof import.meta.url !== "undefined" ? fileURLToPath(import.meta.url) : "";
const _dirname = path.dirname(_filename);
const NODE_BUILTIN_MODULES = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);
const NITRO_EXTERNAL_MODULES = new Set([
  "react",
  "react-dom",
  "react-dom/server",
  "@prisma/client",
  "@prisma/client/default",
  "@prisma/client/default.js",
  ".prisma/client",
  ".prisma/client/default",
  "better-sqlite3",
  "fsevents",
  "esbuild",
  "lightningcss",
  "rollup",
  "vite",
  "nitro",
  "nitropack",
]);

function isNitroRollupExternal(id: string): boolean {
  const normalizedId = id.replace(/\\/g, "/");

  return (
    NODE_BUILTIN_MODULES.has(id) ||
    NITRO_EXTERNAL_MODULES.has(id) ||
    normalizedId.startsWith(".prisma/") ||
    normalizedId.includes("/node_modules/@prisma/client/") ||
    normalizedId.includes("/node_modules/.prisma/client/")
  );
}

function hasProjectPostcssConfig(root: string): boolean {
  const candidates = [
    "postcss.config.js",
    "postcss.config.cjs",
    "postcss.config.mjs",
    "postcss.config.ts",
    "postcss.config.json",
    ".postcssrc",
    ".postcssrc.json",
    ".postcssrc.js",
    ".postcssrc.cjs",
    ".postcssrc.mjs",
    ".postcssrc.ts",
  ];

  const projectRequire = createRequire(path.join(root, "package.json"));
  return candidates.some((file) => {
    try {
      projectRequire.resolve(`./${file}`);
      return true;
    } catch {
      return false;
    }
  });
}

async function findFarmConfigPath(root: string): Promise<string | null> {
  const fs = await import("fs/promises");
  const candidates = ["farm.config.ts", "farm.config.js", "farm.config.mjs"];

  for (const candidate of candidates) {
    const resolvedPath = path.join(root, candidate);
    try {
      await fs.access(resolvedPath);
      return resolvedPath;
    } catch {
      // Continue checking the next supported config path.
    }
  }

  return null;
}

/**
 * Universal build using TanStack Start pattern
 * - Builds SSR bundle in memory
 * - Uses virtual bundle plugin to expose to Nitro
 * - Creates virtual entry wrapping Web Standard handler
 */
export async function buildUniversal(
  config: ResolvedFarmConfig,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  options: {
    preset?: string;
    root?: string;
    pluginManager?: PluginManager;
  } = {},
): Promise<void> {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";
  const deployOutputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const lifecyclePluginManager = options.pluginManager;

  logger.info(`🚜 Building Farm.js application (universal) with preset: ${preset}...`);

  try {
    // Get page routes first (needed for both client and SSR builds)
    const pageRoutes: Array<{ pattern: string; modulePath: string }> = [];
    for (const [pattern, entry] of routeManager.getRoutes()) {
      pageRoutes.push({
        pattern,
        modulePath: entry.modulePath,
      });
    }
    logger.info(`📋 Found ${pageRoutes.length} page routes`);

    // Discover layout files early (needed for client CSS scanning)
    const fs = await import("fs/promises");
    const layoutRoutes: Array<{ pattern: string; modulePath: string }> = [];
    const appDir = path.join(root, srcDir, "app");

    async function findLayoutsForClient(dir: string, routePrefix: string = "/"): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.match(/^layout\.(tsx?|jsx?)$/)) {
            layoutRoutes.push({
              pattern: routePrefix,
              modulePath: path.join(dir, entry.name),
            });
          } else if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !entry.name.startsWith("_")
          ) {
            const childPrefix =
              routePrefix === "/" ? `/${entry.name}` : `${routePrefix}/${entry.name}`;
            await findLayoutsForClient(path.join(dir, entry.name), childPrefix);
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    }
    await findLayoutsForClient(appDir);
    logger.info(`📋 Found ${pageRoutes.length} page routes and ${layoutRoutes.length} layouts`);

    const clientOutputDir = path.join(root, distDir, "client");

    // Step 1 & 2: Build client and SSR bundles IN PARALLEL for faster builds
    logger.info("📦 Building client and SSR bundles in parallel...");
    const [_, ssrResult] = await Promise.all([
      // Client build (to disk)
      buildClient(config, root, srcDir, clientOutputDir, pageRoutes, layoutRoutes),
      // SSR build (in memory)
      buildSSRInMemory(config, root, srcDir, routeManager, apiRouteManager, serverRenderer),
    ]);

    const { bundle: ssrBundle, entryFile: ssrEntryFile } = ssrResult;

    // Step 3: Build with Nitro using virtual bundle
    logger.info(`🚀 Building server with Nitro (preset: ${preset})...`);
    await buildNitroUniversal(
      config,
      routeManager,
      apiRouteManager,
      serverRenderer,
      preset,
      root,
      distDir,
      ssrBundle,
      ssrEntryFile,
      clientOutputDir,
      lifecyclePluginManager,
    );

    logger.success("✅ Build completed successfully!");
    logger.info(`📁 Output directory: ${deployOutputDir}`);
  } catch (error) {
    if (lifecyclePluginManager) {
      await lifecyclePluginManager.runHookParallel("onError", {
        phase: "buildUniversal",
        error,
        meta: {
          root,
          preset,
        },
      });
    }
    logger.error(`❌ Build failed: ${error}`);
    throw error;
  }
}

/**
 * Build client bundle (to disk) with hydration for "use client" components
 */
async function buildClient(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
  pageRoutes: Array<{ pattern: string; modulePath: string }>,
  layoutRoutes: Array<{ pattern: string; modulePath: string }> = [],
) {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");
  const fs = await import("fs/promises");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);

  // Detect which pages should hydrate on the client.
  const clientPages: Array<{ pattern: string; modulePath: string; relativePath: string }> = [];

  for (const route of pageRoutes) {
    try {
      const metadata = getClientModuleMetadata(route.modulePath, root);
      if (metadata.shouldHydrate) {
        const relativePath = route.modulePath.replace(root, "").replace(/^\//, "");
        clientPages.push({ ...route, relativePath });
        logger.info(`📱 Found hydratable route: ${route.pattern} -> ${route.modulePath}`);
      }
    } catch (error) {
      logger.warn(`⚠️  Could not inspect route file ${route.modulePath}: ${error}`);
    }
  }

  logger.info(
    `📱 Total hydratable routes detected: ${clientPages.length} out of ${pageRoutes.length} pages`,
  );

  // Generate client hydration entry code
  const clientEntryDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-client-entry-"));
  const clientEntryPath = path.join(clientEntryDir, "farm-client-entry.tsx");
  const clientHydrationCode = generateClientHydrationEntry(
    clientPages,
    layoutRoutes,
    root,
    srcDir,
    clientEntryDir,
  );

  // Write the client entry to a temporary file
  await fs.writeFile(clientEntryPath, clientHydrationCode);

  // Tailwind support:
  // - If project has explicit PostCSS config, respect it.
  // - Otherwise enable built-in @tailwindcss/vite (out of the box).
  const hasScopedPostcssConfig = hasProjectPostcssConfig(root);
  let postcssSearchPath: string | undefined;
  let tailwindVitePlugin: any = undefined;
  if (hasScopedPostcssConfig) {
    logger.info("📦 Using project PostCSS/Tailwind configuration");
  } else {
    const postcssConfigPath = path.join(clientEntryDir, "postcss.config.cjs");
    await fs.writeFile(postcssConfigPath, "module.exports = { plugins: [] };\n");
    postcssSearchPath = clientEntryDir;
    try {
      const tailwindVite = (await import("@tailwindcss/vite")).default;
      tailwindVitePlugin = tailwindVite();
      logger.info("📦 Enabled built-in Tailwind support (@tailwindcss/vite)");
    } catch (error) {
      logger.warn(
        `Tailwind plugin auto-enable failed; continuing without it: ${(error as Error).message}`,
      );
    }
  }

  try {
    await viteBuild({
      root,
      build: {
        outDir: outputDir,
        emptyOutDir: true,
        cssCodeSplit: false, // Bundle all CSS into one file
        rollupOptions: {
          input: {
            "farm-client": clientEntryPath,
          },
          output: {
            entryFileNames: "[name].js",
            chunkFileNames: "chunks/[name]-[hash].js",
            // Use predictable name for CSS so we can reference it in SSR HTML
            assetFileNames: (assetInfo) => {
              if (assetInfo.name?.endsWith(".css")) {
                return "farm-client.css";
              }
              return "assets/[name]-[hash][extname]";
            },
          },
          // Externalize Node.js built-ins and server-side modules for client build
          external: (id) => {
            // Externalize Node.js built-ins
            if (
              id.startsWith("node:") ||
              [
                "path",
                "url",
                "fs",
                "fs/promises",
                "os",
                "crypto",
                "http",
                "https",
                "net",
                "stream",
                "util",
                "events",
                "child_process",
                "module",
                "tty",
                "dns",
              ].includes(id)
            ) {
              return true;
            }
            // Externalize native modules that can't be bundled for browser
            if (id === "fsevents" || id.includes("fsevents") || id.endsWith(".node")) {
              return true;
            }
            return false;
          },
        },
      },
      plugins: [
        ...(tailwindVitePlugin ? [tailwindVitePlugin] : []),
        // Plugin to redirect @farmjs/core imports to client-only exports
        {
          name: "farm-client-only-imports",
          enforce: "pre" as const,
          resolveId(id) {
            // Redirect @farmjs/core to just export client-safe parts
            // Don't redirect @farmjs/core/client - that's already client-safe
            if (id === "@farmjs/core") {
              return { id: "\0farm-client-exports", external: false };
            }
            // Block server-only imports completely
            if (
              id === "@farmjs/core/server" ||
              id === "@farmjs/core/api" ||
              id === "@farmjs/core/middleware" ||
              id === "@farmjs/core/config" ||
              id.includes("@farmjs/core/middleware") ||
              id.includes("@farmjs/core/query/server")
            ) {
              return { id: "\0empty-module", external: false };
            }
            // Block API route imports (they come from type-only imports in api.generated.ts)
            if (id.includes("/api/") && id.includes("/route")) {
              return { id: "\0empty-api-route", external: false };
            }
            // Block problematic node modules
            if (
              id === "fsevents" ||
              id.includes("fsevents") ||
              id.endsWith(".node") ||
              id === "nitro" ||
              id === "vite" ||
              id === "esbuild" ||
              id === "rollup" ||
              id.startsWith("nitro/") ||
              id.includes("node-pre-gyp") ||
              id.includes("nf3")
            ) {
              return { id: "\0empty-module", external: false };
            }
            return null;
          },
          load(id) {
            if (id === "\0empty-module") {
              return "export default {}; export const getMiddlewareData = () => ({}); export const getMiddlewareValue = () => undefined; export const middleware = () => ({});";
            }
            if (id === "\0empty-api-route") {
              // Stub for API routes - only used in type context, provide empty exports
              return "export const GET = () => {}; export const POST = () => {}; export const PUT = () => {}; export const DELETE = () => {}; export const PATCH = () => {}; export default {};";
            }
            if (id === "\0farm-client-exports") {
              // Only export client-safe parts (no type exports - they're erased at compile time)
              return [
                "// Farm.js Client Exports - Safe for browser bundling",
                'export { Link } from "@farmjs/core/client";',
                'export { useRouter } from "@farmjs/core/client";',
                'export { createAPIClient } from "@farmjs/core/client";',
              ].join("\n");
            }
            return null;
          },
        },
        farmPlugin(config, pluginManager),
      ],
      mode: "production",
      css: postcssSearchPath
        ? {
            postcss: postcssSearchPath,
          }
        : undefined,
      // Ensure React is bundled for client
      resolve: {
        dedupe: ["react", "react-dom"],
      },
      // Optimize dependencies - exclude server-side code from client bundle
      optimizeDeps: {
        exclude: ["@farmjs/core/server", "@farmjs/core/api", "@farmjs/core/middleware"],
      },
    });
  } finally {
    // Clean up temporary entry file
    try {
      await fs.rm(clientEntryDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate client hydration entry that imports and hydrates client components
 */
function generateClientHydrationEntry(
  clientPages: Array<{ pattern: string; modulePath: string; relativePath: string }>,
  layoutRoutes: Array<{ pattern: string; modulePath: string }>,
  root: string,
  srcDir: string,
  clientEntryDir: string,
): string {
  const toImportPath = (targetPath: string) => targetPath.replace(/\\/g, "/");

  // Always import global CSS for Tailwind
  const globalsCssPath = path.join(root, srcDir, "app", "globals.css");
  const cssImportPath = toImportPath(globalsCssPath);
  const cssImport = `import ${JSON.stringify(cssImportPath)};`;

  // Import layouts for wrapping client components
  const layoutImportStatements: string[] = [];
  const layoutRegistrations: string[] = [];

  layoutRoutes.forEach((layout, index) => {
    const relativePath = toImportPath(layout.modulePath);
    layoutImportStatements.push(`import Layout${index} from "${relativePath}";`);
    layoutRegistrations.push(
      `  { pattern: ${JSON.stringify(layout.pattern)}, Component: Layout${index} }`,
    );
  });

  const layoutImports = layoutImportStatements.join("\n");

  if (clientPages.length === 0) {
    // No client pages - just basic runtime with CSS and SPA navigation
    return `
// Farm.js Client Runtime (no client components)
${cssImport}
${layoutImports}
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

// SPA Router for server-rendered pages (HTML swap)
const spaRouter = {
  prefetchCache: new Map(),
  
  navigate: async function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    
    try {
      const html = await this.fetchPage(url.pathname + url.search);
      this.swapContent(html);
      window.history.pushState({}, "", href);
    } catch (error) {
      console.error("[Farm.js] Navigation error:", error);
      window.location.href = href;
    }
  },
  
  fetchPage: async function(url) {
    const cached = this.prefetchCache.get(url);
    if (cached) return cached;
    
    const response = await fetch(url, {
      headers: { "Accept": "text/html" }
    });
    if (!response.ok) throw new Error("Failed to fetch page");
    return response.text();
  },
  
  swapContent: function(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Update title
    const newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent || "";
    
    // Update meta tags
    const newMetas = doc.querySelectorAll("meta[name]");
    newMetas.forEach(function(meta) {
      const name = meta.getAttribute("name");
      if (name) {
        const existing = document.querySelector("meta[name=\\"" + name + "\\"]");
        if (existing) {
          existing.setAttribute("content", meta.getAttribute("content") || "");
        } else {
          document.head.appendChild(meta.cloneNode(true));
        }
      }
    });
    
    // Swap root content
    const newRoot = doc.getElementById("root");
    const currentRoot = document.getElementById("root");
    if (newRoot && currentRoot) {
      currentRoot.innerHTML = newRoot.innerHTML;
    }
  },
  
  prefetch: function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    
    const pathname = url.pathname + url.search;
    if (this.prefetchCache.has(pathname)) return;
    
    this.fetchPage(pathname)
      .then(function(html) { spaRouter.prefetchCache.set(pathname, html); })
      .catch(function() {});
  },
  
  observeForPrefetch: function(element, href) {
    if (!("IntersectionObserver" in window)) return;
    
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
        }
      });
    }, { rootMargin: "50px" });
    
    observer.observe(element);
  },
  
  unobserveForPrefetch: function() {}
};

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  spaRouter.fetchPage(window.location.pathname + window.location.search)
    .then(function(html) { spaRouter.swapContent(html); })
    .catch(function() { window.location.reload(); });
});

// Intercept link clicks
document.addEventListener("click", function(e) {
  const target = e.target;
  const anchor = target.closest ? target.closest("a") : null;
  if (!anchor) return;
  
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
  if (href.startsWith("#")) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.button !== 0) return;
  if (e.defaultPrevented) return;
  
  e.preventDefault();
  spaRouter.navigate(href);
});
`.trim();
  }

  // Generate imports for client components
  const imports: string[] = [];
  const routeEntries: string[] = [];

  clientPages.forEach((page, index) => {
    const importPath = toImportPath(page.modulePath);
    imports.push(`import Page${index} from "${importPath}";`);
    routeEntries.push(`  { pattern: ${JSON.stringify(page.pattern)}, Component: Page${index} }`);
  });

  // Full SPA client with hydration for client components
  return `
// Farm.js Client Runtime - SPA with Hydration
${cssImport}
${layoutImports}
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

${imports.join("\n")}

// Client component routes
const clientRoutes = [
${routeEntries.join(",\n")}
];

// Layout routes for wrapping client components
const layoutRoutes = [
${layoutRegistrations.join(",\n")}
];

// Get applicable layouts for a pathname (sorted by depth, root first)
function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  
  for (const layout of layoutRoutes) {
    if (layout.pattern === '/' || 
        normalizedPath === layout.pattern || 
        normalizedPath.startsWith(layout.pattern + '/')) {
      applicable.push(layout);
    }
  }
  
  // Sort by depth (root first)
  applicable.sort(function(a, b) {
    const depthA = a.pattern.split('/').filter(Boolean).length;
    const depthB = b.pattern.split('/').filter(Boolean).length;
    return depthA - depthB;
  });
  
  return applicable;
}

// Wrap a page element with applicable layouts
function wrapWithLayouts(pageElement, pathname, params) {
  const layouts = getApplicableLayouts(pathname);
  let wrapped = pageElement;
  
  // Wrap from innermost to outermost (reverse order since layouts are root-first)
  for (let i = layouts.length - 1; i >= 0; i--) {
    const LayoutComponent = layouts[i].Component;
    if (LayoutComponent) {
      wrapped = React.createElement(LayoutComponent, { children: wrapped, params: params });
    }
  }
  
  return wrapped;
}

// Match pathname to client route
function matchRoute(pathname) {
  for (const route of clientRoutes) {
    // Convert pattern to regex
    let regexPattern = route.pattern;
    
    // Handle [param] format - convert to named group
    while (regexPattern.includes("[")) {
      const start = regexPattern.indexOf("[");
      const end = regexPattern.indexOf("]");
      if (start === -1 || end === -1) break;
      const paramName = regexPattern.substring(start + 1, end);
      regexPattern = regexPattern.substring(0, start) + "(?<" + paramName + ">[^/]+)" + regexPattern.substring(end + 1);
    }
    
    // Escape forward slashes
    regexPattern = regexPattern.split("/").join("\\\\/");
    
    try {
      const regex = new RegExp("^" + regexPattern + "$");
      const match = pathname.match(regex);
      if (match) {
        return { route: route, params: match.groups || {} };
      }
    } catch (e) {
      console.warn("[Farm.js] Invalid route pattern:", route.pattern);
    }
  }
  return null;
}

// State
let reactRoot = null;
let currentPathname = null;
let isHydrated = false;

// Hydrate client components
function hydrate() {
  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);
  
  if (!matched) {
    return;
  }
  
  const container = document.getElementById("root");
  if (!container) {
    console.error("[Farm.js] No root element found");
    return;
  }
  
  const Component = matched.route.Component;
  const params = matched.params;
  const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
  
  const props = { params: params, searchParams: Promise.resolve(searchParams) };
  
  // Create page element and wrap with layouts
  const pageElement = React.createElement(Component, props);
  const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
  
  try {
    if (!isHydrated && container.innerHTML.trim()) {
      reactRoot = hydrateRoot(container, wrappedElement);
      isHydrated = true;
    } else {
      if (!reactRoot) {
        reactRoot = createRoot(container);
      }
      reactRoot.render(wrappedElement);
    }
    currentPathname = pathname;
  } catch (error) {
    console.error("[Farm.js] Hydration error:", error);
  }
}

// SPA Router
const spaRouter = {
  prefetchCache: new Map(),
  
  navigate: async function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = href;
      return;
    }
    
    const pathname = url.pathname;
    const matched = matchRoute(pathname);
    
    if (matched) {
      // Client component - render with layout wrapper
      window.history.pushState({}, "", href);
      const Component = matched.route.Component;
      const params = matched.params;
      const searchParams = Object.fromEntries(url.searchParams);
      const props = { params: params, searchParams: Promise.resolve(searchParams) };
      
      // Create page element and wrap with layouts
      const pageElement = React.createElement(Component, props);
      const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
      
      const container = document.getElementById("root");
      if (container) {
        if (!reactRoot) {
          reactRoot = createRoot(container);
        }
        reactRoot.render(wrappedElement);
        currentPathname = pathname;
      }
      return;
    }
    
    // Server component - fetch HTML
    try {
      const html = await this.fetchPage(url.pathname + url.search);
      this.swapContent(html);
      window.history.pushState({}, "", href);
      currentPathname = pathname;
    } catch (error) {
      console.error("[Farm.js] Navigation error:", error);
      window.location.href = href;
    }
  },
  
  fetchPage: async function(url) {
    const cached = this.prefetchCache.get(url);
    if (cached) return cached;
    
    const response = await fetch(url, {
      headers: { "Accept": "text/html" }
    });
    if (!response.ok) throw new Error("Failed to fetch page");
    return response.text();
  },
  
  swapContent: function(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Update title
    const newTitle = doc.querySelector("title");
    if (newTitle) document.title = newTitle.textContent || "";
    
    // Update meta tags
    const newMetas = doc.querySelectorAll("meta[name]");
    newMetas.forEach(function(meta) {
      const name = meta.getAttribute("name");
      if (name) {
        const existing = document.querySelector("meta[name=\\"" + name + "\\"]");
        if (existing) {
          existing.setAttribute("content", meta.getAttribute("content") || "");
        } else {
          document.head.appendChild(meta.cloneNode(true));
        }
      }
    });
    
    // Swap root content
    const newRoot = doc.getElementById("root");
    const currentRoot = document.getElementById("root");
    if (newRoot && currentRoot) {
      currentRoot.innerHTML = newRoot.innerHTML;
      
      // Check if new page has a client component
      const newPathname = window.location.pathname;
      const matched = matchRoute(newPathname);
      if (matched) {
        // Re-hydrate the client component
        const Component = matched.route.Component;
        const params = matched.params;
        const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
        const props = { params: params, searchParams: Promise.resolve(searchParams) };
        
        if (!reactRoot) {
          reactRoot = createRoot(currentRoot);
        }
        const pageElement = React.createElement(Component, props);
        const wrappedElement = wrapWithLayouts(pageElement, newPathname, params);
        reactRoot.render(wrappedElement);
      }
    }
  },
  
  prefetch: function(href) {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    
    const pathname = url.pathname + url.search;
    if (this.prefetchCache.has(pathname)) return;
    
    this.fetchPage(pathname)
      .then(function(html) { spaRouter.prefetchCache.set(pathname, html); })
      .catch(function() {});
  },
  
  observeForPrefetch: function(element, href) {
    if (!("IntersectionObserver" in window)) return;
    
    const observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          spaRouter.prefetch(href);
          observer.disconnect();
        }
      });
    }, { rootMargin: "50px" });
    
    observer.observe(element);
  },
  
  unobserveForPrefetch: function() {}
};

// Expose router globally
window.__FARM_SPA_ROUTER__ = spaRouter;

// Handle popstate (back/forward)
window.addEventListener("popstate", function() {
  const pathname = window.location.pathname;
  const matched = matchRoute(pathname);
  
  if (matched) {
    const Component = matched.route.Component;
    const params = matched.params;
    const searchParams = Object.fromEntries(new URLSearchParams(window.location.search));
    const props = { params: params, searchParams: Promise.resolve(searchParams) };
    const pageElement = React.createElement(Component, props);
    const wrappedElement = wrapWithLayouts(pageElement, pathname, params);
    
    const container = document.getElementById("root");
    if (container && reactRoot) {
      reactRoot.render(wrappedElement);
      currentPathname = pathname;
    }
  } else {
    spaRouter.fetchPage(pathname + window.location.search)
      .then(function(html) { spaRouter.swapContent(html); })
      .catch(function() { window.location.reload(); });
  }
});

// Intercept link clicks
document.addEventListener("click", function(e) {
  const target = e.target;
  const anchor = target.closest ? target.closest("a") : null;
  if (!anchor) return;
  
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
  if (href.startsWith("#")) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
  if (e.button !== 0) return;
  if (e.defaultPrevented) return;
  
  e.preventDefault();
  spaRouter.navigate(href);
});

// Initial hydration
hydrate();
`.trim();
}

/**
 * Build SSR bundle in memory (write: false)
 * Creates a virtual entry that bundles all API routes and page routes
 * Managers are created at runtime from the bundled code
 */
async function buildSSRInMemory(
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
): Promise<{ bundle: OutputBundle; entryFile: string }> {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");
  const fs = await import("fs/promises");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);
  const hasScopedPostcssConfig = hasProjectPostcssConfig(root);
  let postcssConfigDir: string | undefined;
  if (!hasScopedPostcssConfig) {
    postcssConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-postcss-"));
    await fs.writeFile(
      path.join(postcssConfigDir, "postcss.config.cjs"),
      "module.exports = { plugins: [] };\n",
    );
  }

  let ssrBundle: OutputBundle;
  let ssrEntryFile: string;

  // Generate route manifest from managers
  // This captures route patterns and module paths
  const pageRoutes: Array<{ pattern: string; modulePath: string }> = [];
  for (const [pattern, entry] of routeManager.getRoutes()) {
    pageRoutes.push({
      pattern,
      modulePath: entry.modulePath,
    });
  }

  // Generate API route manifest
  const apiRoutes: Array<{ path: string; filePath: string; methods: string[] }> = [];
  for (const [routePath, route] of apiRouteManager.getRoutes()) {
    apiRoutes.push({
      path: routePath,
      filePath: route.filePath,
      methods: route.methods,
    });
  }

  // Discover layout files by scanning the source directory
  const layoutRoutes: Array<{ pattern: string; modulePath: string }> = [];
  const fsSync = await import("fs");
  const appDir = path.join(root, srcDir, "app");

  async function findLayouts(dir: string, routePrefix: string = "/"): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.match(/^layout\.(tsx?|jsx?)$/)) {
          layoutRoutes.push({
            pattern: routePrefix,
            modulePath: path.join(dir, entry.name),
          });
        } else if (
          entry.isDirectory() &&
          !entry.name.startsWith("_") &&
          !entry.name.startsWith(".")
        ) {
          const subRoute = routePrefix === "/" ? `/${entry.name}` : `${routePrefix}/${entry.name}`;
          await findLayouts(path.join(dir, entry.name), subRoute);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await findLayouts(appDir);

  // Check for custom not-found page
  let notFoundPath: string | null = null;
  const notFoundExtensions = [".tsx", ".jsx", ".ts", ".js"];
  for (const ext of notFoundExtensions) {
    const checkPath = path.join(appDir, `not-found${ext}`);
    try {
      await fs.access(checkPath);
      notFoundPath = checkPath;
      logger.info(`📋 Found custom 404 page: ${checkPath}`);
      break;
    } catch {
      // File doesn't exist, continue checking
    }
  }

  // Sort layouts by depth (root first)
  layoutRoutes.sort((a, b) => {
    const depthA = a.pattern.split("/").filter(Boolean).length;
    const depthB = b.pattern.split("/").filter(Boolean).length;
    return depthA - depthB;
  });

  logger.info(
    `📋 Found ${pageRoutes.length} page routes, ${layoutRoutes.length} layouts, and ${apiRoutes.length} API routes`,
  );

  const hasConfiguredIntegrations = Object.keys(config.integrations || {}).length > 0;
  const configModulePath = hasConfiguredIntegrations ? await findFarmConfigPath(root) : null;

  // Generate virtual entry code that imports and bundles all routes
  // This ensures all route handlers are captured in the bundle closure
  const virtualEntryCode = generateVirtualEntryCode(
    apiRoutes,
    pageRoutes,
    layoutRoutes,
    notFoundPath,
    config,
    configModulePath,
  );

  // Find a temporary file path for the virtual entry
  // We'll use a plugin to intercept this
  const virtualEntryId = "\0virtual:farm-ssr-entry";

  try {
    await viteBuild({
      root,
      build: {
        target: "esnext",
        ssr: true,
        write: false, // ⭐ Keep in memory
        minify: false, // Skip minification for SSR (faster build, Nitro will minify)
        sourcemap: false, // Skip sourcemaps for faster SSR build
        rollupOptions: {
          input: virtualEntryId,
          // Externalize native modules and Node.js built-ins
          external: [
            "fsevents",
            "@prisma/client",
            "@prisma/client/default",
            "@prisma/client/default.js",
            ".prisma/client",
            ".prisma/client/default",
            /^\.prisma\//,
            /\.node$/,
            /^node:/,
          ],
          // Optimize tree-shaking
          treeshake: {
            moduleSideEffects: false,
          },
        },
      },
      // Use esbuild for faster transforms
      esbuild: {
        target: "node18",
        keepNames: true,
      },
      // SSR configuration to externalize problematic modules
      ssr: {
        // Externalize native modules and build tools that can't be bundled
        // These have native binaries that won't work in serverless environments
        external: [
          "fsevents",
          "esbuild",
          "lightningcss",
          "rollup",
          "@rollup/rollup-darwin-arm64",
          "@rollup/rollup-darwin-x64",
          "@rollup/rollup-linux-x64-gnu",
          "@rollup/rollup-linux-x64-musl",
          "@rollup/rollup-linux-arm64-gnu",
          "@rollup/rollup-linux-arm64-musl",
          "@rollup/rollup-win32-x64-msvc",
          "@rollup/rollup-win32-arm64-msvc",
          "@rollup/rollup-win32-ia32-msvc",
          "vite",
          "nitro",
          "nitropack",
          "@prisma/client",
          "@prisma/client/default",
          "@prisma/client/default.js",
          ".prisma/client",
          ".prisma/client/default",
        ],
        // Don't externalize these - bundle them into the SSR output
        // Keep this list minimal for faster builds
        noExternal: ["@farmjs/core", "better-call", "react", "react-dom", "react-dom/server"],
      },
      plugins: [
        farmPlugin(config, pluginManager),
        {
          name: "farm-virtual-ssr-entry",
          resolveId(id) {
            if (id === virtualEntryId || id === "\0virtual:farm-ssr-entry") {
              return virtualEntryId;
            }
            return null;
          },
          load(id) {
            if (id === virtualEntryId) {
              return virtualEntryCode;
            }
            return null;
          },
        },
        {
          name: "capture-ssr-bundle",
          generateBundle(_options, bundle) {
            ssrBundle = bundle;

            // Find entry file
            for (const [fileName, file] of Object.entries(bundle)) {
              if (file.type === "chunk" && file.isEntry) {
                ssrEntryFile = fileName;
                break;
              }
            }

            if (!ssrEntryFile) {
              throw new Error("No entry point found in SSR bundle");
            }
          },
        },
      ],
      mode: "production",
      css: postcssConfigDir
        ? {
            postcss: postcssConfigDir,
          }
        : undefined,
      resolve: {
        alias: {
          "@": path.resolve(root, "src"),
          // Ensure imports can resolve farm modules
          farm: path.resolve(root, "node_modules", "@farmjs", "core", "src"),
        },
      },
    });
  } finally {
    if (postcssConfigDir) {
      try {
        await fs.rm(postcssConfigDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors.
      }
    }
  }

  return { bundle: ssrBundle!, entryFile: ssrEntryFile! };
}

/**
 * Generate virtual entry code that bundles all routes
 * This creates managers at runtime from bundled code
 */
function generateVirtualEntryCode(
  apiRoutes: Array<{ path: string; filePath: string; methods: string[] }>,
  pageRoutes: Array<{ pattern: string; modulePath: string }>,
  layoutRoutes: Array<{ pattern: string; modulePath: string }>,
  notFoundPath: string | null,
  config: ResolvedFarmConfig,
  configModulePath: string | null,
): string {
  // Generate imports for all API routes
  const apiImports: string[] = [];
  const apiRegistrations: string[] = [];

  apiRoutes.forEach((route, index) => {
    const varName = `apiRoute${index}`;
    apiImports.push(`import * as ${varName} from "${route.filePath}";`);
    apiRegistrations.push(`
  {
    path: ${JSON.stringify(route.path)},
    methods: ${JSON.stringify(route.methods)},
    handlers: ${varName},
  }`);
  });

  // Generate imports for all page routes
  const pageImports: string[] = [];
  const pageRegistrations: string[] = [];

  pageRoutes.forEach((route, index) => {
    const varName = `pageRoute${index}`;
    pageImports.push(`import * as ${varName} from "${route.modulePath}";`);
    pageRegistrations.push(`
  {
    pattern: ${JSON.stringify(route.pattern)},
    module: ${varName},
  }`);
  });

  // Generate imports for all layouts
  const layoutImports: string[] = [];
  const layoutRegistrations: string[] = [];

  layoutRoutes.forEach((layout, index) => {
    const varName = `layoutRoute${index}`;
    layoutImports.push(`import * as ${varName} from "${layout.modulePath}";`);
    layoutRegistrations.push(`
  {
    pattern: ${JSON.stringify(layout.pattern)},
    module: ${varName},
  }`);
  });

  // Generate import for custom not-found page if exists
  const notFoundImport = notFoundPath ? `import * as CustomNotFound from "${notFoundPath}";` : "";
  const apiRouteHelpersImport =
    apiRoutes.length > 0
      ? `import { invokeAPIRouteEndpoint, matchAPIRoute } from "farm/api/route-manager";`
      : "";
  const cacheHelpersImport = `import { createFarmCacheKey, getFarmDataCache, normalizeRevalidatePath } from "farm/cache";`;
  const docsHandlerImport = config.docs?.enabled
    ? `import { createFarmDocsAPIHandler, createFarmDocsHandler } from "farm/docs";`
    : "";
  const markdownHandlerImport = config.md?.enabled
    ? `import { createMarkdownMirrorResponse } from "farm/markdown";`
    : "";
  const integrationImports = configModulePath
    ? `
import * as FarmUserConfigModule from "${configModulePath}";
import { dispatchIntegrationRequest, matchIntegrationRoute } from "farm";
`
    : "";
  const apiHandlerCode =
    apiRoutes.length > 0
      ? `
const apiRouteMap = new Map(apiRoutes.map((route) => [route.path, route]));

async function handleAPIRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const match = matchAPIRoute(apiRouteMap, url.pathname);

  if (!match) {
    return null;
  }

  const { route, params } = match;
  const endpoint = route.handlers[method];
  if (!endpoint) {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    return await invokeAPIRouteEndpoint(endpoint, request, params);
  } catch (error) {
    console.error(\`[API Error] \${url.pathname}:\`, error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
`
      : `
async function handleAPIRequest(request) {
  return null;
}
`;

  return `
// Farm.js SSR Entry - Generated at build time
// All routes are bundled here, managers are created at runtime

${apiImports.join("\n")}
${pageImports.join("\n")}
${layoutImports.join("\n")}
${notFoundImport}
${apiRouteHelpersImport}
${cacheHelpersImport}
${docsHandlerImport}
${markdownHandlerImport}
${integrationImports}

// Custom 404 page component (if provided)
const hasCustomNotFound = ${notFoundPath ? "true" : "false"};
const CustomNotFoundComponent = ${notFoundPath ? "CustomNotFound.default || CustomNotFound" : "null"};
const farmUserConfig = ${
    configModulePath ? "(FarmUserConfigModule.default || FarmUserConfigModule)" : "null"
  };
const configuredIntegrations = farmUserConfig?.integrations || {};
const integrationRuntimeConfig = farmUserConfig || {};
const farmMarkdownConfig = ${JSON.stringify(config.md)};
globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = {
  root: ${JSON.stringify(config.root)},
  srcDir: ${JSON.stringify(config.srcDir)},
  docs: ${JSON.stringify(config.docs)},
};
const farmDocsHandler = ${
    config.docs?.enabled
      ? `createFarmDocsHandler(${JSON.stringify(config.docs)}, { root: ${JSON.stringify(config.root)}, srcDir: ${JSON.stringify(config.srcDir)} })`
      : "null"
  };
const farmDocsAPIHandler = ${
    config.docs?.enabled
      ? `createFarmDocsAPIHandler({ rootDir: ${JSON.stringify(config.root)}, srcDir: ${JSON.stringify(config.srcDir)}, docs: ${JSON.stringify(config.docs)} })`
      : "null"
  };

// API routes bundled at build time
const apiRoutes = [${apiRegistrations.join(",")}
];

// Page routes bundled at build time
const pageRoutes = [${pageRegistrations.join(",")}
];

// Layout routes bundled at build time (sorted by depth, root first)
const layoutRoutes = [${layoutRegistrations.join(",")}
];

${apiHandlerCode}

async function handleIntegrationRequest(request) {
  ${
    configModulePath
      ? `const matchedIntegrationRoute = matchIntegrationRoute(configuredIntegrations, {
    pathname: new URL(request.url).pathname,
    method: request.method,
  });

  if (!matchedIntegrationRoute) {
    return null;
  }

  return dispatchIntegrationRequest(
    {
      integration: matchedIntegrationRoute.integration,
      config: integrationRuntimeConfig,
      isDev: false,
      isProd: true,
    },
    request,
  );`
      : "return null;"
  }
}

/**
 * Match URL to page route pattern
 */
function matchPageRoute(pathname) {
  for (const route of pageRoutes) {
    // Convert pattern to regex
    // Handle both [param] and :param formats
    const regexPattern = route.pattern
      .replace(/\\[([^\\]]+)\\]/g, '(?<$1>[^/]+)')   // [id] -> (?<id>[^/]+)
      .replace(/\\/:([^/]+)/g, '/(?<$1>[^/]+)')     // /:id -> /(?<id>[^/]+)
      .replace(/\\//g, '\\\\/');                     // / -> \\/
    
    const regex = new RegExp(\`^\${regexPattern}$\`);
    const match = pathname.match(regex);
    
    if (match) {
      const params = match.groups || {};
      return { route, params };
    }
  }
  return null;
}

/**
 * Get applicable layouts for a page path (from root to most specific)
 */
function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  
  for (const layout of layoutRoutes) {
    // Root layout (/) applies to everything
    // Other layouts apply to their path and sub-paths
    if (layout.pattern === '/' || 
        normalizedPath === layout.pattern || 
        normalizedPath.startsWith(layout.pattern + '/')) {
      applicable.push(layout);
    }
  }
  
  // Sort by depth (root first, then nested)
  applicable.sort((a, b) => {
    const depthA = a.pattern.split('/').filter(Boolean).length;
    const depthB = b.pattern.split('/').filter(Boolean).length;
    return depthA - depthB;
  });
  
  return applicable;
}

const pprShellCache = getFarmDataCache();

function resolvePPRConfig(routeModule) {
  if (!routeModule || routeModule.dynamic === "force-dynamic") {
    return { enabled: false };
  }

  if (routeModule.dynamic === "force-static" || routeModule.dynamic === "error") {
    return { enabled: false };
  }

  const enabled = routeModule.ppr === true || routeModule.experimental_ppr === true;
  const revalidate =
    typeof routeModule.revalidate === "number" && routeModule.revalidate > 0
      ? routeModule.revalidate
      : undefined;

  return { enabled, revalidate };
}

function canCachePPRShell(request) {
  const method = request.method.toUpperCase();
  return (
    (method === "GET" || method === "HEAD") &&
    !request.headers.get("cookie") &&
    !request.headers.get("authorization") &&
    !request.headers.get("x-farm-ppr-refresh")
  );
}

function getPPRShellCacheKey(url) {
  return createFarmCacheKey(["ppr", normalizeRevalidatePath(url.pathname), url.search]);
}

function getPPRHeaders(status, config) {
  const headers = {
    "X-Farm-PPR": status,
  };

  if (status === "bypass") {
    headers["Cache-Control"] = "private, no-store";
    return headers;
  }

  if (typeof config.revalidate === "number" && config.revalidate > 0) {
    headers["Cache-Control"] = \`s-maxage=\${config.revalidate}, stale-while-revalidate\`;
  }

  return headers;
}

function getCachedPPRShell(cacheKey) {
  const entry = pprShellCache.getEntry(cacheKey);
  if (!entry) {
    return null;
  }

  return entry.value.html;
}

/**
 * Main request handler - created at runtime with bundled routes
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const integrationResponse = await handleIntegrationRequest(request.clone());
  if (integrationResponse) {
    return integrationResponse;
  }

  if (farmDocsHandler) {
    const docsResponse = await farmDocsHandler(request.clone());
    if (docsResponse) {
      return docsResponse;
    }
  }

  if (farmMarkdownConfig?.enabled) {
    const markdownResponse = await createMarkdownMirrorResponse({
      request: request.clone(),
      config: farmMarkdownConfig,
      routeExists: (targetPathname) => Boolean(matchPageRoute(targetPathname)),
      renderPage: (targetRequest) => handleRequest(targetRequest),
    });
    if (markdownResponse) {
      return markdownResponse;
    }
  }

  // Handle API routes
  if (pathname.startsWith("/api/")) {
    const apiResponse = await handleAPIRequest(request.clone());
    if (apiResponse) {
      return apiResponse;
    }

    if (farmDocsAPIHandler) {
      const docsAPIResponse = await farmDocsAPIHandler(request.clone());
      if (docsAPIResponse) {
        return docsAPIResponse;
      }
    }

    return new Response(
      JSON.stringify({ error: "API route not found", pathname }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // Handle page routes (SSR)
  const matchedRoute = matchPageRoute(pathname);
  if (matchedRoute) {
    const { route, params } = matchedRoute;
    
    try {
      const pprConfig = resolvePPRConfig(route.module);
      const pprCanCache = pprConfig.enabled && canCachePPRShell(request);
      const pprCacheKey = pprCanCache ? getPPRShellCacheKey(url) : null;
      if (pprCacheKey) {
        const cachedPPRShell = getCachedPPRShell(pprCacheKey);
        if (cachedPPRShell) {
          return new Response(cachedPPRShell, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              ...getPPRHeaders("hit", pprConfig),
            },
          });
        }
      }

      // Get the page component and metadata
      const PageComponent = route.module.default;
      const pageMetadata = route.module.metadata || {};
      
      // Get applicable layouts for this page
      const applicableLayouts = getApplicableLayouts(pathname);
      
      if (PageComponent) {
        // Parse search params - make it a resolved Promise for async components
        const searchParamsObj = Object.fromEntries(url.searchParams.entries());
        
        // Import React SSR utilities
        const ReactDOMServer = await import("react-dom/server");
        const React = await import("react");
        
        // For async components, searchParams should be a resolved Promise
        const searchParams = Promise.resolve(searchParamsObj);
        
        // Render the page component
        const pageProps = { params, searchParams };
        
        // First, render the page content
        let pageElement;
        
        // Check if the component is async
        if (PageComponent.constructor.name === "AsyncFunction" || PageComponent.toString().includes("async")) {
          // For async components, execute to get the element
          try {
            const result = await PageComponent(pageProps);
            if (React.isValidElement(result)) {
              pageElement = result;
            } else {
              pageElement = React.createElement("div", null, String(result));
            }
          } catch (asyncError) {
            // If async rendering fails, try sync rendering as fallback
            pageElement = React.createElement(PageComponent, pageProps);
          }
        } else {
          // Sync component - create element directly
          pageElement = React.createElement(PageComponent, pageProps);
        }
        
        // Wrap with layouts (from innermost to outermost)
        // Layouts are sorted by depth (root first), so we process in reverse
        let wrappedElement = pageElement;
        for (let i = applicableLayouts.length - 1; i >= 0; i--) {
          const layout = applicableLayouts[i];
          const LayoutComponent = layout.module.default;
          if (LayoutComponent) {
            wrappedElement = React.createElement(LayoutComponent, { children: wrappedElement, params });
          }
        }
        
        // Render to string
        const html = ReactDOMServer.renderToString(wrappedElement);
        
        // Collect metadata from layouts and page (page overrides layouts)
        let mergedMetadata = {};
        for (const layout of applicableLayouts) {
          if (layout.module.metadata) {
            mergedMetadata = { ...mergedMetadata, ...layout.module.metadata };
          }
        }
        mergedMetadata = { ...mergedMetadata, ...pageMetadata };
        
        // Build page title and meta tags from merged metadata
        const title = mergedMetadata.title || "Farm.js App";
        const description = mergedMetadata.description || "";
        
        let metaTags = "";
        if (description) {
          metaTags += \`\\n  <meta name="description" content="\${description.replace(/"/g, '&quot;')}">\`;
        }
        if (mergedMetadata.keywords) {
          const keywords = Array.isArray(mergedMetadata.keywords) ? mergedMetadata.keywords.join(", ") : mergedMetadata.keywords;
          metaTags += \`\\n  <meta name="keywords" content="\${keywords.replace(/"/g, '&quot;')}">\`;
        }
        if (mergedMetadata.openGraph) {
          const og = mergedMetadata.openGraph;
          if (og.title) metaTags += \`\\n  <meta property="og:title" content="\${og.title.replace(/"/g, '&quot;')}">\`;
          if (og.description) metaTags += \`\\n  <meta property="og:description" content="\${og.description.replace(/"/g, '&quot;')}">\`;
          if (og.image) metaTags += \`\\n  <meta property="og:image" content="\${og.image}">\`;
        }
        
        // Check if the layout already rendered a full HTML document
        const trimmedHtml = html.trim();
        const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');
        
        let fullHtml;
        if (hasFullDocument) {
          // Layout provides full HTML structure - inject CSS and client script
          fullHtml = html
            // Inject CSS link after opening head tag or first meta tag
            .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/farm-client.css">')
            // Inject title if not present and we have one
            .replace(/<head([^>]*)>([\\s\\S]*?)<\\/head>/i, (match, attrs, headContent) => {
              if (!headContent.includes('<title>') && title !== "Farm.js App") {
                return \`<head\${attrs}>\${headContent}\\n  <title>\${title}</title>\\n</head>\`;
              }
              return match;
            })
            // Inject client script before closing body tag
            .replace(/<\\/body>/i, '  <script type="module" src="/farm-client.js"></script>\\n</body>');
          
          // Add DOCTYPE if not present
          if (!fullHtml.trim().startsWith('<!DOCTYPE')) {
            fullHtml = '<!DOCTYPE html>\\n' + fullHtml;
          }
        } else {
          // No layout with full document - wrap in HTML structure
          fullHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>\${title}</title>\${metaTags}
  <link rel="stylesheet" href="/farm-client.css">
</head>
<body>
  <div id="root">\${html}</div>
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
        }
        
        // Include client CSS and hydration script
        // Add caching headers for edge caching (Vercel, Cloudflare, etc.)
        // s-maxage: cache at edge for 60s, stale-while-revalidate: serve stale while updating
        const responseHeaders = {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
          ...(pprConfig.enabled ? getPPRHeaders(pprCanCache ? "miss" : "bypass", pprConfig) : {}),
        };

        if (pprCacheKey && request.method.toUpperCase() !== "HEAD") {
          pprShellCache.set(
            pprCacheKey,
            { html: fullHtml },
            {
              paths: [pathname],
              tags: ["ppr"],
              revalidate: pprConfig.revalidate ?? false,
            }
          );
        }

        return new Response(
          fullHtml,
          { 
            status: 200, 
            headers: responseHeaders
          }
        );
      }
    } catch (error) {
      console.error("SSR Error:", error);
      return new Response(
        \`<html><body><h1>Error</h1><p>\${error.message}</p><pre>\${error.stack}</pre></body></html>\`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }
  }

  // 404 fallback - render proper HTML page
  try {
    const ReactDOMServer = await import("react-dom/server");
    const React = await import("react");
    
    // Default 404 page component
    function Default404Page() {
      return React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#f9fafb",
          padding: "20px",
          textAlign: "center",
        }
      },
        React.createElement("div", {
          style: {
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "48px",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            maxWidth: "500px",
            width: "100%",
          }
        },
          React.createElement("h1", {
            style: {
              fontSize: "96px",
              fontWeight: "bold",
              color: "#22c55e",
              margin: "0 0 16px 0",
              lineHeight: "1",
            }
          }, "404"),
          React.createElement("h2", {
            style: {
              fontSize: "24px",
              fontWeight: "600",
              color: "#1f2937",
              margin: "0 0 16px 0",
            }
          }, "Page Not Found"),
          React.createElement("p", {
            style: {
              fontSize: "16px",
              color: "#6b7280",
              margin: "0 0 24px 0",
            }
          }, "The page ", React.createElement("code", {
            style: { backgroundColor: "#f3f4f6", padding: "2px 6px", borderRadius: "4px" }
          }, pathname), " doesn't exist."),
          React.createElement("a", {
            href: "/",
            style: {
              display: "inline-block",
              backgroundColor: "#22c55e",
              color: "white",
              padding: "12px 24px",
              borderRadius: "8px",
              textDecoration: "none",
              fontWeight: "500",
            }
          }, "Go Home")
        ),
        React.createElement("p", {
          style: {
            marginTop: "24px",
            fontSize: "14px",
            color: "#9ca3af",
          }
        }, "Powered by Farm.js")
      );
    }
    
    // Use custom 404 page if provided, otherwise use default
    const NotFoundPage = hasCustomNotFound && CustomNotFoundComponent ? CustomNotFoundComponent : Default404Page;
    
    // Wrap 404 page with root layout if available
    let notFoundElement = React.createElement(NotFoundPage, { pathname: pathname });
    const applicableLayouts = getApplicableLayouts("/");
    
    // Wrap with layouts (from innermost to outermost)
    for (let i = applicableLayouts.length - 1; i >= 0; i--) {
      const layout = applicableLayouts[i];
      const LayoutComponent = layout.module.default;
      if (LayoutComponent) {
        notFoundElement = React.createElement(LayoutComponent, { children: notFoundElement, params: {} });
      }
    }
    
    const html = ReactDOMServer.renderToString(notFoundElement);
    
    // Check if layout provides full HTML document
    const trimmedHtml = html.trim();
    const hasFullDocument = trimmedHtml.startsWith('<html') || trimmedHtml.startsWith('<!DOCTYPE');
    
    let fullHtml;
    if (hasFullDocument) {
      fullHtml = html
        .replace(/<head([^>]*)>/i, '<head$1>\\n  <link rel="stylesheet" href="/farm-client.css">')
        .replace(/<\\/body>/i, '  <script type="module" src="/farm-client.js"></script>\\n</body>');
      if (!fullHtml.trim().startsWith('<!DOCTYPE')) {
        fullHtml = '<!DOCTYPE html>\\n' + fullHtml;
      }
    } else {
      fullHtml = \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/farm-client.css">
  <title>404 - Page Not Found</title>
</head>
<body>
  <div id="root">\${html}</div>
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`;
    }
    
    return new Response(fullHtml, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  } catch (error) {
    console.error("404 render error:", error);
    return new Response(
      \`<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 - Page Not Found</h1><p>The page \${pathname} doesn't exist.</p><a href="/">Go Home</a></body></html>\`,
      { status: 404, headers: { "Content-Type": "text/html" } }
    );
  }
}

// Export as Web Standard fetch API
export const fetch = handleRequest;
export default { fetch };
  `.trim();
}

/**
 * Build with Nitro using virtual bundle
 * Routes are now bundled in the SSR entry, so we just need to wrap the handler
 */
async function buildNitroUniversal(
  config: ResolvedFarmConfig,
  routeManager: RouteManager,
  apiRouteManager: APIRouteManager,
  serverRenderer: ServerRenderer,
  preset: string,
  root: string,
  distDir: string,
  ssrBundle: OutputBundle,
  ssrEntryFile: string,
  clientOutputDir: string,
  pluginManager?: PluginManager,
) {
  const fs = await import("fs/promises");

  const isVercel = preset === "vercel" || preset === "vercel-edge";
  const outputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const ssrOutputDir = path.join(root, distDir, "ssr");

  logger.info(`📦 Nitro output directory: ${outputDir}`);
  logger.info(`📦 SSR entry file: ${ssrEntryFile}`);
  logger.info(`📦 Preset: ${preset}`);

  // Write SSR bundle to disk
  await fs.mkdir(ssrOutputDir, { recursive: true });

  for (const [fileName, content] of Object.entries(ssrBundle)) {
    const chunk = content as Rollup.OutputChunk | Rollup.OutputAsset;
    if (chunk.type === "chunk") {
      const filePath = path.join(ssrOutputDir, fileName);
      // Ensure parent directory exists for nested files like assets/foo.js
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(filePath, chunk.code);
    }
  }

  // Create entry that wraps the SSR handler with h3's fromWebHandler
  const nitroEntryPath = path.join(ssrOutputDir, "nitro-entry.mjs");

  const nitroEntryCode = `
// Farm.js Nitro Entry
// This file imports h3 and the SSR handler, wrapping it for Nitro

import { fromWebHandler } from 'h3'
import handler from './${ssrEntryFile}'

// Export the wrapped handler for Nitro
export default fromWebHandler(handler.fetch)
  `.trim();

  await fs.writeFile(nitroEntryPath, nitroEntryCode);

  let nitroConfig: NitroConfig = {
    preset,
    rootDir: root,
    srcDir: root,
    buildDir: path.join(root, distDir, ".nitro"),
    compatibilityDate: "2024-12-01",
    output: {
      dir: outputDir,
      serverDir: path.join(outputDir, "server"),
      publicDir: path.join(outputDir, "public"),
    },
    publicAssets: [
      {
        dir: clientOutputDir,
        maxAge: 31536000,
        baseURL: "/",
      },
    ],
    // Use serverHandlers to define our catch-all handler
    // This bundles the code properly
    handlers: [
      {
        route: "/**",
        handler: nitroEntryPath,
      },
    ],
    routeRules: {
      "/api/**": {
        cors: true,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*",
          "Access-Control-Allow-Headers": "*",
        },
      },
      "/**": {
        prerender: false,
      },
    },
    externals: {
      external: [
        "react",
        "react-dom",
        "@prisma/client",
        "@prisma/client/default",
        "@prisma/client/default.js",
        ".prisma/client",
        ".prisma/client/default",
        "better-sqlite3",
      ],
    },
    rollupConfig: {
      external: isNitroRollupExternal,
    },
    minify: true, // Enable minification for smaller bundles
    sourceMap: false, // Skip sourcemaps for faster build
  };

  if (pluginManager) {
    nitroConfig = await pluginManager.runHookSerial("beforeNitroBuild", nitroConfig);
  }

  // Build with Nitro
  const nitroInstance = await nitro.createNitro(nitroConfig);
  await nitro.prepare(nitroInstance);
  await nitro.copyPublicAssets(nitroInstance);
  await nitro.build(nitroInstance);
  await nitroInstance.close();

  if (pluginManager) {
    await pluginManager.runHookParallel("afterNitroBuild", {
      root,
      preset,
      distDir,
      outputDir,
    });
  }

  // Post-process for Vercel Build Output API v3
  // Move server/ to functions/__nitro.func/ and update config.json
  if (isVercel) {
    await postProcessVercelOutput(root, outputDir, fs);
  }

  logger.success(`✅ Nitro build completed with preset: ${preset}`);
}

/**
 * Post-process Vercel output to match Build Output API v3
 * Moves server/ to functions/__nitro.func/ and updates routes
 */
async function postProcessVercelOutput(
  root: string,
  outputDir: string,
  fs: typeof import("fs/promises"),
) {
  const serverDir = path.join(outputDir, "server");
  const functionsDir = path.join(outputDir, "functions");
  const nitroFuncDir = path.join(functionsDir, "__nitro.func");
  const staticDir = path.join(outputDir, "static");
  const publicDir = path.join(outputDir, "public");

  // Create functions directory
  await fs.mkdir(nitroFuncDir, { recursive: true });

  // Move server contents to functions/__nitro.func/
  const serverContents = await fs.readdir(serverDir);
  for (const file of serverContents) {
    const src = path.join(serverDir, file);
    const dest = path.join(nitroFuncDir, file);
    await fs.rename(src, dest);
  }

  // Remove empty server directory
  await fs.rmdir(serverDir);

  // Rename public to static (Vercel expects static files in static/)
  try {
    await fs.rename(publicDir, staticDir);
  } catch {
    // public might not exist
  }

  // Update config.json routes to point to the function
  const configPath = path.join(outputDir, "config.json");
  const configContent = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configContent);

  // Update routes to use the correct function path
  config.routes = [
    // Serve static files first
    {
      handle: "filesystem",
    },
    // API routes
    {
      src: "/api/(.*)",
      dest: "/__nitro",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
      },
    },
    // All other routes go to the serverless function
    {
      src: "/(.*)",
      dest: "/__nitro",
    },
  ];

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  await copyPrismaClientForVercel(root, nitroFuncDir, fs);

  logger.info("✅ Post-processed Vercel output for Build Output API v3");
}

async function copyPrismaClientForVercel(
  root: string,
  nitroFuncDir: string,
  fs: typeof import("fs/promises"),
) {
  const projectRequire = createRequire(path.join(root, "package.json"));

  let prismaClientDir: string;
  try {
    prismaClientDir = path.dirname(projectRequire.resolve("@prisma/client/default.js"));
  } catch {
    return;
  }

  const generatedClientDir = path.join(prismaClientDir, "..", "..", ".prisma", "client");

  try {
    await fs.access(generatedClientDir);
  } catch {
    return;
  }

  const targetNodeModules = path.join(nitroFuncDir, "node_modules");
  const targetPrismaScopeDir = path.join(targetNodeModules, "@prisma");
  const targetGeneratedDir = path.join(targetNodeModules, ".prisma", "client");
  const targetClientDir = path.join(targetPrismaScopeDir, "client");

  await fs.mkdir(targetPrismaScopeDir, { recursive: true });
  await fs.cp(prismaClientDir, targetClientDir, { recursive: true, force: true });
  await fs.cp(generatedClientDir, targetGeneratedDir, { recursive: true, force: true });

  const functionPackagePath = path.join(nitroFuncDir, "package.json");
  const clientPackagePath = path.join(prismaClientDir, "package.json");
  const [functionPackageContent, clientPackageContent] = await Promise.all([
    fs.readFile(functionPackagePath, "utf-8"),
    fs.readFile(clientPackagePath, "utf-8"),
  ]);
  const functionPackage = JSON.parse(functionPackageContent);
  const clientPackage = JSON.parse(clientPackageContent);

  functionPackage.dependencies = {
    ...functionPackage.dependencies,
    "@prisma/client": clientPackage.version,
  };

  await fs.writeFile(functionPackagePath, JSON.stringify(functionPackage, null, 2));
}
