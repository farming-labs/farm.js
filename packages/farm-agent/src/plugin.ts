import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import type { TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";
import { definePlugin } from "@farm.js/core/plugin";
import type { AgentUnitConfig } from "agent-unit";
import type { DevHandler } from "agent-unit/build";
import type { Plugin as VitePlugin } from "vite";

// agent-unit's build and dev servers load only in Farm's own process. Farm bundles farm.config into
// the production server, and a bundler follows literal imports, so these must not be literal.
const loadBuildOnly = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier);

export function isUnder(pathname: string, basePath: string): boolean {
  return basePath === "/" || pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/** Serves the agents in `farm dev` and builds them into the production server. */
export function createAgentPlugin(config: AgentUnitConfig & { basePath: string }) {
  const { basePath } = config;
  // Set by `configure`, in Farm's process: farm.config also evaluates inside the server, where a
  // Worker has no working directory.
  let root: string | undefined;
  let agentsDir = config.agentsDir ?? "agents";
  let devHandler: Promise<DevHandler> | undefined;

  const closeDev = async () => {
    const pending = devHandler;
    devHandler = undefined;
    await (await pending?.catch(() => undefined))?.close();
  };
  const buildConfig = (): AgentUnitConfig => ({ ...config, agentsDir });

  const devPlugin: VitePlugin = {
    name: "farm:agent-dev",
    apply: "serve",
    // Ahead of Farm's API middleware, which answers 404 for API paths it does not route.
    enforce: "pre",
    // Vite runs this again on every restart, while the agents keep running in one dev handler.
    configureServer(server) {
      devHandler ??= loadBuildOnly<typeof import("agent-unit/build")>("agent-unit/build").then(
        ({ createDevHandler }) =>
          createDevHandler({ root: root ?? process.cwd(), config: buildConfig() }),
      );
      const handler = devHandler;
      server.middlewares.use((req, res, next) => {
        if (!isUnder((req.url ?? "/").split("?")[0]!, basePath)) return next();
        void serveDev(handler, req, res).catch(next);
      });
    },
  };

  return definePlugin({
    name: "farm:agent",
    configure(farmConfig, context) {
      root = path.resolve(farmConfig.root ?? process.cwd());
      agentsDir = config.agentsDir ?? path.posix.join(farmConfig.srcDir ?? "src", "agents");
      if (!context.isDev) return;
      const vite = farmConfig.vite ?? {};
      return { ...farmConfig, vite: { ...vite, plugins: [devPlugin, ...(vite.plugins ?? [])] } };
    },
    router: {
      // agent-unit answers every path under basePath, so an app route there would never be reached.
      discovered(route) {
        if (route.kind !== "api" || !isUnder(route.path, basePath)) return;
        throw new Error(
          `@farm.js/agent: ${route.filePath} is served at ${route.path}, which the agent API owns (basePath "${basePath}"). Move the route, or set another basePath.`,
        );
      },
    },
    build: {
      // agent-unit builds the agents into Farm's Nitro output for its preset: their framework
      // adapters, storage, the sweep and `tasks` as scheduled tasks.
      async configure(nitroConfig) {
        const { agentUnit } =
          await loadBuildOnly<typeof import("agent-unit/nitro")>("agent-unit/nitro");
        const module = agentUnit({
          root: root ?? process.cwd(),
          basePath,
          config: buildConfig(),
          // The module agent-unit's engine reads its config from in the built server.
          configFile: fileURLToPath(new URL("./config.js", import.meta.url)),
        });
        return { ...nitroConfig, modules: [...(nitroConfig.modules ?? []), module] };
      },
    },
    dev: {
      server(_viteServer, { lifecycle }) {
        lifecycle.onShutdown(closeDev);
      },
    },
    runtime: {
      close: closeDev,
    },
  });
}

async function serveDev(
  handler: Promise<DevHandler>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { sendWebResponse } =
    await loadBuildOnly<typeof import("@farm.js/core/server")>("@farm.js/core/server");
  const response = await (await handler).fetch(toWebRequest(req, res));
  await sendWebResponse(res, response);
}

function toWebRequest(req: IncomingMessage, res: ServerResponse): Request {
  const protocol = (req.socket as TLSSocket).encrypted ? "https" : "http";
  const url = new URL(req.url ?? "/", `${protocol}://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index]!;
    if (!name.startsWith(":")) headers.append(name, req.rawHeaders[index + 1]!);
  }
  // A client that leaves an event stream ends the run's subscription, not the run.
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(url, {
    method,
    headers,
    signal: controller.signal,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}
