import type { ResolvedFarmConfig } from "../config";
import type { RouteManager } from "../routing/route-manager";
import type { APIRouteManager } from "../api/route-manager";
import type { ServerRenderer } from "../server/renderer";
import { build as viteBuild, type Rollup } from "vite";
import * as nitro from "nitro";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils";
import { virtualBundlePlugin } from "./virtual-bundle-plugin";
import type { NitroConfig } from "nitro/config";

// Type alias for OutputBundle
type OutputBundle = Rollup.OutputBundle;

// Get __dirname equivalent for ESM
const _filename = typeof import.meta.url !== "undefined" 
  ? fileURLToPath(import.meta.url) 
  : "";
const _dirname = path.dirname(_filename);

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
  } = {},
): Promise<void> {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";

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

    const clientOutputDir = path.join(root, distDir, "client");

    // Step 1 & 2: Build client and SSR bundles IN PARALLEL for faster builds
    logger.info("📦 Building client and SSR bundles in parallel...");
    const [_, ssrResult] = await Promise.all([
      // Client build (to disk)
      buildClient(config, root, srcDir, clientOutputDir, pageRoutes),
      // SSR build (in memory)
      buildSSRInMemory(
        config,
        root,
        srcDir,
        routeManager,
        apiRouteManager,
        serverRenderer,
      ),
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
    );

    logger.success("✅ Build completed successfully!");
    logger.info(`📁 Output directory: ${path.join(root, distDir, ".output")}`);
  } catch (error) {
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
) {
  const { farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");
  const fs = await import("fs/promises");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });

  // Detect which pages are "use client" components
  const clientPages: Array<{ pattern: string; modulePath: string; relativePath: string }> = [];
  
  for (const route of pageRoutes) {
    try {
      const content = await fs.readFile(route.modulePath, "utf-8");
      // Check for "use client" directive (can be at the start or after whitespace/comments)
      const trimmedContent = content.trimStart();
      const isClient = trimmedContent.startsWith("'use client'") || 
                       trimmedContent.startsWith('"use client"') ||
                       trimmedContent.startsWith("'use client';") ||
                       trimmedContent.startsWith('"use client";');
      if (isClient) {
        const relativePath = route.modulePath.replace(root, "").replace(/^\//, "");
        clientPages.push({ ...route, relativePath });
        logger.info(`📱 Found client component: ${route.pattern} -> ${route.modulePath}`);
      }
    } catch (error) {
      // Log error but continue
      logger.warn(`⚠️  Could not read route file ${route.modulePath}: ${error}`);
    }
  }
  
  logger.info(`📱 Total client components detected: ${clientPages.length} out of ${pageRoutes.length} pages`);

  // Generate client hydration entry code
  const clientHydrationCode = generateClientHydrationEntry(clientPages, root, srcDir);
  
  // Write the client entry to a temporary file
  const clientEntryPath = path.join(root, srcDir, ".farm-client-entry.tsx");
  await fs.writeFile(clientEntryPath, clientHydrationCode);

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
            if (id.startsWith("node:") || ["path", "url", "fs", "fs/promises", "os", "crypto", "http", "https", "net", "stream", "util", "events", "child_process", "module", "tty", "dns"].includes(id)) {
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
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
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
      await fs.unlink(clientEntryPath);
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
  root: string,
  srcDir: string,
): string {
  // Always import global CSS for Tailwind
  const cssImport = `import "./app/globals.css";`;
  
  if (clientPages.length === 0) {
    // No client pages - just basic runtime with CSS
    return `
// Farm.js Client Runtime (no client components)
${cssImport}
console.log("[Farm.js] Client loaded (server-only mode)");
`.trim();
  }

  // Generate imports for client components
  const imports: string[] = [];
  const routeEntries: string[] = [];

  // Client entry is at srcDir/.farm-client-entry.tsx, so calculate relative paths from there
  const clientEntryDir = path.join(root, srcDir);

  clientPages.forEach((page, index) => {
    // Calculate relative path from client entry directory to the page module
    const relativePath = path.relative(clientEntryDir, page.modulePath);
    // Convert to forward-slash path for cross-platform compatibility and ensure it starts with ./
    const importPath = "./" + relativePath.replace(/\\/g, "/");
    imports.push(`import Page${index} from "${importPath}";`);
    routeEntries.push(`  { pattern: ${JSON.stringify(page.pattern)}, Component: Page${index} },`);
  });

  return `
// Import global CSS for Tailwind
import "./app/globals.css";

import React from "react";
import { hydrateRoot, createRoot } from "react-dom/client";

// Import client components
${imports.join("\n")}

// Client page routes
const clientRoutes = [
${routeEntries.join("\n")}
];

// ⭐ Keep reference to React root for SPA navigation
let reactRoot = null;
let currentPathname = null;
let isHydrated = false;

/**
 * Match pathname to route pattern
 */
function matchRoute(pathname) {
  for (const route of clientRoutes) {
    // Convert pattern to regex for matching
    // Handle both [param] and :param syntax
    let regexPattern = route.pattern
      .replace(new RegExp("\\\\[([^\\\\]]+)\\\\]", "g"), "(?<$1>[^/]+)")  // [id] -> (?<id>[^/]+)
      .replace(new RegExp("\\\\/:([^/]+)", "g"), "/(?<$1>[^/]+)")     // /:id -> /(?<id>[^/]+)
      .replace(new RegExp("/", "g"), "\\\\/");                      // Escape forward slashes
    
    const regex = new RegExp("^" + regexPattern + "$");
    const match = pathname.match(regex);
    
    if (match) {
      return { route, params: match.groups || {} };
    }
  }
  return null;
}

/**
 * Create page props from current URL
 */
function createPageProps(params) {
  const searchParams = Object.fromEntries(
    new URLSearchParams(window.location.search).entries()
  );
  return {
    params: params || {},
    searchParams: Promise.resolve(searchParams),
  };
}

/**
 * Navigate to a new route (client-side SPA navigation)
 * Called when popstate event fires (back/forward buttons or Link clicks)
 */
function navigateTo(pathname) {
  // Skip if same path (prevents unnecessary re-renders)
  if (pathname === currentPathname) return;

  const matched = matchRoute(pathname);

  if (!matched) {
    // Route not found in client bundle - fall back to full page navigation
    // This handles server-only routes or routes not bundled for client
    console.log("[Farm.js] Route not in client bundle, falling back to server navigation:", pathname);
    window.location.href = pathname + window.location.search;
    return;
  }

  currentPathname = pathname;
  const { route, params } = matched;
  const pageProps = createPageProps(params);

  // Ensure we have a container
  const container = document.getElementById("root");
  if (!container) {
    console.error("[Farm.js] Root container not found during navigation");
    window.location.href = pathname + window.location.search;
    return;
  }

  // ⭐ Re-render with new component (smooth SPA transition!)
  try {
    if (reactRoot) {
      // Use render method for navigation (works with both hydrateRoot and createRoot)
      reactRoot.render(React.createElement(route.Component, pageProps));
      console.log("[Farm.js] SPA navigated to:", pathname);
    } else {
      // If root doesn't exist yet, create it and render
      reactRoot = createRoot(container);
      reactRoot.render(React.createElement(route.Component, pageProps));
      console.log("[Farm.js] Created root and navigated to:", pathname);
    }
    
    // Scroll to top on navigation (like traditional page loads)
    window.scrollTo(0, 0);
  } catch (error) {
    console.error("[Farm.js] Failed to navigate:", error);
    // Fallback to full page navigation
    window.location.href = pathname + window.location.search;
  }
}

/**
 * Initial hydration - attaches React to server-rendered HTML
 */
async function hydrate() {
  if (isHydrated) return;
  isHydrated = true;

  const container = document.getElementById("root");
  if (!container) {
    console.error("[Farm.js] Root container not found");
    return;
  }

  const pathname = window.location.pathname;
  currentPathname = pathname;
  const matched = matchRoute(pathname);

  if (!matched) {
    console.log("[Farm.js] No client component for this route (server-rendered only):", pathname);
    // ⭐ Still create a root for future navigation to client routes
    // This ensures SPA navigation works even when starting from a server-only route
    try {
      reactRoot = createRoot(container);
      // Keep the existing server-rendered content, don't replace it
      console.log("[Farm.js] Set up root for future client navigation");
    } catch (error) {
      console.error("[Farm.js] Failed to create root:", error);
    }
    return;
  }

  const { route, params } = matched;
  const pageProps = createPageProps(params);

  try {
    // ⭐ Use hydrateRoot for initial hydration (attaches to existing DOM)
    reactRoot = hydrateRoot(
      container,
      React.createElement(route.Component, pageProps)
    );
    console.log("[Farm.js] Hydrated:", pathname);
  } catch (error) {
    console.error("[Farm.js] Hydration error:", error);
    // Fallback: try client-side render if hydration fails
    try {
      reactRoot = createRoot(container);
      reactRoot.render(React.createElement(route.Component, pageProps));
      console.log("[Farm.js] Client-side rendered (hydration fallback):", pathname);
    } catch (renderError) {
      console.error("[Farm.js] Render error:", renderError);
    }
  }
}

// ⭐ Listen for navigation events (back/forward buttons + Link clicks)
window.addEventListener("popstate", () => {
  navigateTo(window.location.pathname);
});

// Hydrate when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", hydrate);
} else {
  hydrate();
}
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

  logger.info(`📋 Found ${pageRoutes.length} page routes and ${apiRoutes.length} API routes`);

  // Generate virtual entry code that imports and bundles all routes
  // This ensures all route handlers are captured in the bundle closure
  const virtualEntryCode = generateVirtualEntryCode(apiRoutes, pageRoutes, config);

  // Find a temporary file path for the virtual entry
  // We'll use a plugin to intercept this
  const virtualEntryId = "\0virtual:farm-ssr-entry";

  await viteBuild({
    root,
    build: {
      ssr: true,
      write: false, // ⭐ Keep in memory
      minify: false, // Skip minification for SSR (faster build, Nitro will minify)
      sourcemap: false, // Skip sourcemaps for faster SSR build
      rollupOptions: {
        input: virtualEntryId,
        // Externalize native modules and Node.js built-ins
        external: [
          "fsevents",
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
      ],
      // Don't externalize these - bundle them into the SSR output
      // Keep this list minimal for faster builds
      noExternal: [
        "@farmjs/core",
        "better-call",
        "react",
        "react-dom",
        "react-dom/server",
      ],
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
    resolve: {
      alias: {
        // Ensure imports can resolve farm modules
        farm: path.resolve(root, "node_modules", "@farmjs", "core", "src"),
      },
    },
  });

  return { bundle: ssrBundle!, entryFile: ssrEntryFile! };
}

/**
 * Generate virtual entry code that bundles all routes
 * This creates managers at runtime from bundled code
 */
function generateVirtualEntryCode(
  apiRoutes: Array<{ path: string; filePath: string; methods: string[] }>,
  pageRoutes: Array<{ pattern: string; modulePath: string }>,
  config: ResolvedFarmConfig,
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

  return `
// Farm.js SSR Entry - Generated at build time
// All routes are bundled here, managers are created at runtime

${apiImports.join("\n")}
${pageImports.join("\n")}

// API routes bundled at build time
const apiRoutes = [${apiRegistrations.join(",")}
];

// Page routes bundled at build time
const pageRoutes = [${pageRegistrations.join(",")}
];

// Create better-call router at runtime from bundled handlers
import { createRouter } from "better-call";

function createAPIHandler() {
  const allEndpoints = {};
  
  for (const route of apiRoutes) {
    for (const method of route.methods) {
      const handler = route.handlers[method];
      if (handler) {
        // Set path on handler for better-call
        if (!handler.__path) {
          handler.__path = route.path;
        }
        const key = \`\${method.toLowerCase()}_\${route.path.replace(/\\//g, "_").replace(/-/g, "_")}\`;
        allEndpoints[key] = handler;
      }
    }
  }
  
  if (Object.keys(allEndpoints).length > 0) {
    const router = createRouter(allEndpoints, { basePath: "" });
    return router.handler;
  }
  
  return null;
}

// Create the API handler at runtime
const apiHandler = createAPIHandler();

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
 * Main request handler - created at runtime with bundled routes
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Handle API routes
  if (pathname.startsWith("/api/")) {
    if (apiHandler) {
      try {
        return await apiHandler(request);
      } catch (error) {
        return new Response(
          JSON.stringify({ error: error.message || "Internal Server Error" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
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
      // Get the page component
      const PageComponent = route.module.default;
      
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
        
        let html = "";
        
        // Check if the component is async
        if (PageComponent.constructor.name === "AsyncFunction" || PageComponent.toString().includes("async")) {
          // For async components, we need to render them differently
          // First, execute the async component to get the element
          try {
            const result = await PageComponent(pageProps);
            if (React.isValidElement(result)) {
              html = ReactDOMServer.renderToString(result);
            } else {
              html = ReactDOMServer.renderToString(React.createElement("div", null, String(result)));
            }
          } catch (asyncError) {
            // If async rendering fails, try sync rendering as fallback
            const element = React.createElement(PageComponent, pageProps);
            html = ReactDOMServer.renderToString(element);
          }
        } else {
          // Sync component - use standard renderToString
          const element = React.createElement(PageComponent, pageProps);
          html = ReactDOMServer.renderToString(element);
        }
        
        // Include client CSS and hydration script
        return new Response(
          \`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Farm.js App</title>
  <link rel="stylesheet" href="/farm-client.css">
</head>
<body>
  <div id="root">\${html}</div>
  <script type="module" src="/farm-client.js"></script>
</body>
</html>\`,
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
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

  // 404 fallback
  return new Response(
    JSON.stringify({
      error: "Not Found",
      pathname,
      availableRoutes: pageRoutes.map(r => r.pattern),
      availableAPIRoutes: apiRoutes.map(r => r.path),
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
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
) {
  const fs = await import("fs/promises");
  
  // For Vercel preset, output to .vercel/output/ (Vercel Build Output API)
  // For other presets, output to .farm/.output/
  const isVercel = preset === "vercel" || preset === "vercel-edge";
  const outputDir = isVercel 
    ? path.join(root, ".vercel", "output")
    : path.join(root, distDir, ".output");
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

  const nitroConfig: NitroConfig = {
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
    minify: true, // Enable minification for smaller bundles
    sourceMap: false, // Skip sourcemaps for faster build
  };

  // Build with Nitro
  const nitroInstance = await nitro.createNitro(nitroConfig);
  await nitro.prepare(nitroInstance);
  await nitro.copyPublicAssets(nitroInstance);
  await nitro.build(nitroInstance);
  await nitroInstance.close();

  // Post-process for Vercel Build Output API v3
  // Move server/ to functions/__nitro.func/ and update config.json
  if (isVercel) {
    await postProcessVercelOutput(outputDir, fs);
  }

  logger.success(`✅ Nitro build completed with preset: ${preset}`);
}

/**
 * Post-process Vercel output to match Build Output API v3
 * Moves server/ to functions/__nitro.func/ and updates routes
 */
async function postProcessVercelOutput(
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

  logger.info("✅ Post-processed Vercel output for Build Output API v3");
}
