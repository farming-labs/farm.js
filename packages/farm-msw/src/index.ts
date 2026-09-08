import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { definePlugin, type FarmPlugin, type FarmPluginClientConfig } from "@farm.js/core/plugin";
import type { RequestHandler } from "msw";
import {
  resolveMswOptions,
  type MswPluginOptions,
  type MswUnhandledRequestBehavior,
} from "./config.js";

export type { MswPluginOptions, MswUnhandledRequestBehavior };

const VIRTUAL_HANDLERS_ID = "virtual:farm-msw-handlers";
const RESOLVED_VIRTUAL_HANDLERS_ID = `\0${VIRTUAL_HANDLERS_ID}`;
const DEFAULT_WORKER_FILE = "mockServiceWorker.js";

interface MswPluginState {
  server?: MswServerRuntime;
  viteServer?: FarmViteDevServer;
  closeListener?: () => void;
}

interface MswServerRuntime {
  listen(options: { onUnhandledRequest: MswUnhandledRequestBehavior }): void;
  resetHandlers(...handlers: RequestHandler[]): void;
  close(): void;
}

interface MswBrowserState {
  stop(): void;
}

interface FarmModuleNode {
  file?: string | null;
  id?: string | null;
  importedModules?: Set<FarmModuleNode>;
}

interface FarmViteDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  moduleGraph?: {
    getModulesByFile(file: string): Set<FarmModuleNode> | undefined;
  };
  httpServer?: {
    once(event: "close", listener: () => void): unknown;
    off?(event: "close", listener: () => void): unknown;
  } | null;
}

interface FarmVitePlugin {
  name: string;
  enforce: "pre";
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  configureServer(server: {
    middlewares: {
      use(
        middleware: (
          request: { method?: string; url?: string },
          response: {
            statusCode: number;
            setHeader(name: string, value: string): void;
            end(body?: string): void;
          },
          next: () => void,
        ) => void,
      ): void;
    };
  }): void;
}

/**
 * Use one MSW handler module for browser requests and development SSR.
 * The plugin removes itself from production config, so neither MSW runtime is bundled or started there.
 */
export function msw(options: MswPluginOptions) {
  const resolved = resolveMswOptions(options);
  let handlersFile = "";
  const publicConfig = {
    workerUrl: `/${DEFAULT_WORKER_FILE}`,
    scope: "/",
    onUnhandledRequest: resolved.onUnhandledRequest,
  };

  const browserClient:
    | FarmPluginClientConfig<MswBrowserState | undefined, typeof publicConfig>
    | undefined =
    resolved.enabled && resolved.browser
      ? {
          public: publicConfig,
          async setup({ public: config, isDev }) {
            if (!isDev) return undefined;
            const runtime = await import("@farm.js/msw/client");
            return runtime.startMswBrowserRuntime(config);
          },
          close({ state }) {
            state?.stop();
          },
        }
      : undefined;

  let plugin: FarmPlugin<
    MswPluginState,
    Record<string, unknown>,
    MswBrowserState | undefined,
    typeof publicConfig
  >;
  plugin = definePlugin<
    MswPluginState,
    Record<string, unknown>,
    MswBrowserState | undefined,
    typeof publicConfig
  >({
    name: "farm:msw",
    enforce: "pre",

    configure(config, context) {
      if (!resolved.enabled || context.isProd) {
        return withoutPlugin(config, plugin);
      }

      const root = path.resolve(config.root ?? ".");
      handlersFile = path.resolve(root, resolved.handlers);
      const basePath = normalizeBasePath(config.basePath);
      publicConfig.workerUrl = `${basePath === "/" ? "" : basePath}/${DEFAULT_WORKER_FILE}`;
      publicConfig.scope = basePath === "/" ? "/" : `${basePath}/`;

      if (!resolved.browser) return;

      const vite = config.vite ?? {};
      return {
        ...config,
        vite: {
          ...vite,
          plugins: [
            createMswVitePlugin({
              handlersFile,
              workerUrl: publicConfig.workerUrl,
              scope: publicConfig.scope,
            }),
            ...(vite.plugins ?? []),
          ],
        },
      };
    },

    setup() {
      return {};
    },

    dev: {
      async server(viteServer, { state }) {
        if (!resolved.enabled || !resolved.server) return;

        const server = viteServer as unknown as FarmViteDevServer;
        const handlers = await loadHandlers(server, handlersFile);
        const { setupServer } = await import("msw/node");
        const mockServer = setupServer(...handlers);
        mockServer.listen({ onUnhandledRequest: resolved.onUnhandledRequest });

        state.server = mockServer;
        state.viteServer = server;
        state.closeListener = () => closeMswServer(state);
        server.httpServer?.once("close", state.closeListener);
      },

      async update(update, { state }) {
        if (!state.server || !state.viteServer) return;
        if (!isHandlersUpdate(state.viteServer, handlersFile, update.file)) return;

        const handlers = await loadHandlers(state.viteServer, handlersFile, Date.now());
        state.server.resetHandlers(...handlers);
      },
    },

    runtime: {
      close({ state }) {
        closeMswServer(state);
      },
    },

    client: browserClient,
  });

  return plugin;
}

function withoutPlugin(config: any, plugin: FarmPlugin<any, any, any, any>): any {
  if (!config.plugins?.includes(plugin)) return;
  return {
    ...config,
    plugins: config.plugins.filter(
      (candidate: FarmPlugin<any, any, any, any>) => candidate !== plugin,
    ),
  };
}

function createMswVitePlugin(input: {
  handlersFile: string;
  workerUrl: string;
  scope: string;
}): FarmVitePlugin {
  const require = createRequire(import.meta.url);
  const workerFile = require.resolve("msw/mockServiceWorker.js");
  const workerSource = readFileSync(workerFile, "utf8");

  return {
    name: "farm:msw-vite",
    enforce: "pre",
    resolveId(id) {
      return id === VIRTUAL_HANDLERS_ID ? RESOLVED_VIRTUAL_HANDLERS_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_HANDLERS_ID) return undefined;
      return renderVirtualHandlersModule(input.handlersFile);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") return next();
        if (requestPathname(request.url) !== input.workerUrl) return next();

        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Service-Worker-Allowed", input.scope);
        response.end(request.method === "HEAD" ? undefined : workerSource);
      });
    },
  };
}

function renderVirtualHandlersModule(handlersFile: string): string {
  return `import * as handlerModule from ${JSON.stringify(toModuleId(handlersFile))};
const candidate = handlerModule.handlers ?? handlerModule.default;
if (!Array.isArray(candidate)) {
  throw new TypeError(${JSON.stringify(invalidHandlersMessage(handlersFile))});
}
export const handlers = candidate;`;
}

async function loadHandlers(
  server: FarmViteDevServer,
  handlersFile: string,
  cacheBust?: number,
): Promise<RequestHandler[]> {
  const id = `${toModuleId(handlersFile)}${cacheBust ? `?farm-msw=${cacheBust}` : ""}`;
  const loaded = await server.ssrLoadModule(id);
  const candidate = loaded.handlers ?? loaded.default;
  if (!Array.isArray(candidate)) throw new TypeError(invalidHandlersMessage(handlersFile));
  return candidate as RequestHandler[];
}

function closeMswServer(state: MswPluginState): void {
  if (!state.server) return;
  state.server.close();
  state.server = undefined;
  if (state.closeListener) {
    state.viteServer?.httpServer?.off?.("close", state.closeListener);
    state.closeListener = undefined;
  }
  state.viteServer = undefined;
}

function isHandlersUpdate(
  server: FarmViteDevServer,
  handlersFile: string,
  changedFile: string,
): boolean {
  const normalizedChangedFile = normalizeFile(changedFile);
  if (normalizedChangedFile === normalizeFile(handlersFile)) return true;

  const handlerModules = server.moduleGraph?.getModulesByFile(handlersFile);
  if (!handlerModules) return false;
  return [...handlerModules].some((module) => moduleDependsOnFile(module, normalizedChangedFile));
}

function moduleDependsOnFile(
  module: FarmModuleNode,
  changedFile: string,
  seen = new Set<FarmModuleNode>(),
): boolean {
  if (seen.has(module)) return false;
  seen.add(module);
  if (moduleFile(module) === changedFile) return true;
  return [...(module.importedModules ?? [])].some((dependency) =>
    moduleDependsOnFile(dependency, changedFile, seen),
  );
}

function moduleFile(module: FarmModuleNode): string {
  return normalizeFile(module.file ?? module.id?.split("?", 1)[0] ?? "");
}

function invalidHandlersMessage(handlersFile: string): string {
  return `[farm:msw] ${handlersFile} must export a handlers array (named or default export).`;
}

function normalizeBasePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value === "/") return "/";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function requestPathname(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://farm.local").pathname;
  } catch {
    return "";
  }
}

function normalizeFile(file: string): string {
  return path.normalize(file).replace(/\\/g, "/");
}

function toModuleId(file: string): string {
  return file.replace(/\\/g, "/");
}
