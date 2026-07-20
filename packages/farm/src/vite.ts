import type { ConfigEnv, Plugin, ViteDevServer, HmrContext } from "vite";
import type { FarmConfig } from "./types";
import { FarmApp } from "./app";
import { logger, toViteModuleId } from "./utils";
import { defaultGlobalCSS } from "./default-styles";
import type { PluginManager } from "./plugin";
import { HMRManager } from "./hmr";
import { APIRouteManager } from "./api/route-manager";
import { OpenAPIManager } from "./openapi/manager";
import { MiddlewareManager } from "./middleware/manager";
import { generateFarmTypeArtifacts } from "./type-artifacts";
import {
  isProgrammaticRoutesFileName,
  parseProgrammaticRouteModuleId,
  scanProgrammaticPagePaths,
} from "./routes";
import {
  createFarmDocsAPIHandler,
  createFarmDocsHandler,
  getFarmDocsDocumentNavigationMatchers,
  getFarmDocsRouteTypeEntries,
  isFarmDocsAPIRequest,
} from "./docs";
import {
  generateFarmDocsSearchClientRuntime,
  isFarmDocsSearchEnabled,
  resolveFarmDocsSearchClientModule,
} from "./docs/search-client";
import { createMarkdownMirrorResponse } from "./markdown";
import { createFarmMarkdownSourceResponse, isFarmMarkdownPageFile } from "./app-markdown";
import { sendWebResponse } from "./server/response";
import {
  getClientModuleMetadata,
  hasUseClientDirective,
  stripUseClientDirective,
} from "./utils/client-component";
import {
  dispatchIntegrationRequest,
  getIntegrationDocumentNavigationMatchers,
  getIntegrationProviders,
  matchIntegrationRoute,
} from "./integrations";
import {
  createFarmWorkflowRequestHandler,
  discoverFarmWorkflows,
  resolveWorkflowsConfig,
  type FarmDiscoveredWorkflow,
} from "./workflows";
import { resolveFarmRouteContext, withFarmRouteContext } from "./route-context";
import { createFarmDevtoolsSnapshot } from "./devtools";
import { renderFarmDevtoolsHtml } from "./devtools-ui";
import * as fs from "fs";
import * as path from "path";
import type { FarmUserConfig } from "./config";
import { getFarmAppDirectories, getFarmLayerAliases, getFarmSourceRoots } from "./layers";
import { farmEnvironmentFunctionsPlugin } from "./environment-vite";
import { createDeferredDataResponse } from "./deferred";
import { _withAfterNodeMiddleware } from "./after";
import {
  createFarmDeploymentMismatchResponse,
  FARM_DEPLOYMENT_ID_HEADER,
  getFarmDeploymentMismatch,
} from "./deployment";

interface FarmVitePluginOptions extends FarmConfig {
  openapi?: FarmUserConfig["openapi"];
}

const FARM_CONFIG_FILENAMES = new Set([
  "farm.config.ts",
  "farm.config.tsx",
  "farm.config.mts",
  "farm.config.cts",
  "farm.config.js",
  "farm.config.jsx",
  "farm.config.mjs",
  "farm.config.cjs",
  "config.ts",
  "config.tsx",
  "config.mts",
  "config.cts",
  "config.js",
  "config.jsx",
  "config.mjs",
  "config.cjs",
]);

function getPublicEnvDefine(config: FarmVitePluginOptions): Record<string, unknown> {
  const publicEnv = (config as any).env?.public;
  if (!isResolvedEnvScope(publicEnv)) {
    return {};
  }

  return publicEnv;
}

function createRequestFromNodeRequest(
  req: { method?: string; headers: Record<string, string | string[] | undefined> },
  url: URL,
): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return new Request(url.toString(), {
    method: req.method || "GET",
    headers,
  });
}

function getFullEnvDefine(config: FarmVitePluginOptions): {
  server: Record<string, unknown>;
  public: Record<string, unknown>;
} {
  const env = (config as any).env;
  if (!env || typeof env !== "object") {
    return { server: {}, public: {} };
  }

  return {
    server: isResolvedEnvScope(env.server) ? env.server : {},
    public: isResolvedEnvScope(env.public) ? env.public : {},
  };
}

function getEnvDefines(
  config: FarmVitePluginOptions,
  configEnv?: ConfigEnv,
): Record<string, string> {
  const defines: Record<string, string> = {
    __FARM_PUBLIC_ENV__: JSON.stringify(getPublicEnvDefine(config)),
  };

  if (configEnv?.isSsrBuild) {
    defines.__FARM_ENV__ = JSON.stringify(getFullEnvDefine(config));
  }

  return defines;
}

function isResolvedEnvScope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return !Object.values(value).some(
    (entry) =>
      typeof entry === "function" ||
      (!!entry && typeof entry === "object" && typeof (entry as any).parse === "function"),
  );
}

function isPotentialProgrammaticRouteSourceFile(
  normalizedFile: string,
  srcDirSlug: string,
): boolean {
  return (
    normalizedFile.startsWith(`${srcDirSlug}/`) &&
    /\.(ts|tsx|js|jsx)$/.test(normalizedFile) &&
    !/\.d\.ts$/.test(normalizedFile) &&
    !normalizedFile.endsWith("/farm-routes.d.ts") &&
    !normalizedFile.endsWith("/farm-env.d.ts") &&
    !normalizedFile.endsWith("/lib/api.generated.ts")
  );
}

function fileContainsProgrammaticPageRoute(file: string): boolean {
  if (!fs.existsSync(file)) {
    return false;
  }

  try {
    return scanProgrammaticPagePaths(fs.readFileSync(file, "utf8")).length > 0;
  } catch {
    return false;
  }
}

interface FarmModuleAstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

export function rewriteEarlySsrRelativeImports(options: {
  code: string;
  id: string;
  root: string;
  parse: (code: string) => FarmModuleAstNode;
}): string | null {
  const cleanId = options.id.split("?", 1)[0];
  if (!path.isAbsolute(cleanId) || cleanId.replace(/\\/g, "/").includes("/node_modules/")) {
    return null;
  }

  const replacements: Array<{ start: number; end: number; code: string }> = [];
  let ast: FarmModuleAstNode;
  try {
    ast = options.parse(options.code);
  } catch {
    return null;
  }

  walkModuleAst(ast, (node) => {
    if (
      node.type !== "ImportDeclaration" &&
      node.type !== "ExportNamedDeclaration" &&
      node.type !== "ExportAllDeclaration" &&
      node.type !== "ImportExpression"
    ) {
      return;
    }

    const source = node.source;
    if (!isFarmModuleAstNode(source) || typeof source.value !== "string") return;
    if (!source.value.startsWith(".")) return;

    const suffixIndex = source.value.search(/[?#]/);
    const sourcePath = suffixIndex === -1 ? source.value : source.value.slice(0, suffixIndex);
    const suffix = suffixIndex === -1 ? "" : source.value.slice(suffixIndex);
    const resolvedPath = path.resolve(path.dirname(cleanId), sourcePath);

    replacements.push({
      start: source.start,
      end: source.end,
      code: JSON.stringify(`${toViteModuleId(resolvedPath, options.root)}${suffix}`),
    });
  });

  if (replacements.length === 0) return null;

  let output = options.code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.code + output.slice(replacement.end);
  }
  return output;
}

function walkModuleAst(node: FarmModuleAstNode, visit: (node: FarmModuleAstNode) => void): void {
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (isFarmModuleAstNode(value)) {
      walkModuleAst(value, visit);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isFarmModuleAstNode(item)) walkModuleAst(item, visit);
      }
    }
  }
}

function isFarmModuleAstNode(value: unknown): value is FarmModuleAstNode {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as FarmModuleAstNode).type === "string" &&
    typeof (value as FarmModuleAstNode).start === "number" &&
    typeof (value as FarmModuleAstNode).end === "number"
  );
}

function isFarmConfigFile(file: string, root: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  const rootSlug = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const relative = normalized.startsWith(`${rootSlug}/`)
    ? normalized.slice(rootSlug.length + 1)
    : normalized;

  return FARM_CONFIG_FILENAMES.has(relative);
}

export function farmPlugin(
  options: FarmVitePluginOptions = {},
  initialPluginManager?: PluginManager,
): Plugin {
  let farmApp: FarmApp;
  let server: ViteDevServer;
  let hmrManager: HMRManager;
  let apiRouteManager: APIRouteManager;
  let openAPIManager: OpenAPIManager | null = null;
  let middlewareManager: MiddlewareManager;
  let refreshRouteDiscovery: ((reason: string) => Promise<void>) | null = null;
  let workflowHandler: ((request: Request) => Promise<Response | null>) | null = null;
  const pluginManager: PluginManager | undefined = initialPluginManager;
  const logUpdate = (tag: "PAGE" | "API" | "MIDDLEWARE" | "TYPE", message: string) => {
    try {
      const pc = require("picocolors");
      const log = [
        pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
        pc.dim("[") + pc.bold(pc.yellow("UPDATE")) + pc.dim("]"),
        pc.gray(message),
      ].join(" ");
      console.log(log);
    } catch {
      console.log(`[FARM] [${tag}] [UPDATE] ${message}`);
    }
  };

  return {
    name: "farm",

    config(_userConfig, configEnv) {
      const layerAliases = getFarmLayerAliases(options.layers);
      const layerRoots = (options.layers ?? []).map((layer) => layer.root);
      return {
        define: getEnvDefines(options, configEnv),
        resolve: {
          alias: layerAliases,
        },
        ...(layerRoots.length
          ? {
              server: {
                fs: {
                  allow: [path.resolve(options.root || process.cwd()), ...layerRoots],
                },
              },
            }
          : {}),
      };
    },

    async configResolved(config) {
      // Defer initialization until Vite server is available
    },

    async configureServer(viteServer) {
      server = viteServer;

      // Store the plugin manager passed during creation
      const pm = initialPluginManager;
      const emitPluginError = async (
        phase: string,
        error: unknown,
        meta?: Record<string, unknown>,
      ) => {
        if (!pm) return;
        try {
          await pm.runHookParallel("onError", { phase, error, meta });
        } catch {
          // Ignore plugin error reporter failures
        }
      };

      farmApp = new FarmApp(
        {
          root: server.config.root,
          ...options,
        },
        server,
      );

      const globalsCSSPath = path.join(server.config.root, "src/app/globals.css");
      if (!fs.existsSync(globalsCSSPath)) {
        const appDir = path.join(server.config.root, "src/app");
        if (!fs.existsSync(appDir)) {
          fs.mkdirSync(appDir, { recursive: true });
        }
        fs.writeFileSync(globalsCSSPath, defaultGlobalCSS);
      }

      await farmApp.initialize();

      const farmConfig = farmApp.getConfig();
      const sourceRoots = getFarmSourceRoots(farmConfig);
      server.watcher.add(sourceRoots.map((source) => path.join(source.root, source.srcDir)));
      const workflowConfig = resolveWorkflowsConfig(farmConfig.workflows);
      const getExtraRouteTypes = () => [
        ...(options.openapi?.enabled && options.openapi.route ? [options.openapi.route] : []),
        ...getFarmDocsRouteTypeEntries(farmConfig.docs),
      ];
      const appDirSlugs = sourceRoots.map((source) =>
        path.join(source.root, source.srcDir, "app").replace(/\\/g, "/"),
      );
      const generateTypeArtifacts = async (reason: string, log = false) => {
        try {
          const result = await generateFarmTypeArtifacts({
            root: farmConfig.root,
            srcDir: farmConfig.srcDir,
            layers: farmConfig.layers,
            extraRoutes: getExtraRouteTypes(),
            suppressLintOnLink: farmConfig.suppressLintOnLink,
          });
          if (log) {
            logUpdate(
              "TYPE",
              `${reason} - regenerated route, API, and env types (${result.apiRoutes.length} API route${result.apiRoutes.length === 1 ? "" : "s"})`,
            );
          }
          if (openAPIManager) {
            await openAPIManager.invalidateCache();
          }
        } catch (e) {
          if (process.env.FARM_VERBOSE) {
            logger.warn("Type artifact generation failed: " + (e as Error).message);
          }
          if (pm) {
            await emitPluginError("type-artifact-generation", e, { reason });
          }
        }
      };
      await generateTypeArtifacts("startup");

      const srcDirSlugs = sourceRoots.map((source) =>
        path.join(source.root, source.srcDir).replace(/\\/g, "/"),
      );
      const layerConfigFiles = new Set(
        farmConfig.layers
          .map((layer) => layer.configFile?.replace(/\\/g, "/"))
          .filter((file): file is string => Boolean(file)),
      );
      const isPageFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return (
          appDirSlugs.some((appDir) => normalized.startsWith(`${appDir}/`)) &&
          /page\.(ts|tsx|js|jsx|md|mdx)$/.test(normalized)
        );
      };
      const isApiRouteFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return (
          appDirSlugs.some((appDir) => normalized.startsWith(`${appDir}/api/`)) &&
          /route\.(ts|tsx|js|jsx)$/.test(normalized)
        );
      };
      const isProgrammaticRouteFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return (
          srcDirSlugs.some((srcDir) => normalized.startsWith(`${srcDir}/`)) &&
          isProgrammaticRoutesFileName(normalized)
        );
      };
      const isProgrammaticRouteSourceFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return srcDirSlugs.some((srcDir) =>
          isPotentialProgrammaticRouteSourceFile(normalized, srcDir),
        );
      };
      const isAppRuntimeFile = (file: string) => {
        const normalized = file.replace(/\\/g, "/");
        return (
          appDirSlugs.some((appDir) => normalized.startsWith(`${appDir}/`)) &&
          /\/(?:page|layout|loading|error|middleware|route)\.(?:ts|tsx|js|jsx|md|mdx)$|\/(?:opengraph-image|twitter-image)(?:\.(?:ts|tsx|js|jsx|png|jpg|jpeg|gif|webp)|\.alt\.txt)$/.test(
            normalized,
          )
        );
      };
      const isStaticMetadataImageFile = (file: string) =>
        /\/(?:opengraph-image|twitter-image)(?:\.(?:png|jpg|jpeg|gif|webp)|\.alt\.txt)$/.test(
          file.replace(/\\/g, "/"),
        );
      const isTypeAffectingFile = (file: string, event: string) =>
        isPageFile(file) ||
        isApiRouteFile(file) ||
        isFarmConfigFile(file, farmConfig.root) ||
        layerConfigFiles.has(file.replace(/\\/g, "/")) ||
        isProgrammaticRouteFile(file) ||
        (isProgrammaticRouteSourceFile(file) &&
          (event === "unlink" || fileContainsProgrammaticPageRoute(file)));
      let typeArtifactGenScheduled: ReturnType<typeof setTimeout> | null = null;
      let routeRefreshScheduled: ReturnType<typeof setTimeout> | null = null;
      const scheduleTypeArtifactGen = (file: string, event: string) => {
        if (typeArtifactGenScheduled) return;
        typeArtifactGenScheduled = setTimeout(() => {
          typeArtifactGenScheduled = null;
          const shortPath = file.split("/app/")[1] || file;
          generateTypeArtifacts(`${event} ${shortPath}`, true).catch(() => {});
        }, 100);
      };
      ["add", "change", "unlink"].forEach((ev) => {
        server.watcher.on(ev as "add", (file: string) => {
          if (isTypeAffectingFile(file, ev)) scheduleTypeArtifactGen(file, ev);
          if (
            (ev !== "change" || isStaticMetadataImageFile(file)) &&
            (isAppRuntimeFile(file) ||
              isProgrammaticRouteFile(file) ||
              (isProgrammaticRouteSourceFile(file) &&
                (ev === "unlink" || fileContainsProgrammaticPageRoute(file)))) &&
            !routeRefreshScheduled
          ) {
            routeRefreshScheduled = setTimeout(() => {
              routeRefreshScheduled = null;
              Promise.all([
                refreshRouteDiscovery?.(`${ev} ${file}`),
                file.includes("middleware.") ? middlewareManager?.reload() : undefined,
              ])
                .then(() => server.ws.send({ type: "full-reload", path: "*" }))
                .catch((error) => logger.warn(`Route refresh failed: ${error.message}`));
            }, 50);
          }
        });
      });

      // Initialize HMR manager
      hmrManager = new HMRManager(server);

      // Initialize API route manager
      const appDirs = getFarmAppDirectories(farmConfig);
      const routeManager = farmApp.getRouteManager();
      const discoveredRoutes: Array<{
        kind: "page" | "layout";
        pattern: string;
        modulePath: string;
      }> = [];
      for (const [pattern, entry] of routeManager.getRoutes()) {
        discoveredRoutes.push({ kind: "page", pattern, modulePath: entry.modulePath });
      }
      for (const [pattern, entry] of routeManager.getLayouts()) {
        discoveredRoutes.push({ kind: "layout", pattern, modulePath: entry.modulePath });
      }
      if (pm) {
        for (const route of discoveredRoutes) {
          await pm.runHookParallel("routeDiscovered", route);
        }
        await pm.runHookParallel("routesGenerated", {
          routes: discoveredRoutes,
          pageCount: discoveredRoutes.filter((r) => r.kind === "page").length,
          layoutCount: discoveredRoutes.filter((r) => r.kind === "layout").length,
        });
      }

      apiRouteManager = new APIRouteManager(appDirs, server);
      await apiRouteManager.discoverRoutes();
      const discoveredWorkflows = await discoverFarmWorkflows(
        { ...farmConfig, workflows: workflowConfig },
        {
          loadModule: async (filePath) =>
            server.ssrLoadModule(filePath) as Promise<Record<string, any>>,
        },
      );
      if (discoveredWorkflows.length > 0) {
        workflowHandler = createFarmWorkflowRequestHandler({
          workflows: discoveredWorkflows,
          config: workflowConfig,
          loadModule: async (workflow: FarmDiscoveredWorkflow) =>
            server.ssrLoadModule(workflow.filePath) as Promise<Record<string, any>>,
        });
        logger.success(`✅ Discovered ${discoveredWorkflows.length} Farm workflow task(s)`);
      }
      if (pm) {
        for (const [, apiRoute] of apiRouteManager.getRoutes()) {
          await pm.runHookParallel("apiRouteDiscovered", {
            path: apiRoute.path,
            filePath: apiRoute.filePath,
            methods: apiRoute.methods,
          });
        }
      }

      middlewareManager = new MiddlewareManager(appDirs, server, farmConfig.middleware);
      await middlewareManager.discover();
      if (pm) {
        for (const middleware of middlewareManager.getMiddlewares()) {
          await pm.runHookParallel("middlewareDiscovered", {
            path: middleware.path,
            filePath: middleware.filePath,
            handlerCount: middleware.handlers.length,
          });
        }
      }

      // Initialize OpenAPI manager if enabled
      if (options.openapi?.enabled) {
        openAPIManager = new OpenAPIManager(appDirs, options.openapi);
        await openAPIManager.generateSpec();
        logger.success("✅ OpenAPI documentation enabled");
      }

      refreshRouteDiscovery = async (reason: string) => {
        await routeManager.discoverRoutes();
        await apiRouteManager.discoverRoutes();
        const manifestModule = server.moduleGraph.getModuleById("/@farm/manifest");
        if (manifestModule) {
          server.moduleGraph.invalidateModule(manifestModule);
        }
        if (openAPIManager) {
          await openAPIManager.invalidateCache();
        }
        if (process.env.FARM_VERBOSE) {
          logger.info(`Refreshed routes: ${reason}`);
        }
      };

      const farmDocsHandler = createFarmDocsHandler(farmConfig.docs, {
        root: farmConfig.root,
        srcDir: farmConfig.srcDir,
        clientEntry: "/@farm/client.js",
      });
      const farmDocsAPIHandler = farmConfig.docs?.enabled
        ? createFarmDocsAPIHandler({
            rootDir: farmConfig.root,
            srcDir: farmConfig.srcDir,
            docs: farmConfig.docs,
          })
        : null;
      const farmDocsFontAssets = new Map([
        [
          "/assets/Geist-Variable-CrgPqtmy.woff2",
          path.join(
            farmConfig.root,
            "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
          ),
        ],
        [
          "/assets/GeistMono-Variable-BNLlm6Cd.woff2",
          path.join(
            farmConfig.root,
            "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
          ),
        ],
      ]);

      // Built-in terminal logging (always enabled in development, independent of logger plugin)
      const logRequest = (method: string, urlPath: string, tag: "API" | "PAGE") => {
        try {
          const pc = require("picocolors");
          const log = [
            pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
            tag === "API" ? pc.gray("Requesting ") : pc.gray("Loading "),
            pc.gray(urlPath),
          ].join(" ");
          console.log(log);
        } catch {
          console.log(`[FARM] [${tag}] [${method}] ${urlPath}`);
        }
      };

      const logResponse = (
        method: string,
        urlPath: string,
        status: number,
        duration: number,
        tag: "API" | "PAGE",
      ) => {
        // In dev, browsers can trigger bursts of identical requests (reload/prefetch).
        // Collapse near-identical page logs to keep terminal output readable.
        const now = Date.now();
        const dedupeKey = `${tag}:${method}:${urlPath}:${status}`;
        const dedupeWindowMs = 250;
        const last = (logResponse as any).__last as { key: string; ts: number } | undefined;
        if (tag === "PAGE" && last && last.key === dedupeKey && now - last.ts < dedupeWindowMs) {
          return;
        }
        (logResponse as any).__last = { key: dedupeKey, ts: now };

        try {
          const pc = require("picocolors");
          let statusColor = pc.green;
          if (status >= 500) statusColor = pc.red;
          else if (status >= 400) statusColor = pc.yellow;
          else if (status >= 300) statusColor = pc.cyan;

          const log = [
            pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.cyan(tag)) + pc.dim("]"),
            pc.dim("[") + pc.bold(pc.white(method.padEnd(3))) + pc.dim("]"),
            pc.gray(urlPath),
            pc.dim("-"),
            statusColor(status.toString()),
            pc.dim(`(${duration}ms)`),
          ].join(" ");
          console.log(log);
        } catch {
          console.log(`[FARM] [${tag}] [${method}] ${urlPath} - ${status} (${duration}ms)`);
        }
      };

      // Register middleware directly (not in return function) to ensure it runs early
      server.middlewares.use(_withAfterNodeMiddleware(async (req, res, next) => {
        const requestUrl = req.url || "/";
        const requestMethod = req.method || "GET";
        const fullUrl = `http://${req.headers.host || "localhost:3000"}${requestUrl}`;
        const requestPathname = new URL(fullUrl).pathname;
        const currentConfig = farmApp?.getConfig() ?? options;

        const farmDocsFontPath = farmDocsFontAssets.get(requestPathname);
        if (farmDocsFontPath && fs.existsSync(farmDocsFontPath)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "font/woff2");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          fs.createReadStream(farmDocsFontPath).pipe(res);
          return;
        }

        if (
          requestMethod === "GET" &&
          (requestPathname === "/__farm/devtools" || requestPathname === "/__farm/devtools.json")
        ) {
          const snapshot = await createFarmDevtoolsSnapshot({
            root: farmConfig.root,
            srcDir: farmConfig.srcDir,
            routeManager: farmApp.getRouteManager(),
            apiRouteManager,
            middlewareManager,
            config: {
              ...currentConfig,
              openapi: options.openapi,
            },
            workflows: discoveredWorkflows,
          });

          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            requestPathname.endsWith(".json")
              ? "application/json; charset=utf-8"
              : "text/html; charset=utf-8",
          );
          res.setHeader("Cache-Control", "no-store");
          res.end(
            requestPathname.endsWith(".json")
              ? JSON.stringify(snapshot, null, 2)
              : renderFarmDevtoolsHtml(snapshot),
          );
          return;
        }

        // Handle OpenAPI docs route
        if (openAPIManager && req.url === options.openapi?.route) {
          const docsHandler = openAPIManager.getDocsRouteHandler();
          return docsHandler(req, res);
        }

        const docsHeaders = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value) {
            docsHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
        }
        const docsResponse = await farmDocsHandler(
          new Request(fullUrl, {
            method: requestMethod,
            headers: docsHeaders,
          }),
        );
        if (docsResponse) {
          await sendWebResponse(res, docsResponse);
          return;
        }

        const markdownSourceResponse = await createFarmMarkdownSourceResponse({
          request: new Request(fullUrl, {
            method: requestMethod,
            headers: docsHeaders,
          }),
          config: farmApp.getConfig().mdx,
          resolveSource: async (pathname) => {
            const match = farmApp.getRouteManager().matchRoute(pathname);
            if (!match.route || !isFarmMarkdownPageFile(match.route.modulePath)) {
              return null;
            }
            return {
              source: await fs.promises.readFile(match.route.modulePath, "utf8"),
              filePath: match.route.modulePath,
            };
          },
        });
        if (markdownSourceResponse) {
          await sendWebResponse(res, markdownSourceResponse);
          return;
        }

        const markdownResponse = await createMarkdownMirrorResponse({
          request: new Request(fullUrl, {
            method: requestMethod,
            headers: docsHeaders,
          }),
          config: farmApp.getConfig().md,
          routeExists: (pathname) => Boolean(farmApp.getRouteManager().matchRoute(pathname).route),
          renderPage: async (request) => fetch(request),
        });
        if (markdownResponse) {
          await sendWebResponse(res, markdownResponse);
          return;
        }

        if (
          workflowHandler &&
          (requestPathname === workflowConfig.route ||
            requestPathname.startsWith(`${workflowConfig.route}/`))
        ) {
          let workflowBody: string | undefined;
          if (requestMethod !== "GET" && requestMethod !== "HEAD") {
            workflowBody = await new Promise<string>((resolve) => {
              let data = "";
              req.on("data", (chunk) => {
                data += chunk;
              });
              req.on("end", () => {
                resolve(data);
              });
            });
          }
          const workflowResponse = await workflowHandler(
            new Request(fullUrl, {
              method: requestMethod,
              headers: docsHeaders,
              body: workflowBody || undefined,
            }),
          );
          if (workflowResponse) {
            await sendWebResponse(res, workflowResponse);
            return;
          }
        }

        const configuredIntegrations = currentConfig.integrations;

        const tryConfiguredIntegrationRoute = async () => {
          const matchedRoute = matchIntegrationRoute(configuredIntegrations, {
            pathname: requestPathname,
            method: requestMethod,
          });

          if (!matchedRoute) {
            return false;
          }

          const startTime = Date.now();

          try {
            if (pm) {
              await pm.runHookParallel("beforeRequest", req, res);
            }

            if (res.writableEnded) {
              const duration = Date.now() - startTime;
              logResponse(requestMethod, requestUrl, res.statusCode || 200, duration, "API");
              return true;
            }

            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers)) {
              if (value) {
                headers.set(key, Array.isArray(value) ? value.join(", ") : value);
              }
            }

            let body: string | undefined;
            if (req.method !== "GET" && req.method !== "HEAD") {
              body = await new Promise<string>((resolve) => {
                let data = "";
                req.on("data", (chunk) => {
                  data += chunk;
                });
                req.on("end", () => {
                  resolve(data);
                });
              });
            }

            const integrationRequest = new Request(fullUrl, {
              method: req.method,
              headers,
              body: body || undefined,
            });

            const response = await dispatchIntegrationRequest(
              {
                integration: matchedRoute.integration,
                config: currentConfig,
                isDev: true,
                isProd: false,
              },
              integrationRequest,
            );

            if (!response) {
              return false;
            }

            const duration = Date.now() - startTime;
            logResponse(requestMethod, requestUrl, response.status, duration, "API");

            await sendWebResponse(res, response);
            return true;
          } catch (error) {
            const duration = Date.now() - startTime;
            logResponse(requestMethod, requestUrl, 500, duration, "API");
            await emitPluginError("integration-handler", error, {
              pathname: requestPathname,
              routePath: requestUrl,
              method: requestMethod,
              integration: matchedRoute.key,
            });
            logger.error(`Integration route error: ${error}`);
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
            }
            return true;
          }
        };

        if (await tryConfiguredIntegrationRoute()) {
          return;
        }

        const redirectMatch = farmApp.getRouteManager().matchRedirect(requestPathname);
        if (redirectMatch) {
          res.statusCode = redirectMatch.statusCode;
          res.setHeader("Location", redirectMatch.destination);
          res.end(`Redirecting to ${redirectMatch.destination}`);
          return;
        }

        // Handle API routes first
        const hasMatchedApiRoute = Boolean(apiRouteManager.matchRoute(requestPathname));
        if (hasMatchedApiRoute || req.url?.startsWith("/api/")) {
          const startTime = Date.now();
          const method = req.method || "GET";
          const urlPath = req.url || "/";
          const pathname = new URL(urlPath, `http://${req.headers.host || "localhost:3000"}`)
            .pathname;

          try {
            if (pm) {
              await pm.runHookParallel("beforeRequest", req, res);
            }

            if (res.writableEnded) {
              const duration = Date.now() - startTime;
              logResponse(method, urlPath, res.statusCode || 200, duration, "API");
              return;
            }
          } catch (error) {
            await emitPluginError("before-request", error, { urlPath, method });
            logger.error(`Request hook error: ${error}`);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Internal server error" }));
            return;
          }

          const apiHandler = apiRouteManager.getHandler();
          const hasExplicitAPIRoute =
            hasMatchedApiRoute || Boolean(apiRouteManager.matchRoute(pathname));
          if (apiHandler && hasExplicitAPIRoute) {
            // Log API request
            // logRequest(method, urlPath, "API");

            try {
              // Convert Node.js request to Web Request
              const url = `http://${req.headers.host || "localhost:3000"}${req.url}`;
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (value) {
                  headers.set(key, Array.isArray(value) ? value.join(", ") : value);
                }
              }

              // Get body for POST/PUT/PATCH
              let body: string | undefined;
              if (req.method !== "GET" && req.method !== "HEAD") {
                body = await new Promise<string>((resolve) => {
                  let data = "";
                  req.on("data", (chunk) => {
                    data += chunk;
                  });
                  req.on("end", () => {
                    resolve(data);
                  });
                });
              }

              const request = new Request(url, {
                method: req.method,
                headers,
                body: body || undefined,
              });

              const apiLifecyclePayload = {
                pathname: new URL(url).pathname,
                method,
                routePath: urlPath,
              };
              const handledRequest: Request = pm
                ? await pm.runHookSerial("beforeApiHandler", request, apiLifecyclePayload)
                : request;

              // Call better-call handler
              const response = await apiHandler(handledRequest);
              const handledResponse: Response = pm
                ? await pm.runHookSerial("afterApiHandler", response, apiLifecyclePayload)
                : response;

              const duration = Date.now() - startTime;
              logResponse(method, urlPath, handledResponse.status, duration, "API");

              // Send response
              await sendWebResponse(res, handledResponse);
              return;
            } catch (error) {
              await emitPluginError("api-handler", error, { urlPath, method });
              logger.error(`API route error: ${error}`);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
              return;
            }
          }

          if (farmDocsAPIHandler && isFarmDocsAPIRequest(pathname)) {
            try {
              const url = `http://${req.headers.host || "localhost:3000"}${req.url}`;
              const headers = new Headers();
              for (const [key, value] of Object.entries(req.headers)) {
                if (value) {
                  headers.set(key, Array.isArray(value) ? value.join(", ") : value);
                }
              }

              let body: string | undefined;
              if (req.method !== "GET" && req.method !== "HEAD") {
                body = await new Promise<string>((resolve) => {
                  let data = "";
                  req.on("data", (chunk) => {
                    data += chunk;
                  });
                  req.on("end", () => {
                    resolve(data);
                  });
                });
              }

              const request = new Request(url, {
                method: req.method,
                headers,
                body: body || undefined,
              });

              const apiLifecyclePayload = {
                pathname,
                method,
                routePath: urlPath,
              };
              const handledRequest: Request = pm
                ? await pm.runHookSerial("beforeApiHandler", request, apiLifecyclePayload)
                : request;

              const docsResponse = await farmDocsAPIHandler(handledRequest);
              if (docsResponse) {
                const handledResponse: Response = pm
                  ? await pm.runHookSerial("afterApiHandler", docsResponse, apiLifecyclePayload)
                  : docsResponse;
                const duration = Date.now() - startTime;
                logResponse(method, urlPath, handledResponse.status, duration, "API");
                await sendWebResponse(res, handledResponse);
                return;
              }
            } catch (error) {
              await emitPluginError("docs-api-handler", error, { urlPath, method });
              logger.error(`Docs API route error: ${error}`);
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Internal server error" }));
              return;
            }
          }

          const duration = Date.now() - startTime;
          logResponse(method, urlPath, 404, duration, "API");
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "API route not found", pathname }));
          return;
        }

        // Skip internal Vite requests
        if (
          req.url?.startsWith("/@") ||
          req.url?.startsWith("/node_modules") ||
          (requestPathname.includes(".") && !requestPathname.endsWith(".html"))
        ) {
          return next();
        }

        // Handle SPA page-data requests for client-side navigation
        if (req.url?.startsWith("/__farm/page-data")) {
          const urlObj = new URL(req.url, `http://${req.headers.host || "localhost:3000"}`);
          const targetPath = urlObj.searchParams.get("path") || "/";

          try {
            const request = createRequestFromNodeRequest(req, urlObj);
            const deploymentMismatch = getFarmDeploymentMismatch(request, farmConfig.deploymentId);
            if (deploymentMismatch) {
              await sendWebResponse(res, createFarmDeploymentMismatchResponse(deploymentMismatch));
              return;
            }

            const routeManager = farmApp.getRouteManager();
            if (pm) {
              await pm.runHookParallel("beforeRouteMatch", {
                pathname: targetPath,
                method: req.method || "GET",
              });
            }
            const match = routeManager.matchRoute(targetPath);
            if (pm) {
              await pm.runHookParallel("afterRouteMatch", {
                pathname: targetPath,
                matched: !!match?.route,
                routePattern: match?.route?.pattern || null,
                params: match?.params || {},
                layoutPatterns: (match?.layouts || []).map((l) => l.pattern),
              });
            }

            if (!match) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Route not found" }));
              return;
            }

            const { route, params, layouts } = match;

            // Check if route was found
            if (!route) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "Route not found" }));
              return;
            }

            // Load route module to get metadata
            const routeModule = await routeManager.loadRouteModule(route.modulePath);

            const moduleMetadata = getClientModuleMetadata(route.modulePath, server.config.root);
            const isClientComponent = moduleMetadata.isClientComponent;
            const shouldHydrate = moduleMetadata.shouldHydrate;

            // Collect metadata from layouts and page
            let mergedMetadata: Record<string, any> = {};
            const layoutModules = await Promise.all(
              layouts.map((layout) => routeManager.loadLayoutModule(layout.modulePath)),
            );

            for (const layoutModule of layoutModules) {
              if ((layoutModule as any).metadata) {
                mergedMetadata = { ...mergedMetadata, ...(layoutModule as any).metadata };
              }
            }

            if ((routeModule as any).metadata) {
              mergedMetadata = { ...mergedMetadata, ...(routeModule as any).metadata };
            }

            // Build search params
            const targetUrl = new URL(targetPath, "http://localhost");
            const searchParams: Record<string, string> = {};
            targetUrl.searchParams.forEach((value, key) => {
              searchParams[key] = value;
            });
            const routeContext = await resolveFarmRouteContext(farmApp.getConfig(), {
              request,
              params,
              search: searchParams,
              path: targetUrl.pathname,
            });
            const routeProps = await parseRouteModuleProps(routeModule as RouteModuleLike, {
              props: withFarmRouteContext(
                {
                  params,
                  searchParams: Promise.resolve(searchParams),
                  path: targetUrl.pathname,
                },
                routeContext,
              ),
              search: searchParams,
              routePath: route.pattern,
            });

            // Convert absolute paths to URL paths (relative to project root)
            const projectRoot = server.config.root;
            const toUrlPath = (absolutePath: string) => {
              if (absolutePath.startsWith(projectRoot)) {
                return absolutePath.slice(projectRoot.length);
              }
              return absolutePath;
            };

            // Return page data for SPA navigation
            const pageData = {
              props: {
                params: routeProps.params,
                search: (routeProps as any).search,
                searchParams: (routeProps as any).search,
                ...("data" in routeProps ? { data: (routeProps as any).data } : {}),
                ...((routeProps as any).__farmCanonicalPath
                  ? { __farmCanonicalPath: (routeProps as any).__farmCanonicalPath }
                  : {}),
                ...((routeProps as any).__farmRoutePropsResolved
                  ? { __farmRoutePropsResolved: true }
                  : {}),
              },
              canonicalPath: (routeProps as any).__farmCanonicalPath,
              modulePath: toUrlPath(route.modulePath),
              isClientComponent,
              shouldHydrate,
              metadata: {
                title: mergedMetadata.title,
                description: mergedMetadata.description,
              },
              layoutModules: layouts.map((l) => toUrlPath(l.modulePath)),
            };

            await sendWebResponse(
              res,
              createDeferredDataResponse(
                pageData,
                {
                  status: 200,
                  headers: {
                    "Cache-Control": "private, max-age=0",
                    [FARM_DEPLOYMENT_ID_HEADER]: farmConfig.deploymentId,
                  },
                },
                {
                  onError(error, id) {
                    logger.error(`Deferred route data ${id} failed: ${error}`);
                  },
                },
              ),
            );
            return;
          } catch (error) {
            await emitPluginError("page-data", error, {
              path: targetPath,
            });
            console.error("[Farm.js] Page data error:", error);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "Failed to load page data",
                message: error instanceof Error ? error.message : "Unknown error",
              }),
            );
            return;
          }
        }

        const startTime = Date.now();
        const method = req.method || "GET";
        const urlPath = req.url || "/";
        const pathname = new URL(urlPath, `http://${req.headers.host || "localhost:3000"}`)
          .pathname;
        const routeManager = farmApp.getRouteManager();
        if (pm) {
          await pm.runHookParallel("beforeRouteMatch", {
            pathname,
            method,
          });
        }
        const routeMatch = routeManager.matchRoute(pathname);
        if (pm) {
          await pm.runHookParallel("afterRouteMatch", {
            pathname,
            matched: !!routeMatch?.route,
            routePattern: routeMatch?.route?.pattern || null,
            params: routeMatch?.params || {},
            layoutPatterns: (routeMatch?.layouts || []).map((l) => l.pattern),
          });
        }
        const renderPayload = {
          pathname,
          method,
          routePattern: routeMatch?.route?.pattern || null,
          params: routeMatch?.params || {},
        };

        // logRequest(method, urlPath, "PAGE");

        try {
          if (middlewareManager) {
            const handled = await middlewareManager.execute(req, res);
            if (handled) {
              const duration = Date.now() - startTime;
              logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
              return; // Middleware handled the response
            }
          }

          // Run beforeRequest hooks
          if (pm) {
            await pm.runHookParallel("beforeRequest", req, res);
          }

          if (res.writableEnded) {
            // Log response if already ended
            const duration = Date.now() - startTime;
            logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
            return;
          }

          // Intercept res.end to call afterResponse hooks and log response before response is fully sent
          const originalWrite = res.write.bind(res);
          const originalEnd = res.end.bind(res);
          let afterResponseCalled = false;
          const htmlChunks: Buffer[] = [];
          let didStreamHtml = false;

          res.write = ((chunk: any, ...args: any[]) => {
            const contentTypeHeader =
              res.getHeader("content-type") || res.getHeader("Content-Type");
            const contentType = typeof contentTypeHeader === "string" ? contentTypeHeader : "";
            const isHtmlResponse = contentType.includes("text/html");

            if (isHtmlResponse && chunk !== undefined && chunk !== null) {
              const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
              htmlChunks.push(bufferChunk);
              didStreamHtml = true;
              const writeResult = originalWrite(chunk, ...args);
              if (typeof (res as any).flush === "function") {
                (res as any).flush();
              }
              return writeResult;
            }

            return originalWrite(chunk, ...args);
          }) as any;

          res.end = ((...args: any[]) => {
            if (!afterResponseCalled && pm) {
              afterResponseCalled = true;
              const duration = Date.now() - startTime;
              logResponse(method, urlPath, res.statusCode || 200, duration, "PAGE");
              const originalEndArgs = [...args];
              Promise.resolve()
                .then(async () => {
                  const contentTypeHeader =
                    res.getHeader("content-type") || res.getHeader("Content-Type");
                  const contentType =
                    typeof contentTypeHeader === "string" ? contentTypeHeader : "";
                  const isHtmlResponse = contentType.includes("text/html");
                  if (isHtmlResponse) {
                    const firstArg = args[0];
                    if (typeof firstArg === "string" || Buffer.isBuffer(firstArg)) {
                      const bufferChunk = Buffer.isBuffer(firstArg)
                        ? firstArg
                        : Buffer.from(firstArg, "utf-8");
                      htmlChunks.push(bufferChunk);
                    }

                    const fullHtml = Buffer.concat(htmlChunks).toString("utf-8");
                    let html = fullHtml;
                    if (!didStreamHtml) {
                      html = await pm.runHookSerial("transformHTML", html);
                      html = await pm.runHookSerial("afterRender", html, renderPayload);
                      const callback =
                        typeof originalEndArgs[originalEndArgs.length - 1] === "function"
                          ? originalEndArgs[originalEndArgs.length - 1]
                          : undefined;
                      originalEndArgs.length = 0;
                      originalEndArgs.push(html);
                      if (callback) originalEndArgs.push(callback);
                    } else {
                      await pm.runHookSerial("transformHTML", fullHtml);
                      await pm.runHookSerial("afterRender", fullHtml, renderPayload);
                    }
                  }
                })
                .then(() => pm.runHookParallel("afterResponse", req, res))
                .then(() => {
                  originalEnd(...originalEndArgs);
                })
                .catch((err) => {
                  emitPluginError("response-end", err, { pathname }).catch(() => {});
                  console.error("Error in afterResponse hook:", err);
                  originalEnd(...originalEndArgs);
                });
            } else {
              originalEnd(...args);
            }
          }) as any;

          // Note: __FARM_PROPS__ is set by the renderer with actual page props (params, searchParams)

          const renderer = farmApp.getServerRenderer();
          if (pm) {
            await pm.runHookParallel("beforeRender", renderPayload);
          }
          await renderer.renderPage(req as any, res as any);
        } catch (error) {
          // Log error response
          const duration = Date.now() - startTime;
          logResponse(method, urlPath, 500, duration, "PAGE");
          await emitPluginError("render-page", error, { pathname });
          next(error);
        }
      }));
    },

    resolveId(id) {
      if (parseProgrammaticRouteModuleId(id)) {
        return id;
      }

      if (id === "/@farm/client" || id === "/@farm/client.js") {
        return id;
      }

      if (id === "/@farm/server") {
        return id;
      }

      // Virtual manifest module - TanStack Start pattern
      if (id === "virtual:farm-manifest" || id === "/@farm/manifest") {
        return "/@farm/manifest";
      }
    },

    load(id) {
      if (parseProgrammaticRouteModuleId(id)) {
        return generateProgrammaticRouteModule(id, server?.config.root || options.root);
      }

      if (id === "/@farm/client" || id === "/@farm/client.js") {
        const resolvedConfig = farmApp?.getConfig();
        const integrations = resolvedConfig?.integrations || options.integrations;

        return generateClientCode(
          getIntegrationProviders(integrations),
          [
            ...getIntegrationDocumentNavigationMatchers(integrations),
            ...getFarmDocsDocumentNavigationMatchers(resolvedConfig?.docs),
          ],
          isFarmDocsSearchEnabled(resolvedConfig?.docs),
          resolveFarmDocsSearchClientModule(
            resolvedConfig?.root || server?.config.root || process.cwd(),
          ),
        );
      }

      if (id === "/@farm/server") {
        return generateServerCode();
      }

      // Virtual manifest module - TanStack Start pattern
      // Manifest is generated at build time and inlined
      if (id === "/@farm/manifest") {
        const routeManager = farmApp?.getRouteManager();
        if (!routeManager) {
          return `
export const getManifest = () => ({
  routes: {},
  layouts: {},
  clientEntry: "/@farm/client.js",
  sharedAssets: []
});
`;
        }

        const manifest = routeManager.generateClientManifest(server.config.root);

        // Convert to full manifest format
        const fullManifest = {
          clientEntry: "/@farm/client.js",
          routes: {} as Record<string, any>,
          layouts: {} as Record<string, any>,
          sharedAssets: [
            { tag: "link", attrs: { rel: "stylesheet", href: "/src/app/globals.css" } },
          ],
        };

        // Convert routes array to object keyed by pattern
        for (const route of manifest.routes) {
          const moduleMetadata = getClientModuleMetadata(route.modulePath, server.config.root);

          fullManifest.routes[route.pattern] = {
            modulePath: route.modulePath,
            pattern: route.pattern,
            segments: route.segments,
            search: route.search,
            isClientComponent: moduleMetadata.isClientComponent,
            shouldHydrate: moduleMetadata.shouldHydrate,
            preloads: [route.modulePath], // In dev, preload is just the module
            assets: [],
          };
        }

        // Convert layouts array to object keyed by pattern
        for (const layout of manifest.layouts) {
          fullManifest.layouts[layout.pattern] = {
            modulePath: layout.modulePath,
            pattern: layout.pattern,
            preloads: [layout.modulePath],
            assets: [],
          };
        }

        return `
// Auto-generated manifest for SPA navigation (TanStack Start pattern)
// This manifest is inlined in the server bundle - no file on disk
// Client receives this via window.__FARM_MANIFEST__ in HTML
export const getManifest = () => (${JSON.stringify(fullManifest, null, 2)});
export const manifest = getManifest();
`;
      }
    },

    transform(code, id, transformOptions) {
      let transformedCode = code;
      let transformed = false;

      if (transformOptions?.ssr && server) {
        const rewrittenImports = rewriteEarlySsrRelativeImports({
          code: transformedCode,
          id,
          root: server.config.root,
          parse: (source) => this.parse(source) as unknown as FarmModuleAstNode,
        });
        if (rewrittenImports) {
          transformedCode = rewrittenImports;
          transformed = true;
        }
      }

      if (hasUseClientDirective(transformedCode)) {
        const moduleInfo = this.getModuleInfo(id);
        if (moduleInfo) {
          (moduleInfo as any).isClientComponent = true;
        }

        transformedCode = stripUseClientDirective(transformedCode);
        transformed = true;

        // Store client component for later injection
        if (!farmApp) {
          return {
            code: transformedCode,
            map: null,
          };
        }

        const clientComponents = (farmApp as any).__clientComponents__ || new Set();
        clientComponents.add(id);
        (farmApp as any).__clientComponents__ = clientComponents;

        // Add HMR support for client components
        // This ensures React re-renders when the component updates
        const hmrCode = `
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule && newModule.default && window.__FARM_REACT_ROOT__) {
      // Re-render with the new component
      const React = window.__FARM_REACT__;
      const props = window.__FARM_PROPS__ || {};
      const nextElement = React.createElement(newModule.default, props);
      const wrapProviders = window.__FARM_WRAP_PROVIDERS__;
      Promise.resolve(
        typeof wrapProviders === 'function' ? wrapProviders(nextElement) : nextElement
      ).then((wrappedElement) => {
        window.__FARM_REACT_ROOT__.render(wrappedElement);
        console.log('[Farm.js] ⚡ HMR update applied');
      });
    }
  });
}
`;
        return {
          code: transformedCode + "\n" + hmrCode,
          map: null,
        };
      }

      return transformed ? { code: transformedCode, map: null } : null;
    },

    generateBundle(options, bundle) {
      const clientManifest = generateClientManifest(bundle);
      this.emitFile({
        type: "asset",
        fileName: "farm-client-manifest.json",
        source: JSON.stringify(clientManifest, null, 2),
      });
    },

    async closeBundle() {
      // SSG: Pre-render static pages at build time
      if (!farmApp) return;

      try {
        const routeManager = farmApp.getRouteManager();
        if (!routeManager) return;

        const { ssg: ssgPages, ssr: ssrRoutes } = await routeManager.collectSSGPages();

        if (ssgPages.length === 0) {
          logger.info("No SSG pages found - all pages will use SSR");
          return;
        }

        logger.info(`Found ${ssgPages.length} SSG pages, ${ssrRoutes.length} SSR routes`);
        logger.info("Pre-rendering SSG pages...");

        const outDir = path.join(server?.config.root || process.cwd(), options.outDir || "dist");
        const clientDir = path.join(outDir, "client");

        // Pre-render each SSG page
        for (const page of ssgPages) {
          try {
            // Load the route module
            const mod = await routeManager.loadRouteModule(page.filePath);
            if (!mod?.default) continue;

            // Find matching layouts
            const { layouts } = routeManager.matchRoute(page.urlPath);
            const layoutModules = await Promise.all(
              layouts.map((l) => routeManager.loadLayoutModule(l.modulePath)),
            );

            // Render the page
            const React = await import("react");
            const { renderToString } = await import("react-dom/server");

            const PageComponent = mod.default;
            const pageProps = {
              params: page.params,
              searchParams: Promise.resolve({}),
              path: page.urlPath,
            };

            let pageElement = React.createElement(
              PageComponent as React.ComponentType<unknown>,
              pageProps as React.Attributes,
            );

            // Wrap with layouts
            for (let i = layoutModules.length - 1; i >= 0; i--) {
              const layoutModule = layoutModules[i];
              const LayoutComponent = layoutModule.default;
              pageElement = React.createElement(
                LayoutComponent as React.ComponentType<unknown>,
                {
                  children: pageElement,
                  params: page.params,
                } as React.Attributes,
              );
            }

            const html = renderToString(pageElement);

            // Generate full HTML with proper structure
            const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="/assets/globals.css">
  ${page.revalidate ? `<meta name="x-farm-revalidate" content="${page.revalidate}">` : ""}
</head>
<body>
  <div id="root">${html}</div>
  <script type="module" src="/assets/client.js"></script>
</body>
</html>`;

            // Write to output directory
            const outputPath =
              page.urlPath === "/"
                ? path.join(clientDir, "index.html")
                : path.join(clientDir, page.urlPath + ".html");

            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, fullHtml);

            const revalidateInfo = page.revalidate ? ` (revalidate: ${page.revalidate}s)` : "";
            logger.success(`  ✓ ${page.urlPath}${revalidateInfo}`);
          } catch (error) {
            logger.error(`  ✗ ${page.urlPath}: ${error}`);
          }
        }

        // Write SSG manifest for server to know which pages are pre-rendered
        const manifestPath = path.join(outDir, "__ssg_manifest.json");
        fs.writeFileSync(
          manifestPath,
          JSON.stringify(
            ssgPages.map((p) => ({
              urlPath: p.urlPath,
              params: p.params,
              revalidate: p.revalidate,
            })),
            null,
            2,
          ),
        );

        logger.success(`SSG complete: ${ssgPages.length} pages pre-rendered`);
      } catch (error) {
        logger.error(`SSG build failed: ${error}`);
      }
    },

    async handleHotUpdate(ctx: HmrContext) {
      const { file, server, modules } = ctx;
      if (initialPluginManager) {
        try {
          await initialPluginManager.runHookParallel("hmrUpdate", {
            file,
            modules: modules.map((m) => m.id || m.url || "").filter(Boolean),
          });
        } catch (error) {
          await initialPluginManager.runHookParallel("onError", {
            phase: "hmrUpdate",
            error,
            meta: { file },
          });
        }
      }

      const currentFarmConfig = farmApp?.getConfig();
      const normalizedFile = file.replace(/\\/g, "/");
      const currentSrcRoot = currentFarmConfig
        ? getFarmSourceRoots(currentFarmConfig)
            .map((source) => path.join(source.root, source.srcDir).replace(/\\/g, "/"))
            .find((sourceRoot) => normalizedFile.startsWith(`${sourceRoot}/`)) || null
        : null;
      if (
        currentSrcRoot &&
        normalizedFile.startsWith(`${currentSrcRoot}/`) &&
        isProgrammaticRoutesFileName(normalizedFile)
      ) {
        logUpdate("PAGE", `updated ${path.basename(file)}`);

        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        await refreshRouteDiscovery?.(`updated ${file}`);

        server.ws.send({
          type: "full-reload",
          path: "*",
        });

        return [];
      }

      if (
        currentSrcRoot &&
        isPotentialProgrammaticRouteSourceFile(normalizedFile, currentSrcRoot) &&
        fileContainsProgrammaticPageRoute(file)
      ) {
        const shortPath = normalizedFile.slice(currentSrcRoot.length + 1);
        logUpdate("PAGE", `updated ${shortPath}`);

        for (const mod of modules) {
          server.moduleGraph.invalidateModule(mod);
        }

        await refreshRouteDiscovery?.(`updated ${file}`);

        server.ws.send({
          type: "full-reload",
          path: "*",
        });

        return [];
      }

      if (file.includes("/app/")) {
        // Hot reload middleware changes
        if (file.includes("middleware.")) {
          if (middlewareManager) {
            await middlewareManager.reload();
            logger.success("✅ Middleware reloaded!");
            if (initialPluginManager) {
              for (const middleware of middlewareManager.getMiddlewares()) {
                await initialPluginManager.runHookParallel("middlewareDiscovered", {
                  path: middleware.path,
                  filePath: middleware.filePath,
                  handlerCount: middleware.handlers.length,
                });
              }
            }
          }

          return [];
        }

        if (file.includes("page.") || file.includes("layout.")) {
          const shortPath = file.split("/app/")[1] || file;
          logUpdate("PAGE", `updated ${shortPath}`);

          for (const mod of modules) {
            server.moduleGraph.invalidateModule(mod);
          }

          server.ws.send({
            type: "full-reload",
            path: "*",
          });

          return [];
        }
      }

      return modules;
    },
  };
}

function generateProgrammaticRouteModule(moduleId: string, root?: string): string {
  const parsed = parseProgrammaticRouteModuleId(moduleId);
  if (!parsed) {
    return "";
  }

  const routeFile = toProgrammaticRouteImportSpecifier(parsed.filePath, root);

  if (parsed.kind === "api") {
    return generateProgrammaticApiRouteModule(parsed.routePath, routeFile);
  }

  return `
import { createElement as __farmCreateElement } from "react";
import * as __farmRoutesModule from ${JSON.stringify(routeFile)};

const __farmIsRouteDefinition = (value) => (
  value &&
  typeof value === "object" &&
  (
    value.kind === "page" ||
    value.kind === "layout" ||
    value.kind === "api" ||
    value.kind === "redirect"
  )
);
const __farmRouteListFromCandidate = (candidate) => {
  if (Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate?.routes)) return candidate.routes;
  if (__farmIsRouteDefinition(candidate)) return [candidate];
  return [];
};
const __farmGetRouteExport = (name) => Reflect.get(__farmRoutesModule, name);
const __farmRouteCandidates = [
  __farmGetRouteExport("default"),
  __farmGetRouteExport("routes"),
  __farmGetRouteExport("Route"),
];
let __farmRoutes = [];
for (const __farmCandidate of __farmRouteCandidates) {
  __farmRoutes = __farmRouteListFromCandidate(__farmCandidate);
  if (__farmRoutes.length > 0) break;
}

if (__farmRoutes.length === 0) {
  __farmRoutes = Object.values(__farmRoutesModule).filter(__farmIsRouteDefinition);
}
const __farmNormalizeRoutePath = (routePath) => {
  const withSlash = routePath && routePath.startsWith("/") ? routePath : "/" + (routePath || "");
  const withoutTrailing = withSlash.length > 1 ? withSlash.replace(/\\/+$/, "") : withSlash;
  return withoutTrailing || "/";
};
const __farmRoute = __farmRoutes.find((route) => (
  route &&
  route.kind === ${JSON.stringify(parsed.kind)} &&
  __farmNormalizeRoutePath(route.path) === ${JSON.stringify(parsed.routePath)}
));

if (!__farmRoute) {
  throw new Error(${JSON.stringify(
    `Programmatic ${parsed.kind} route "${parsed.routePath}" was not found in ${routeFile}.`,
  )});
}

export const metadata = __farmRoute.metadata;
export const generateMetadata = __farmRoute.generateMetadata;
const __farmIsSearchSchema = (value) => value && typeof value.parse === "function";
const __farmGetSearchSchema = (search) => __farmIsSearchSchema(search) ? search : search?.schema;
const __farmGetSearchOptions = (search) => __farmIsSearchSchema(search) ? undefined : search;
const __farmSearchSchema = __farmGetSearchSchema(__farmRoute.search);
const __farmSearchOptions = __farmGetSearchOptions(__farmRoute.search);
export const __farmRouteSchemas = {
  params: __farmRoute.params,
  search: __farmSearchSchema,
};
export const __farmRouteSearch = __farmSearchOptions ? {
  stripDefaults: __farmSearchOptions.stripDefaults,
  preserve: __farmSearchOptions.preserve,
  temporary: __farmSearchOptions.temporary,
} : undefined;
export const __farmRouteData = __farmRoute.data;
export const __farmRouteParsesProps = __farmRoute.kind === "page" && !!(
  __farmRoute.params ||
  __farmRoute.search ||
  __farmRoute.data
);

const __farmParseSchema = (schema, value, label) => {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    throw new Error("Invalid " + label + " for route " + JSON.stringify(__farmRoute.path) + ": " + (error?.message || String(error)));
  }
};

const __farmMarkRoutePropsResolved = (props) => ({
  ...props,
  __farmRoutePropsResolved: true,
});

const __farmAddCanonicalPath = (props, canonicalPath) => (
  canonicalPath ? { ...props, __farmCanonicalPath: canonicalPath } : props
);

const __farmStripRoutePropsMarker = (props) => {
  if (!props || props.__farmRoutePropsResolved !== true) {
    return props;
  }

  const { __farmRoutePropsResolved, __farmCanonicalPath, ...componentProps } = props;
  return componentProps;
};

const __farmCreateSearchParams = (value) => {
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(value || {})) {
    if (item == null) continue;
    const values = Array.isArray(item) ? item : [item];
    for (const entry of values) {
      if (entry != null) params.append(key, String(entry));
    }
  }
  return params;
};

const __farmComparable = (value) => {
  if (Array.isArray(value)) return value.map(__farmComparable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = __farmComparable(value[key]);
      return output;
    }, {});
  }
  return value;
};

const __farmEqual = (left, right) => (
  JSON.stringify(__farmComparable(left)) === JSON.stringify(__farmComparable(right))
);

const __farmReadSearchValue = (value, key) => (
  value && typeof value === "object" ? value[key] : undefined
);

const __farmParseDefaultSearch = () => {
  if (!__farmSearchSchema) return undefined;
  try {
    const value = __farmSearchSchema.parse({});
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
};

const __farmResolveCanonicalPath = (rawSearch, parsedSearch, path) => {
  if (!__farmSearchOptions?.temporary?.length && !__farmSearchOptions?.stripDefaults) {
    return undefined;
  }

  const params = __farmCreateSearchParams(rawSearch);
  const original = params.toString();

  for (const key of __farmSearchOptions.temporary || []) {
    params.delete(key);
  }

  if (__farmSearchOptions.stripDefaults) {
    const defaults = __farmParseDefaultSearch();
    if (defaults) {
      const keys = __farmSearchOptions.stripDefaults === true
        ? Array.from(new Set(Array.from(params.keys())))
        : [...__farmSearchOptions.stripDefaults];
      for (const key of keys) {
        if (params.has(key) && __farmEqual(__farmReadSearchValue(parsedSearch, key), __farmReadSearchValue(defaults, key))) {
          params.delete(key);
        }
      }
    }
  }

  const next = params.toString();
  if (next === original) return undefined;
  return next ? path + "?" + next : path;
};

export async function __farmResolveRouteProps(props) {
  const rawSearch = await props.searchParams;
  const params = __farmParseSchema(__farmRoute.params, props.params, "params");
  const search = __farmParseSchema(__farmSearchSchema, rawSearch, "search");
  const canonicalPath = __farmResolveCanonicalPath(rawSearch, search, props.path);
  const baseProps = {
    ...props,
    params,
    search,
    searchParams: Promise.resolve(search),
  };

  if (!__farmRoute.data) {
    return __farmMarkRoutePropsResolved(__farmAddCanonicalPath(baseProps, canonicalPath));
  }

  const before = __farmRoute.data.before
    ? await __farmRoute.data.before(baseProps)
    : undefined;
  const data = await __farmRoute.data.main({
    ...baseProps,
    before,
  });

  if (__farmRoute.data.after) {
    await __farmRoute.data.after({
      ...baseProps,
      before,
      data,
    });
  }

  return __farmMarkRoutePropsResolved({
    ...baseProps,
    data,
    ...(canonicalPath ? { __farmCanonicalPath: canonicalPath } : {}),
  });
}

const __farmNeedsPageWrapper = __farmRoute.kind === "page" && !!(
  __farmRoute.params ||
  __farmRoute.search ||
  __farmRoute.data
);

async function __farmProgrammaticPage(props) {
  const resolvedProps = props?.__farmRoutePropsResolved === true
    ? props
    : await __farmResolveRouteProps(props);

  return __farmCreateElement(
    __farmRoute.component,
    __farmStripRoutePropsMarker(resolvedProps)
  );
}

export default __farmNeedsPageWrapper
  ? __farmProgrammaticPage
  : __farmRoute.component;
`;
}

function generateProgrammaticApiRouteModule(routePath: string, routeFile: string): string {
  return `
import * as __farmRoutesModule from ${JSON.stringify(routeFile)};

const __farmIsRouteDefinition = (value) => (
  value && typeof value === "object" && (
    value.kind === "page" ||
    value.kind === "layout" ||
    value.kind === "api" ||
    value.kind === "redirect"
  )
);
const __farmRouteListFromCandidate = (candidate) => {
  if (Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate?.routes)) return candidate.routes;
  if (__farmIsRouteDefinition(candidate)) return [candidate];
  return [];
};
const __farmGetRouteExport = (name) => Reflect.get(__farmRoutesModule, name);
const __farmRouteCandidates = [
  __farmGetRouteExport("default"),
  __farmGetRouteExport("routes"),
  __farmGetRouteExport("Route"),
];
let __farmRoutes = [];
for (const __farmCandidate of __farmRouteCandidates) {
  __farmRoutes = __farmRouteListFromCandidate(__farmCandidate);
  if (__farmRoutes.length > 0) break;
}
if (__farmRoutes.length === 0) {
  __farmRoutes = Object.values(__farmRoutesModule).filter(__farmIsRouteDefinition);
}
const __farmNormalizeRoutePath = (value) => {
  const withSlash = value && value.startsWith("/") ? value : "/" + (value || "");
  return withSlash.length > 1 ? withSlash.replace(/\\/+$/, "") : withSlash;
};
const __farmRoute = __farmRoutes.find((route) => (
  route?.kind === "api" &&
  __farmNormalizeRoutePath(route.path) === ${JSON.stringify(routePath)}
));

if (!__farmRoute) {
  throw new Error(${JSON.stringify(
    `Programmatic api route "${routePath}" was not found in ${routeFile}.`,
  )});
}

export const GET = __farmRoute.methods.GET;
export const HEAD = __farmRoute.methods.HEAD;
export const POST = __farmRoute.methods.POST;
export const PUT = __farmRoute.methods.PUT;
export const DELETE = __farmRoute.methods.DELETE;
export const PATCH = __farmRoute.methods.PATCH;
export const OPTIONS = __farmRoute.methods.OPTIONS;
`.trim();
}

function toProgrammaticRouteImportSpecifier(filePath: string, root?: string): string {
  if (root && filePath.startsWith(root)) {
    return filePath.slice(root.length) || "/";
  }

  return filePath;
}

type RouteModuleLike = {
  __farmRouteParsesProps?: boolean;
  __farmResolveRouteProps?: (props: {
    params: Record<string, string>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
    path: string;
    [key: string]: unknown;
  }) => Promise<Record<string, unknown>>;
  __farmRouteSchemas?: {
    params?: { parse?: (value: unknown) => unknown };
    search?: { parse?: (value: unknown) => unknown };
  };
};

async function parseRouteModuleProps(
  routeModule: RouteModuleLike,
  input: {
    props: {
      params: Record<string, string>;
      searchParams: Promise<Record<string, string | string[] | undefined>>;
      path: string;
      [key: string]: unknown;
    };
    search: Record<string, string | string[] | undefined>;
    routePath: string;
  },
): Promise<Record<string, unknown>> {
  if (typeof routeModule.__farmResolveRouteProps === "function") {
    return await routeModule.__farmResolveRouteProps(input.props);
  }

  if (routeModule.__farmRouteParsesProps) {
    return {
      ...input.props,
      search: input.search,
    };
  }

  const schemas = routeModule.__farmRouteSchemas;
  const params = parseRouteModuleSchema(
    schemas?.params,
    input.props.params,
    "params",
    input.routePath,
  );
  const search = parseRouteModuleSchema(schemas?.search, input.search, "search", input.routePath);

  return {
    ...input.props,
    params,
    search,
    searchParams: Promise.resolve(search as Record<string, string | string[] | undefined>),
  };
}

function parseRouteModuleSchema(
  schema: { parse?: (value: unknown) => unknown } | undefined,
  value: unknown,
  label: string,
  routePath: string,
): unknown {
  if (!schema || typeof schema.parse !== "function") {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} for route "${routePath}": ${message}`);
  }
}

function generateClientCode(
  integrationProviders: Array<{ name: string; type: string; props?: Record<string, unknown> }> = [],
  documentNavigationMatchers: string[] = [],
  docsSearchEnabled = false,
  docsSearchModuleId = "@farming-labs/theme",
): string {
  const hasClerkProvider = integrationProviders.some((provider) => provider.type === "clerk");
  const providerImportBlock = hasClerkProvider
    ? `import { ClerkProvider } from '@clerk/react';`
    : "";

  return `
import React from 'react'
import { hydrateRoot, createRoot } from 'react-dom/client'
import { installChunkErrorRecovery, SPARouter } from '@farmjs/core/client'
import { reviveDeferredData } from '@farmjs/core/deferred'
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from '@farmjs/core/deployment'
${providerImportBlock}
${generateFarmDocsSearchClientRuntime(docsSearchEnabled, docsSearchModuleId)}

// ⭐ Farm.js SPA Client Runtime (TanStack Start pattern)
// Uses manifest-based chunk loading - NO HTML fetching!
// Manifest is inlined in HTML via window.__FARM_MANIFEST__

// Expose React for HMR
window.__FARM_REACT__ = React;
const integrationProviders = ${JSON.stringify(integrationProviders)};
const integrationDocumentNavigationMatchers = ${JSON.stringify(documentNavigationMatchers)};

installChunkErrorRecovery();

let reactRoot = null;

function matchesDocumentNavigation(pathname) {
  return integrationDocumentNavigationMatchers.some((matcher) => {
    if (matcher === '/(.*)' || matcher === '*') {
      return true;
    }
    if (matcher.endsWith('(.*)')) {
      const prefix = matcher.slice(0, -4);
      return pathname === prefix || pathname.startsWith(prefix + '/');
    }
    return matcher === pathname;
  });
}

function wrapWithIntegrationProviders(element) {
  let wrapped = element;

  for (let i = integrationProviders.length - 1; i >= 0; i--) {
    const provider = integrationProviders[i];
    if (provider.type === 'clerk') {
      wrapped = React.createElement(ClerkProvider, provider.props || {}, wrapped);
    }
  }

  return wrapped;
}

window.__FARM_WRAP_PROVIDERS__ = wrapWithIntegrationProviders;

// Get manifest from window (inlined by server in HTML)
// Fallback to empty manifest if not available yet
const getManifest = () => window.__FARM_MANIFEST__ || { routes: {}, layouts: {}, clientEntry: '', sharedAssets: [] };

// ====== CLIENT-SIDE ROUTE MATCHING ======
// Matches URL to route using manifest (no server request!)

function matchSegment(urlSegment, routeSegment) {
  if (!routeSegment.isDynamic) {
    return urlSegment === routeSegment.segment ? {} : null;
  }
  if (routeSegment.isCatchAll) {
    return { [routeSegment.segment]: urlSegment };
  }
  return { [routeSegment.segment]: urlSegment };
}

function matchRoute(pathname, routeSegments) {
  const normalizedPath = pathname === '/' ? '' : pathname.replace(/^\\//, '').replace(/\\/$/, '');
  const pathSegments = normalizedPath ? normalizedPath.split('/') : [];
  
  // Handle catch-all routes
  const hasCatchAll = routeSegments.some(s => s.isCatchAll);
  
  if (!hasCatchAll && pathSegments.length !== routeSegments.length) {
    return null;
  }
  
  const params = {};
  
  for (let i = 0; i < routeSegments.length; i++) {
    const routeSeg = routeSegments[i];
    const pathSeg = pathSegments[i];

    if (routeSeg.isCatchAll) {
      // Collect remaining segments
      params[routeSeg.segment] = pathSegments.slice(i).join('/');
      return params;
    }
    
    if (pathSeg === undefined) {
      if (routeSeg.isOptional) continue;
      return null;
    }
    
    const match = matchSegment(pathSeg, routeSeg);
    if (match === null) return null;
    Object.assign(params, match);
  }
  
  return params;
}

function findRoute(pathname) {
  const manifest = getManifest();
  const routes = Object.values(manifest.routes);
  
  for (const route of routes) {
    const params = matchRoute(pathname, route.segments);
    if (params !== null) {
      return { route, params };
    }
  }
  return null;
}

function findLayouts(pathname) {
  const manifest = getManifest();
  const layouts = Object.values(manifest.layouts);
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\\/$/, '');
  const matchingLayouts = [];
  
  for (const layout of layouts) {
    // Root layout matches everything
    if (layout.pattern === '/') {
      matchingLayouts.push(layout);
      continue;
    }
    // Check if pathname starts with layout pattern
    if (normalizedPath.startsWith(layout.pattern) || 
        normalizedPath === layout.pattern.replace(/\\/[^/]+$/, '')) {
      matchingLayouts.push(layout);
    }
  }
  
  return matchingLayouts.sort((a, b) => a.pattern.length - b.pattern.length);
}

// ====== SPA ROUTER ======
// Client-side router - no server requests needed!

class LegacyManifestSPARouter {
  constructor() {
    this.moduleCache = new Map();
    this.prefetchingUrls = new Set();
    this.observers = new Map();
    
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.handlePopState.bind(this));
    }
  }

  setNavigationHandler(handler) {
    this.onNavigate = handler;
  }

  async navigate(href, options = {}) {
    const { replace = false, scroll = true } = options;
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;
    const search = url.search;
    const fullPath = pathname + search;

    if (matchesDocumentNavigation(pathname)) {
      if (replace) {
        window.location.replace(url.toString());
      } else {
        window.location.assign(url.toString());
      }
      return;
    }

    // Same page - just update hash
    if (pathname === window.location.pathname && search === window.location.search) {
      if (url.hash) window.location.hash = url.hash;
      return;
    }

    // Save scroll position
    this.saveScrollPosition(window.location.pathname);

    try {
      // CLIENT-SIDE route matching - no server request!
      const match = findRoute(pathname);
      if (!match) {
        console.warn('[Farm.js] Route not found:', pathname);
        window.location.href = href;
        return;
      }

      const { route, params } = match;

      // Parse search params
      const searchParams = {};
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });

      // Build page data from manifest (no server request!)
      const pageData = {
        route: route, // Full route entry from manifest
        params,
        searchParams,
        layouts: findLayouts(pathname),
      };

      // Update URL
      if (replace) {
        window.history.replaceState({ path: fullPath }, '', fullPath);
      } else {
        window.history.pushState({ path: fullPath }, '', fullPath);
      }

      // Navigate using the handler
      if (this.onNavigate) {
        await this.onNavigate(pageData);
      }
      applyCanonicalPathFromProps(currentPageProps);

      // Handle scroll
      if (scroll) {
        if (url.hash) {
          const element = document.querySelector(url.hash);
          if (element) element.scrollIntoView();
        } else {
          window.scrollTo(0, 0);
        }
      }
    } catch (error) {
      console.error('[Farm.js] Navigation error:', error);
      window.location.href = href; // Fallback
    }
  }

  async prefetch(href) {
    // Prefetching disabled in dev mode to avoid Vite dep optimization issues
    // In production, assets are already bundled and prefetched via link tags
    if (import.meta.env?.DEV) return;
    
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname;

    if (this.prefetchingUrls.has(pathname)) return;

    // Find route in manifest
    const match = findRoute(pathname);
    if (!match) return;

    // Only prefetch routes that will hydrate on the client.
    if (!match.route.isClientComponent && !match.route.shouldHydrate) return;

    const modulePath = match.route.modulePath;
    if (this.moduleCache.has(modulePath)) return;

    this.prefetchingUrls.add(pathname);
    try {
      // Prefetch by importing the module (Vite caches it)
      const module = await import(/* @vite-ignore */ modulePath);
      this.moduleCache.set(modulePath, module);
      pageModuleCache.set(modulePath, module);
    } catch (error) {
      // Silently fail for prefetch
    } finally {
      this.prefetchingUrls.delete(pathname);
    }
  }

  observeForPrefetch(element) {
    if (typeof IntersectionObserver === 'undefined') return;
    const href = element.getAttribute('href');
    if (!href || this.isExternalUrl(href)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setTimeout(() => this.prefetch(href), 100);
            observer.unobserve(element);
            this.observers.delete(element);
          }
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(element);
    this.observers.set(element, observer);
  }

  unobserveForPrefetch(element) {
    const observer = this.observers.get(element);
    if (observer) {
      observer.unobserve(element);
      this.observers.delete(element);
    }
  }

  async handlePopState(event) {
    if (document.documentElement.dataset.farmDocsRuntime === 'true') return;

    const pathname = window.location.pathname;
    const search = window.location.search;
    
    try {
      // Client-side route matching for back/forward
      const match = findRoute(pathname);
      if (!match) {
        window.location.reload();
        return;
      }

      const { route, params } = match;
      const url = new URL(window.location.href);
      const searchParams = {};
      url.searchParams.forEach((value, key) => {
        searchParams[key] = value;
      });

      const pageData = {
        route: route,
        params,
        searchParams,
        layouts: findLayouts(pathname),
      };

      if (this.onNavigate) await this.onNavigate(pageData);
      this.restoreScrollPosition(pathname);
    } catch (error) {
      console.error('[Farm.js] Popstate error:', error);
      window.location.reload();
    }
  }

  isExternalUrl(href) {
    return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
  }

  saveScrollPosition(path) {
    try {
      sessionStorage.setItem('farm-scroll-' + path, JSON.stringify({ x: window.scrollX, y: window.scrollY }));
    } catch {}
  }

  restoreScrollPosition(path) {
    try {
      const saved = sessionStorage.getItem('farm-scroll-' + path);
      if (saved) {
        const { x, y } = JSON.parse(saved);
        setTimeout(() => window.scrollTo(x, y), 0);
      }
    } catch {}
  }
}

// Initialize the SPA router
const spaRouter = new SPARouter({
  shouldUseDocumentNavigation: matchesDocumentNavigation,
});
window.__FARM_SPA_ROUTER__ = spaRouter;

// Cache for loaded page modules
const pageModuleCache = new Map();

// Current page state for React rendering
let currentPageComponent = null;
let currentPageProps = {};
let appRoot = null;

// Layout component reference (loaded once, reused across navigations)
let LayoutComponent = null;

// Track if we've taken over rendering from SSR
let hasClientTakenOver = false;

function normalizeServerProps(rawProps) {
  const props = rawProps && typeof rawProps === 'object' ? { ...rawProps } : {};
  if (props.middleware && props.middleware.data && !(props.middleware.data instanceof Map)) {
    props.middleware = { ...props.middleware, data: new Map(Object.entries(props.middleware.data)) };
  }
  if (props.context && props.context.data && !(props.context.data instanceof Map)) {
    props.context = { ...props.context, data: new Map(Object.entries(props.context.data)) };
  }
  return props;
}

function applyCanonicalPathFromProps(props) {
  const canonicalPath = props && typeof props.__farmCanonicalPath === 'string'
    ? props.__farmCanonicalPath
    : null;
  if (!canonicalPath) return;
  const currentPath = window.location.pathname + window.location.search;
  if (canonicalPath === currentPath) return;
  window.history.replaceState({ ...(window.history.state || {}), path: canonicalPath }, '', canonicalPath);
}

function replayPreHydrationClicks() {
  window.__FARM_HYDRATED__ = true;
  document.documentElement.dataset.farmHydrated = 'true';

  const queue = Array.isArray(window.__FARM_PREHYDRATION_CLICK_QUEUE__)
    ? window.__FARM_PREHYDRATION_CLICK_QUEUE__
    : [];
  if (queue.length === 0) return;

  const queuedClicks = queue.splice(0, queue.length);
  for (const queuedClick of queuedClicks) {
    const target = queuedClick?.target;
    if (!target || typeof target.click !== 'function') continue;
    if (target.isConnected === false) continue;
    setTimeout(() => target.click(), 0);
  }
}

async function buildClientHydrationElement(PageComponent, pageProps) {
  let element = React.createElement(PageComponent, pageProps);
  const loadingModulePath = window.__FARM_LOADING_MODULE__;

  if (loadingModulePath) {
    try {
      const loadingModule = await import(/* @vite-ignore */ loadingModulePath);
      const LoadingComponent = loadingModule?.default;
      if (LoadingComponent) {
        const loadingFallback = React.createElement(LoadingComponent, {
          params: pageProps?.params || {},
          path: pageProps?.path || window.location.pathname,
        });
        element = React.createElement(React.Suspense, { fallback: loadingFallback }, element);
      }
    } catch (error) {
      console.warn('[Farm.js] Could not load loading boundary for hydration:', error);
    }
  }

  return element;
}

async function ensureLayoutLoaded(layouts = []) {
  if (LayoutComponent || layouts.length === 0) {
    return LayoutComponent;
  }

  try {
    const rootLayout = layouts.find((layout) => layout.pattern === '/');
    if (rootLayout) {
      const layoutModule = await import(/* @vite-ignore */ rootLayout.modulePath);
      LayoutComponent = layoutModule.default;
    }
  } catch (error) {
    console.warn('[Farm.js] Could not load layout:', error);
  }

  return LayoutComponent;
}

function getCurrentSearchParams() {
  const searchParams = {};
  const url = new URL(window.location.href);
  url.searchParams.forEach((value, key) => {
    searchParams[key] = value;
  });
  return searchParams;
}

function parseClientRouteSchema(schema, value, label) {
  if (!schema || typeof schema.parse !== 'function') {
    return value;
  }

  try {
    return schema.parse(value);
  } catch (error) {
    throw new Error('Invalid route ' + label + ': ' + (error?.message || String(error)));
  }
}

async function buildRouteComponentProps(pageModule, params, searchParams, path, existingProps) {
  if (existingProps?.__farmRoutePropsResolved === true) {
    const revivedProps = reviveDeferredData(
      existingProps,
      window.__FARM_DEFERRED_DATA__ || {},
    );
    window.__FARM_PROPS__ = revivedProps;
    return {
      ...revivedProps,
      searchParams: Promise.resolve(revivedProps.search ?? revivedProps.searchParams ?? {}),
      path: revivedProps.path || path,
    };
  }

  if (typeof pageModule?.__farmResolveRouteProps === 'function') {
    return await pageModule.__farmResolveRouteProps({
      ...(existingProps || {}),
      params,
      searchParams: Promise.resolve(searchParams),
      path,
    });
  }

  const schemas = pageModule?.__farmRouteSchemas;
  const parsedParams = parseClientRouteSchema(schemas?.params, params, 'params');
  const parsedSearch = parseClientRouteSchema(schemas?.search, searchParams, 'search');

  return {
    params: parsedParams,
    search: parsedSearch,
    searchParams: schemas ? Promise.resolve(parsedSearch) : parsedSearch,
    path,
  };
}

const clientModuleHintCache = new Map();

async function moduleLooksClient(modulePath) {
  if (!modulePath) {
    return false;
  }

  if (clientModuleHintCache.has(modulePath)) {
    return clientModuleHintCache.get(modulePath);
  }

  try {
    const response = await fetch(modulePath, { headers: { Accept: "text/javascript" } });
    const source = await response.text();
    const looksClient = /["']use client["']/.test(source.slice(0, 256));
    const hasHydrateExport = /\\bexport\\s+const\\s+hydrate\\s*=\\s*true\\b/.test(source);
    const shouldHydrate = looksClient || hasHydrateExport;
    clientModuleHintCache.set(modulePath, shouldHydrate);
    return shouldHydrate;
  } catch (error) {
    clientModuleHintCache.set(modulePath, false);
    return false;
  }
}

async function buildWrappedHydrationElement(PageComponent, pageProps, layouts = []) {
  await ensureLayoutLoaded(layouts);
  const pageElement = await buildClientHydrationElement(PageComponent, pageProps);
  const wrappedTree = LayoutComponent
    ? React.createElement(LayoutComponent, { children: pageElement })
    : pageElement;
  return wrapWithIntegrationProviders(wrappedTree);
}

async function tryHydrateImportedPage(
  container,
  route,
  params,
  layouts,
  useHydrate = false,
  existingProps = null,
) {
  const modulePath = route?.modulePath;
  if (!modulePath) {
    return false;
  }

  let pageModule = pageModuleCache.get(modulePath);
  if (!pageModule) {
    pageModule = await import(/* @vite-ignore */ modulePath);
    pageModuleCache.set(modulePath, pageModule);
  }

  const PageComponent = pageModule?.default;
  if (!PageComponent) {
    return false;
  }

  currentPageComponent = PageComponent;
  currentPageProps = await buildRouteComponentProps(
    pageModule,
    params,
    getCurrentSearchParams(),
    window.location.pathname,
    existingProps,
  );

  const wrappedElement = useHydrate && container?.id === '__farm_page__'
    ? wrapWithIntegrationProviders(
        await buildClientHydrationElement(PageComponent, currentPageProps),
      )
    : await buildWrappedHydrationElement(
        PageComponent,
        currentPageProps,
        layouts,
      );

  if (useHydrate) {
    try {
      reactRoot = hydrateRoot(container, wrappedElement);
      window.__FARM_REACT_ROOT__ = reactRoot;
      return true;
    } catch (error) {
      console.log('[Farm.js] Hydration mismatch, using createRoot');
      appRoot = createRoot(container);
      appRoot.render(wrappedElement);
      window.__FARM_REACT_ROOT__ = appRoot;
      hasClientTakenOver = true;
      return true;
    }
  }

  hasClientTakenOver = true;
  if (reactRoot) { try { reactRoot.unmount(); } catch (e) {} reactRoot = null; }
  if (appRoot) { try { appRoot.unmount(); } catch (e) {} appRoot = null; }
  appRoot = createRoot(container);
  window.__FARM_REACT_ROOT__ = appRoot;
  appRoot.render(wrappedElement);
  return true;
}

// ====== CHUNK-BASED NAVIGATION (TanStack Start pattern) ======
// NO HTML fetching! Uses manifest to dynamically import page chunks
async function renderPage(pageData) {
  const container = document.getElementById('root');
  if (!container) return;

  const route = {
    modulePath: pageData.modulePath,
    isClientComponent: pageData.isClientComponent === true,
    shouldHydrate: pageData.shouldHydrate === true,
  };
  const params = pageData.props?.params || {};
  const layouts = (pageData.layoutModules || []).map((modulePath, index) => ({
    modulePath,
    pattern: index === 0 ? '/' : modulePath,
  }));
  const path = window.location.pathname + window.location.search;

  // Helper to fetch HTML and swap content, then re-hydrate if client component
  const fetchAndSwapHTML = async () => {
    console.log('[Farm.js] Fetching HTML for:', path);
    const deploymentId = window.__FARM_DEPLOYMENT_ID__;
    const response = await fetch(path, {
      headers: createFarmDeploymentRequestHeaders(deploymentId, { 'Accept': 'text/html' }),
    });
    if (isFarmDeploymentMismatchResponse(response, deploymentId)) {
      const error = createFarmDeploymentMismatchError(response, deploymentId || 'unknown');
      window.dispatchEvent(new CustomEvent('farm:deployment-mismatch', { detail: error }));
      window.location.assign(path);
      return false;
    }
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const newRoot = doc.getElementById('root');

    const resetReactRoots = () => {
      if (appRoot) { try { appRoot.unmount(); } catch(e) {} appRoot = null; }
      if (reactRoot) { try { reactRoot.unmount(); } catch(e) {} reactRoot = null; }
      delete window.__FARM_REACT_ROOT__;
      hasClientTakenOver = false;
    };

    if (newRoot) {
      resetReactRoots();
      container.innerHTML = newRoot.innerHTML;
      const newTitle = doc.querySelector('title');
      if (newTitle) document.title = newTitle.textContent || document.title;
      
      const shouldHydrate =
        route.shouldHydrate === true ||
        route.isClientComponent ||
        await moduleLooksClient(route.modulePath);
      if (shouldHydrate) {
        try {
          const hydrationContainer = document.getElementById('__farm_page__') || container;
          await tryHydrateImportedPage(hydrationContainer, route, params, layouts, true);
        } catch (error) {
          // Keep the swapped server HTML when the page can only run on the server.
        }
      }
      
      console.log('[Farm.js] ⚡ HTML navigated to:', path);
      return true;
    }

    if (!doc.documentElement || !doc.body) return false;

    resetReactRoots();
    Array.from(document.documentElement.attributes).forEach(function(attr) {
      if (!doc.documentElement.hasAttribute(attr.name)) {
        document.documentElement.removeAttribute(attr.name);
      }
    });
    Array.from(doc.documentElement.attributes).forEach(function(attr) {
      document.documentElement.setAttribute(attr.name, attr.value);
    });

    document.head.innerHTML = doc.head ? doc.head.innerHTML : '';
    document.body.innerHTML = doc.body.innerHTML;
    delete window.__farmDocsRuntime;
    delete window.__farmDocsPageActionsRuntime;

    setTimeout(function() {
      Array.from(document.querySelectorAll('script')).forEach(function(script) {
        const freshScript = document.createElement('script');
        Array.from(script.attributes).forEach(function(attr) {
          freshScript.setAttribute(attr.name, attr.value);
        });
        freshScript.textContent = script.textContent || '';
        script.replaceWith(freshScript);
      });
    }, 0);

    console.log('[Farm.js] ⚡ Document navigated to:', path);
    return true;
  };

  try {
    const isDev = import.meta.env?.DEV;
    
    // For server components, always use HTML swap (they need server rendering)
    if (!route.isClientComponent) {
      await fetchAndSwapHTML();
      return;
    }
    
    // For client components in dev mode, try dynamic import first
    // If it fails due to server deps, fall back to full page navigation

    // Get module path from manifest (production only)
    const modulePath = route.modulePath;
    
    // Try to dynamically import the page module
    let pageModule;
    try {
      pageModule = pageModuleCache.get(modulePath);
      if (!pageModule) {
        pageModule = await import(/* @vite-ignore */ modulePath);
        pageModuleCache.set(modulePath, pageModule);
      }
    } catch (importError) {
      // Import failed (e.g., server deps) - fall back to full page navigation
      // This ensures proper hydration of client components
      console.warn('[Farm.js] Module import failed, using full navigation:', importError.message);
      window.location.href = path;
      return;
    }
    
    const PageComponent = pageModule.default;
    if (!PageComponent) {
      throw new Error('Page module has no default export: ' + modulePath);
    }
    
    // This is a client component (we already filtered out server components above)
    // Render directly with React - no HTML fetch needed!
    console.log('[Farm.js] ⚡ Chunk render:', modulePath);
    
    // Update metadata from module
    const metadata = pageModule.metadata;
    if (metadata?.title) document.title = metadata.title;
    if (metadata?.description) {
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.setAttribute('name', 'description');
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute('content', metadata.description);
    }
    
    // Update current page state
    currentPageComponent = PageComponent;
    currentPageProps = await buildRouteComponentProps(
      pageModule,
      params,
      getCurrentSearchParams(),
      path,
      pageData.props,
    );
    applyCanonicalPathFromProps(currentPageProps);

    const element = await buildWrappedHydrationElement(
      PageComponent,
      currentPageProps,
      layouts,
    );
    
    // On first SPA navigation, take over from SSR
    if (!hasClientTakenOver) {
      hasClientTakenOver = true;
      if (reactRoot) { try { reactRoot.unmount(); } catch(e) {} reactRoot = null; }
      if (appRoot) { try { appRoot.unmount(); } catch(e) {} appRoot = null; }
      appRoot = createRoot(container);
      window.__FARM_REACT_ROOT__ = appRoot;
    }
    
    if (!appRoot) {
      appRoot = createRoot(container);
      window.__FARM_REACT_ROOT__ = appRoot;
    }
    
    // Render!
    appRoot.render(element);
    console.log('[Farm.js] ⚡ Chunk navigated to:', path);
  } catch (error) {
    console.error('[Farm.js] Render error:', error);
    // Fallback to full navigation
    window.location.href = path;
  }
}

// Set up the navigation handler
spaRouter.setNavigationHandler(renderPage);

async function hydrate() {
  if (isFarmDocsSearchPage()) {
    await mountFarmDocsSearch();
    return;
  }

  const rootContainer = document.getElementById('root')
  
  if (!rootContainer) {
    console.error('[Farm.js] Root container not found')
    return
  }

  try {
    // Pre-load layout for SPA navigation
    try {
      const layoutModule = await import(/* @vite-ignore */ '/src/app/layout.tsx');
      LayoutComponent = layoutModule.default;
    } catch (e) {
      console.warn('[Farm.js] Could not preload layout:', e);
    }

    // Check if this is a client component (set by SSR)
    const isClientComponent = window.__FARM_IS_CLIENT__ === true;
    const modulePath = window.__FARM_PAGE_MODULE__;

    if (!modulePath) {
      console.error('[Farm.js] No page module path found')
      return
    }

    let pageProps = normalizeServerProps(window.__FARM_PROPS__);
    applyCanonicalPathFromProps(pageProps);

    const shouldHydrate =
      window.__FARM_SHOULD_HYDRATE__ === true ||
      isClientComponent ||
      await moduleLooksClient(modulePath);
    if (!shouldHydrate) {
      console.log('[Farm.js] Server component - SPA router ready')
      return
    }

    // Get props - either from server-injected props or by matching the current URL
    if (!pageProps || !pageProps.params || Object.keys(pageProps.params).length === 0) {
      // Extract params from URL using manifest route matching (fallback)
      const pathname = window.location.pathname;
      const foundRoute = findRoute(pathname);
      pageProps = normalizeServerProps({
        params: foundRoute?.params || {},
        search: getCurrentSearchParams(),
        searchParams: getCurrentSearchParams(),
        path: pathname,
      });
    }
    currentPageProps = pageProps;

    const layouts = findLayouts(window.location.pathname);
    const pageContainer = shouldHydrate
      ? document.getElementById('__farm_page__') || rootContainer
      : rootContainer;

    if (!pageContainer) {
      console.log('[Farm.js] Server component - SPA router ready')
      return
    }

    const hydrated = await tryHydrateImportedPage(
      pageContainer,
      { modulePath },
      currentPageProps.params || {},
      layouts,
      shouldHydrate,
      currentPageProps,
    ).catch(() => false);

    if (hydrated) {
      replayPreHydrationClicks();
      console.log('[Farm.js] ✅ Hydrated:', modulePath);
      return;
    }

    console.log('[Farm.js] Server component - SPA router ready')
  } catch (error) {
    console.error('[Farm.js] Hydration error:', error)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrate)
} else {
  hydrate()
}

// ====== EVENT DELEGATION FOR LINKS ======
// This catches all link clicks even without React hydration
// This is essential for server component pages where React doesn't hydrate

function isModifierEvent(e) {
  return !!(e.metaKey || e.altKey || e.ctrlKey || e.shiftKey);
}

function isExternalUrl(href) {
  return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
}

document.addEventListener('click', function(event) {
  if (document.documentElement.dataset.farmDocsRuntime === 'true') return;

  // Find the closest anchor element
  let target = event.target;
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
  }
  
  if (!target || target.tagName !== 'A') return;
  
  const href = target.getAttribute('href');
  if (!href) return;
  
  // Don't intercept external links
  if (isExternalUrl(href)) return;
  
  // Don't intercept hash-only links
  if (href.startsWith('#')) return;
  
  // Don't intercept if target is set to open in new window
  const linkTarget = target.getAttribute('target');
  if (linkTarget && linkTarget !== '_self') return;
  
  // Don't intercept modifier clicks (Ctrl+Click = new tab)
  if (isModifierEvent(event)) return;
  
  // Don't intercept non-left clicks
  if (event.button !== 0) return;
  
  // Don't intercept if already prevented
  if (event.defaultPrevented) return;
  
  // Use SPA router
  event.preventDefault();
  const replace = target.hasAttribute('data-replace');
  const scroll = !target.hasAttribute('data-no-scroll');
  const viewTransitionValue = target.getAttribute('data-view-transition');
  const viewTransition = viewTransitionValue === 'auto'
    ? 'auto'
    : viewTransitionValue === 'true';
  
  spaRouter.navigate(href, { replace, scroll, viewTransition });
}, true);  // Use capture phase to handle before React

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    console.log('[Farm.js] ⚡ Update detected')
    // Clear module cache on HMR to pick up changes
    pageModuleCache.clear();
  })
}

console.log('[Farm.js] 🌱 SPA Router initialized');
`;
}

function generateServerCode(): string {
  return `
export { FarmApp, createFarmApp } from './app'
export { ServerRenderer } from './server/renderer'
export { RouteManager } from './routing/route-manager'
export * from './types'
`;
}

function generateClientManifest(bundle: any): Record<string, any> {
  const manifest: Record<string, any> = {};

  for (const [fileName, chunk] of Object.entries(bundle)) {
    if ((chunk as any).type === "chunk") {
      manifest[fileName] = {
        id: fileName,
        chunks: [fileName],
        name: (chunk as any).name || fileName,
      };
    }
  }

  return manifest;
}

export async function defineConfig(config: FarmVitePluginOptions = {}) {
  const tailwindcss = (await import("@tailwindcss/vite")).default;
  const appRoot = path.resolve(config.root || process.cwd());
  if (config.extends?.length) {
    const { config: layeredConfig } = await import("./layers").then(({ resolveFarmLayers }) =>
      resolveFarmLayers(config, {
        root: appRoot,
        mode: process.env.NODE_ENV === "production" ? "production" : "development",
      }),
    );
    config = layeredConfig;
  }

  // Node.js built-in module stubs for browser
  const nodeBuiltinStubs: Record<string, string> = {
    "node:string_decoder":
      "data:text/javascript,export class StringDecoder { write(buf) { return ''; } end() { return ''; } }; export default StringDecoder;",
    "node:buffer":
      "data:text/javascript,export const Buffer = { from: () => ({}), alloc: () => ({}), isBuffer: () => false }; export default { Buffer };",
    "node:stream":
      "data:text/javascript,export class Readable {}; export class Writable {}; export class Transform {}; export default { Readable, Writable, Transform };",
    "node:util":
      "data:text/javascript,export const promisify = (fn) => fn; export const inspect = (obj) => String(obj); export default { promisify, inspect };",
    "node:events":
      "data:text/javascript,export class EventEmitter { on() {} off() {} emit() {} }; export default EventEmitter;",
    "node:path":
      "data:text/javascript,export const join = (...args) => args.join('/'); export const resolve = (...args) => args.join('/'); export default { join, resolve };",
    "node:fs": "data:text/javascript,export default {};",
    "node:url":
      "data:text/javascript,export const URL = globalThis.URL; export const URLSearchParams = globalThis.URLSearchParams; export default { URL, URLSearchParams };",
    "node:crypto":
      "data:text/javascript,export const randomUUID = () => crypto.randomUUID(); export default { randomUUID };",
    "node:os":
      "data:text/javascript,export const platform = () => 'browser'; export const homedir = () => '/'; export default { platform, homedir };",
    "node:child_process": "data:text/javascript,export default {};",
    "node:http": "data:text/javascript,export default {};",
    "node:https": "data:text/javascript,export default {};",
    "node:net": "data:text/javascript,export default {};",
    "node:tls": "data:text/javascript,export default {};",
    "node:zlib": "data:text/javascript,export default {};",
    "node:async_hooks":
      "data:text/javascript,export const AsyncLocalStorage = class {}; export default { AsyncLocalStorage };",
    "node:worker_threads": "data:text/javascript,export default {};",
    "node:perf_hooks":
      "data:text/javascript,export const performance = globalThis.performance; export default { performance };",
    string_decoder:
      "data:text/javascript,export class StringDecoder { write(buf) { return ''; } end() { return ''; } }; export default StringDecoder;",
    buffer:
      "data:text/javascript,export const Buffer = { from: () => ({}), alloc: () => ({}), isBuffer: () => false }; export default { Buffer };",
    stream:
      "data:text/javascript,export class Readable {}; export class Writable {}; export class Transform {}; export default { Readable, Writable, Transform };",
    util: "data:text/javascript,export const promisify = (fn) => fn; export const inspect = (obj) => String(obj); export default { promisify, inspect };",
    events:
      "data:text/javascript,export class EventEmitter { on() {} off() {} emit() {} }; export default EventEmitter;",
    path: "data:text/javascript,export const join = (...args) => args.join('/'); export const resolve = (...args) => args.join('/'); export default { join, resolve };",
    fs: "data:text/javascript,export default {};",
    url: "data:text/javascript,export const URL = globalThis.URL; export const URLSearchParams = globalThis.URLSearchParams; export default { URL, URLSearchParams };",
    crypto:
      "data:text/javascript,export const randomUUID = () => crypto.randomUUID(); export default { randomUUID };",
    os: "data:text/javascript,export const platform = () => 'browser'; export const homedir = () => '/'; export default { platform, homedir };",
    child_process: "data:text/javascript,export default {};",
    http: "data:text/javascript,export default {};",
    https: "data:text/javascript,export default {};",
    net: "data:text/javascript,export default {};",
    tls: "data:text/javascript,export default {};",
    zlib: "data:text/javascript,export default {};",
    async_hooks:
      "data:text/javascript,export const AsyncLocalStorage = class {}; export default { AsyncLocalStorage };",
    worker_threads: "data:text/javascript,export default {};",
    perf_hooks:
      "data:text/javascript,export const performance = globalThis.performance; export default { performance };",
  };

  // Plugin to intercept __vite-browser-external requests
  const viteBrowserExternalPlugin = {
    name: "farm:browser-external-stub",
    enforce: "pre" as const,
    resolveId(id: string) {
      // Handle Vite's browser external markers
      if (id.includes("__vite-browser-external:")) {
        const moduleName = id.replace(/__vite-browser-external:/, "");
        const stub = nodeBuiltinStubs[moduleName];
        if (stub) return stub;
        // Generic stub for unknown node modules
        return "data:text/javascript,export default {};";
      }
      // Handle direct node: imports
      if (id.startsWith("node:")) {
        const stub = nodeBuiltinStubs[id];
        if (stub) return stub;
        return "data:text/javascript,export default {};";
      }
      return null;
    },
  };

  // Custom logger to replace Vite's default logs with Farm.js branding
  const pc = await import("picocolors").then((m) => m.default);
  let serverStarted = false;
  let startTime = Date.now();

  const farmLogger = {
    info: (msg: string) => {
      // Suppress ALL Vite startup messages - we print our own Farm.js branded output
      if (
        msg.includes("VITE") ||
        msg.includes("vite") ||
        msg.includes("ready in") ||
        msg.includes("Local:") ||
        msg.includes("Network:") ||
        msg.includes("➜") ||
        msg.includes("Port") ||
        msg.includes("trying another")
      ) {
        return;
      }
      // Pass through other info messages
      console.log(msg);
    },
    warn: (msg: string) => console.warn(pc.yellow(msg)),
    warnOnce: (msg: string) => console.warn(pc.yellow(msg)),
    error: (msg: string) => console.error(pc.red(msg)),
    clearScreen: () => {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };

  // Plugin to print Farm.js branding after server starts
  const farmBrandingPlugin = {
    name: "farm:branding",
    enforce: "pre" as const,
    configureServer(server: ViteDevServer) {
      startTime = Date.now();

      const originalListen = server.listen.bind(server);
      server.listen = async (port?: number, ...args: any[]) => {
        const result = await originalListen(port, ...args);
        if (!serverStarted) {
          serverStarted = true;
          const elapsed = Date.now() - startTime;
          const address = server.httpServer?.address();
          const resolvedPort =
            typeof address === "object" && address
              ? address.port
              : server.config.server.port || port || 3000;
          const hostConfig = server.config.server.host;
          const isExposed = hostConfig === true || hostConfig === "0.0.0.0";

          console.log("");
          console.log(
            `  ${pc.bold(pc.green("Farm.js"))} ${pc.dim("v1.0.0")} ${pc.dim(`ready in ${elapsed}ms`)}`,
          );
          console.log("");
          console.log(
            `  ${pc.dim("➜")}  ${pc.bold("Local:")}   ${pc.cyan(`http://localhost:${resolvedPort}/`)}`,
          );
          if (isExposed) {
            // Get actual network address
            const os = require("os");
            const interfaces = os.networkInterfaces();
            for (const name of Object.keys(interfaces)) {
              for (const iface of interfaces[name] || []) {
                if (iface.family === "IPv4" && !iface.internal) {
                  console.log(
                    `  ${pc.dim("➜")}  ${pc.bold("Network:")} ${pc.cyan(`http://${iface.address}:${resolvedPort}/`)}`,
                  );
                  break;
                }
              }
            }
          } else {
            console.log(
              `  ${pc.dim("➜")}  ${pc.bold("Network:")} ${pc.dim("use --host to expose")}`,
            );
          }
          console.log("");
        }
        return result;
      };
    },
  };

  return {
    plugins: [
      tailwindcss(),
      viteBrowserExternalPlugin,
      farmPlugin(config),
      farmEnvironmentFunctionsPlugin(),
      farmBrandingPlugin,
    ],
    customLogger: farmLogger,
    clearScreen: false,
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
      // Exclude server-side packages from browser bundling
      exclude: [
        "@farmjs/core/server",
        "@farmjs/core/api",
        "@farmjs/core/middleware",
        "@farmjs/core/config",
        "nitro",
        "h3",
        "vite",
        "esbuild",
        "rollup",
        "fsevents",
        "nf3",
        "better-call",
        "zod",
        "supports-color",
        "node-fetch",
        "consola",
        "mock-aws-s3",
        "aws-sdk",
        "nock",
      ],
    },
    ssr: {
      noExternal: ["farm", "@farmjs/core"],
      // Externalize React to prevent multiple instances during SSR
      external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    resolve: {
      // Ensure single React instance across all modules (critical for hooks!)
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
      // Stub out problematic server-only modules during dev mode
      alias: {
        ...getFarmLayerAliases(config.layers),
        "@": path.resolve(appRoot, "src"),
        // Nitro internals that should not be resolved in browser
        "supports-color":
          "data:text/javascript,export default false; export const supportsColor = false; export const stdout = false; export const stderr = false;",
        "@poppinss/dumper": "data:text/javascript,export default {};",
        "@poppinss/dumper/html":
          "data:text/javascript,export const createScript = () => ''; export const createStyleSheet = () => '';",
        "consola/basic":
          "data:text/javascript,export default { log: console.log, info: console.info, warn: console.warn, error: console.error };",
        youch:
          "data:text/javascript,export default class Youch { toJSON() { return {}; } toHTML() { return ''; } };",
        // Add all node stubs to alias as well
        ...nodeBuiltinStubs,
      },
    },
    define: {
      __FARM_DEV__: JSON.stringify(process.env.NODE_ENV === "development"),
      __FARM_PUBLIC_ENV__: JSON.stringify(getPublicEnvDefine(config)),
    },
  };
}
