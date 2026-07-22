import type { ResolvedFarmConfig } from "../config";
import { resolveDeployOutputPath } from "../config";
import type { ViteDevServer } from "vite";
import path from "path";
import { logger } from "../utils";
import { createFarmApp } from "../app";
import { APIRouteManager } from "../api/route-manager";
import { getFarmAppDirectories } from "../layers";
import { buildUniversal } from "../nitro/universal-build";
import { getFarmDocsRouteTypeEntries } from "../docs";
import { generateFarmTypeArtifacts } from "../type-artifacts";
import { PluginManager } from "../plugin";
import { farmEnvironmentFunctionsPlugin } from "../environment-vite";
import { mergeFarmViteConfig } from "../server/vite-config";
import {
  canUseRolldownForRouteDiscovery,
  loadFarmProductionVite,
  type FarmProductionViteRuntime,
} from "./production-vite";

interface BuildOptions {
  preset?: string;
  root?: string;
  universal?: boolean; // Use universal build pattern (TanStack Start style)
  /** @internal Production Vite preload started by the CLI. */
  productionVite?: FarmProductionViteRuntime | Promise<FarmProductionViteRuntime>;
}

/**
 * Build Farm.js application for production
 */
export async function build(config: ResolvedFarmConfig, options: BuildOptions = {}) {
  const root = options.root || config.root || process.cwd();
  const preset = options.preset || config.preset || "node-server";
  const srcDir = config.srcDir || "src";
  const distDir = config.distDir || ".farm";
  const deployOutputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const productionViteResultPromise =
    options.universal === false
      ? undefined
      : Promise.allSettled([Promise.resolve(options.productionVite ?? loadFarmProductionVite())]);

  logger.info(`🚜 Building Farm.js application with preset: ${preset}...`);

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);
  let projectModuleServer: ViteDevServer | undefined;

  try {
    await pluginManager.runHookParallel("init");
    await pluginManager.setupPlugins();
    await pluginManager.runHookParallel("beforeBundle", {
      root,
      preset,
      universal: options.universal !== false,
      distDir,
      outputDir: deployOutputDir,
    });

    // Step 1: Initialize Farm app to get route managers
    logger.info("🔍 Discovering routes and API endpoints...");
    const productionViteResult = productionViteResultPromise
      ? (await productionViteResultPromise)[0]
      : undefined;
    if (productionViteResult?.status === "rejected") throw productionViteResult.reason;
    const productionVite = productionViteResult?.value;
    const useProductionViteForDiscovery =
      productionVite && canUseRolldownForRouteDiscovery(config.vite);
    if (productionVite?.builder === "rolldown" && !useProductionViteForDiscovery) {
      logger.info("🔌 Using Vite Rollup for route discovery with custom Vite configuration");
    }
    const createViteServer = useProductionViteForDiscovery
      ? productionVite.createServer
      : (await import("vite")).createServer;
    projectModuleServer = await createProjectModuleServer(createViteServer, config, root);
    const farmApp = createFarmApp(config, projectModuleServer);
    await farmApp.initialize();

    const routeManager = farmApp.getRouteManager();
    const serverRenderer = farmApp.getServerRenderer();

    const typeArtifacts = generateFarmTypeArtifacts({
      root,
      srcDir,
      layers: config.layers,
      extraRoutes: [
        ...(config.openapi?.enabled && config.openapi.route ? [config.openapi.route] : []),
        ...getFarmDocsRouteTypeEntries(config.docs),
      ],
      suppressLintOnLink: config.suppressLintOnLink,
      i18nConfig: config.i18n,
    }).catch(() => {
      // Non-fatal; type generation is for DX only.
    });

    // Type artifacts and API discovery scan independent inputs, so keep them
    // off the critical path by running both after app initialization.
    const apiRouteManager = new APIRouteManager(
      getFarmAppDirectories(config),
      projectModuleServer,
      {
        throwOnLoadError: true,
        i18n: farmApp.getI18nRuntime(),
      },
    );
    const [, apiDiscovery] = await Promise.allSettled([
      typeArtifacts,
      apiRouteManager.discoverRoutes(),
    ]);
    if (apiDiscovery.status === "rejected") throw apiDiscovery.reason;

    // Use universal build pattern if enabled
    if (options.universal !== false) {
      // Default to universal build (new pattern)
      await buildUniversal(config, routeManager, apiRouteManager, serverRenderer, {
        preset,
        root,
        pluginManager,
        productionVite,
      });
    } else {
      const { build: legacyViteBuild } = await import("vite");
      // Legacy build pattern (for backward compatibility)
      // Step 1: Build client bundle with Vite
      logger.info("📦 Building client bundle...");
      await buildClient(legacyViteBuild, config, root, srcDir, path.join(root, distDir, "client"));

      // Step 2: Build SSR bundle with Vite
      logger.info("📦 Building SSR bundle...");
      await buildSSR(legacyViteBuild, config, root, srcDir, path.join(root, distDir, "server"));

      // Step 3: Build with Nitro
      logger.info(`🚀 Building server with Nitro (preset: ${preset})...`);
      await buildNitro(
        config,
        routeManager,
        apiRouteManager,
        serverRenderer,
        preset,
        root,
        distDir,
        pluginManager,
      );
    }

    await pluginManager.runHookParallel("buildEnd");
    await pluginManager.runHookParallel("afterBundle", {
      root,
      preset,
      universal: options.universal !== false,
      distDir,
      outputDir: deployOutputDir,
      success: true,
    });

    logger.success("✅ Build completed successfully!");
    logger.info(`📁 Output directory: ${deployOutputDir}`);
  } catch (error) {
    await pluginManager.runHookParallel("onError", {
      phase: "build",
      error,
      meta: {
        root,
        preset,
      },
    });
    await pluginManager.runHookParallel("afterBundle", {
      root,
      preset,
      universal: options.universal !== false,
      distDir,
      outputDir: deployOutputDir,
      success: false,
    });
    logger.error(`❌ Build failed: ${error}`);
    throw error;
  } finally {
    await projectModuleServer?.close();
  }
}

async function createProjectModuleServer(
  createViteServer: FarmProductionViteRuntime["createServer"],
  config: ResolvedFarmConfig,
  root: string,
): Promise<ViteDevServer> {
  const viteConfig = mergeFarmViteConfig(
    {
      root,
      appType: "custom",
      mode: "production",
      css: {
        postcss: {
          plugins: [],
        },
      },
      plugins: [farmEnvironmentFunctionsPlugin()],
      server: {
        middlewareMode: true,
        hmr: false,
      },
      optimizeDeps: {
        noDiscovery: true,
      },
      logLevel: "silent",
    },
    config.vite,
  );

  return createViteServer({
    ...viteConfig,
    root,
    configFile: false,
    appType: "custom",
    mode: "production",
    esbuild: {
      ...(typeof viteConfig.esbuild === "object" ? viteConfig.esbuild : {}),
      jsxDev: false,
    },
    server: {
      ...viteConfig.server,
      middlewareMode: true,
      hmr: false,
    },
    optimizeDeps: {
      ...viteConfig.optimizeDeps,
      noDiscovery: true,
    },
  });
}

/**
 * Build client bundle
 */
async function buildClient(
  viteBuild: (typeof import("vite"))["build"],
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
) {
  const { farmI18nClientBridgePlugin, farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);

  await viteBuild({
    root,
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(root, srcDir, "app", "page.tsx"),
      },
    },
    plugins: [
      farmI18nClientBridgePlugin(),
      farmPlugin(config, pluginManager),
      farmEnvironmentFunctionsPlugin(),
    ],
    mode: "production",
  });
}

/**
 * Build SSR bundle
 */
async function buildSSR(
  viteBuild: (typeof import("vite"))["build"],
  config: ResolvedFarmConfig,
  root: string,
  srcDir: string,
  outputDir: string,
) {
  const { farmI18nClientBridgePlugin, farmPlugin } = await import("../vite");
  const { PluginManager } = await import("../plugin");

  const pluginManager = new PluginManager({
    config,
    isDev: false,
    isProd: true,
  });
  pluginManager.addPlugins(config.plugins || []);

  // Use server-entry.ts as the SSR entry point for universal builds
  // For legacy builds, use page.tsx directly
  const ssrEntry = path.join(root, srcDir, "app", "page.tsx");

  await viteBuild({
    root,
    build: {
      ssr: true,
      outDir: outputDir,
      emptyOutDir: true,
      rollupOptions: {
        input: ssrEntry,
      },
    },
    define: {
      __FARM_ENV__: JSON.stringify(config.env || { server: {}, public: {} }),
      __FARM_PUBLIC_ENV__: JSON.stringify(config.env?.public || {}),
    },
    plugins: [
      farmI18nClientBridgePlugin(),
      farmPlugin(config, pluginManager),
      farmEnvironmentFunctionsPlugin(),
    ],
    mode: "production",
  });
}

/**
 * Build with Nitro
 */
async function buildNitro(
  config: ResolvedFarmConfig,
  routeManager: any,
  apiRouteManager: APIRouteManager,
  serverRenderer: any,
  preset: string,
  root: string,
  distDir: string,
  pluginManager?: PluginManager,
) {
  const [{ createNitroConfig }, { createNitro, build: nitroBuild }] = await Promise.all([
    import("../nitro"),
    import("nitro"),
  ]);
  let nitroConfig = await createNitroConfig(
    config,
    routeManager,
    apiRouteManager,
    serverRenderer,
    preset,
  );

  if (pluginManager) {
    nitroConfig = await pluginManager.runHookSerial("beforeNitroBuild", nitroConfig);
  }

  // Directory structure:
  // .farm/
  //   ├── client/          - Client-side build output (Vite)
  //   ├── server/          - SSR build output (Vite)
  //   ├── .nitro/          - Nitro's build directory (temporary, where it does its work)
  //   │   └── server/      - Handlers and source files for Nitro
  //   └── .output/         - Final deployable output (this is what gets deployed)
  //       ├── server/      - Serverless function bundles
  //       ├── public/      - Static assets
  //       └── config.json  - Vercel routing config
  //
  // IMPORTANT: Nitro is configured to output to .farm/.output (NOT .nitro/.output)
  // This is ensured by explicitly setting output.dir in the Nitro config
  //
  // Build flow:
  // 1. Vite builds client → .farm/client
  // 2. Vite builds SSR → .farm/server
  // 3. Copy client assets → .farm/.output/public
  // 4. Copy SSR bundles → .farm/.nitro/server/farm
  // 5. Nitro builds from .farm/.nitro → outputs to .farm/.output (via output.dir config)
  // 6. Deploy from .farm/.output

  // Ensure output directory exists before building
  const outputDir = resolveDeployOutputPath(root, config.deploy.outputDir);
  const serverOutputDir = path.join(outputDir, "server");
  const publicOutputDir = path.join(outputDir, "public");
  const { mkdir, cp } = await import("fs/promises");
  await mkdir(serverOutputDir, { recursive: true });
  await mkdir(publicOutputDir, { recursive: true });

  // Copy client assets to public directory for Nitro to serve
  // This ensures Vercel can serve static files from the public directory
  const clientDir = path.join(root, distDir, "client");
  try {
    // Ensure public directory exists
    await mkdir(publicOutputDir, { recursive: true });

    // Copy all client assets including manifest
    await cp(clientDir, publicOutputDir, { recursive: true });
    logger.info("📦 Copied client assets to public directory");

    // Verify important files are present
    const manifestPath = path.join(publicOutputDir, "farm-client-manifest.json");
    const assetsDir = path.join(publicOutputDir, "assets");
    const manifestExists = await import("fs/promises").then((fs) =>
      fs
        .access(manifestPath)
        .then(() => true)
        .catch(() => false),
    );
    const assetsExist = await import("fs/promises").then((fs) =>
      fs
        .access(assetsDir)
        .then(() => true)
        .catch(() => false),
    );

    if (manifestExists && assetsExist) {
      logger.info("✅ Verified client assets are present");
    } else {
      logger.warn("⚠️  Some client assets may be missing");
    }
  } catch (error) {
    logger.error(`❌ Failed to copy client assets: ${error}`);
    throw error;
  }

  // Copy SSR bundles to Nitro server directory so they're included in the build
  // These go into .farm/.nitro/server/farm (build directory)
  // Nitro will then bundle them and output to .farm/.output/server
  const serverDir = path.join(root, distDir, "server");
  const nitroServerDir = path.join(root, distDir, ".nitro", "server", "farm");
  try {
    await mkdir(nitroServerDir, { recursive: true });
    await cp(serverDir, nitroServerDir, { recursive: true });
    logger.info("📦 Copied SSR bundles to Nitro server directory");
  } catch (error) {
    logger.warn(`Could not copy SSR bundles: ${error}`);
  }

  // Create Nitro instance - this handles preset loading and config preparation
  // The createNitro function loads the preset and normalizes the config
  const nitro = await createNitro(nitroConfig);

  // Populate the runtime registry before building
  // This ensures route managers are available at runtime
  // Note: The registry will be populated again in the build:before hook
  // but we also populate it here to ensure it's available
  // Registry file is in .farm/.nitro/server (build directory)
  // But will be bundled and available in .farm/.output/server (output directory)
  const registryPath = path.join(root, distDir, ".nitro", "server", "farm-registry.ts");
  try {
    const { farmRegistry } = await import(/* @vite-ignore */ registryPath);
    farmRegistry.apiRouteManager = apiRouteManager;
    farmRegistry.routeManager = routeManager;
    farmRegistry.serverRenderer = serverRenderer;
    farmRegistry.env = config.env || { server: {}, public: {} };

    // Store route paths for SSR module loading
    const routePaths: Record<string, string> = {};
    for (const [pattern, entry] of routeManager.getRoutes()) {
      const bundledPath = entry.modulePath
        .replace(/.*\/src\/app\//, "")
        .replace(/\.(tsx?|jsx?)$/, ".js");
      routePaths[pattern] = bundledPath;
    }
    farmRegistry.routePaths = routePaths;

    // Load client manifest
    try {
      const clientManifestPath = path.join(root, distDir, "client", "farm-client-manifest.json");
      const { readFile } = await import("fs/promises");
      const manifestContent = await readFile(clientManifestPath, "utf-8");
      farmRegistry.clientManifest = JSON.parse(manifestContent);
    } catch {
      farmRegistry.clientManifest = {};
    }
  } catch (error) {
    logger.warn(`Could not populate registry: ${error}`);
  }

  // Build Nitro with the prepared instance
  await nitroBuild(nitro);

  if (pluginManager) {
    await pluginManager.runHookParallel("afterNitroBuild", {
      root,
      preset,
      distDir,
      outputDir: resolveDeployOutputPath(root, config.deploy.outputDir),
    });
  }
}
