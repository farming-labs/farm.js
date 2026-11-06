import type { ResolvedFarmServerConfig } from "../server-http";

/**
 * Build the entry for a desktop shell instead of a public server. The module then starts
 * nothing on import: it exports `start()`, binds 127.0.0.1 on an OS-assigned port, puts the
 * desktop guard in front of every request, and reports the bound port.
 */
export interface FarmDesktopServerEntryOptions {
  /** The app's basePath; the handshake URL lives under it. */
  basePath: string;
  /** Module that exports `createFarmDesktopGuard`. */
  guardModule: string;
}

export interface FarmNodeServerEntryOptions {
  nitroEntryFile: string;
  nodeAdapterModule: string;
  server: ResolvedFarmServerConfig;
  websocketAdapterModule: string;
  desktop?: FarmDesktopServerEntryOptions;
}

export interface FarmBunServerEntryOptions {
  nitroEntryFile: string;
  /** srvx's Bun adapter, as Nitro's bun preset resolves it. */
  bunAdapterModule: string;
  server: ResolvedFarmServerConfig;
  websocketAdapterModule: string;
  desktop?: FarmDesktopServerEntryOptions;
}

/** Written next to the Node entry and imported first, so it runs before any app module. */
export const FARM_NODE_ENV_MODULE_FILE = "farm-node-env.mjs";

/**
 * The production server's NODE_ENV, as `next start` sets it: "production" unless the deployment
 * set its own. Packages read it at runtime (a dev-only devtools panel, say) where the build left
 * `process.env.NODE_ENV` in place, and must agree with the browser bundle's inlined value.
 */
export const FARM_NODE_ENV_MODULE_SOURCE = `if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";\n`;

/** Imported first by a desktop entry: `platform()` reads it from any module, the app's included. */
export const FARM_DESKTOP_ENV_MODULE_FILE = "farm-desktop-env.mjs";
export const FARM_DESKTOP_ENV_MODULE_SOURCE = `process.env.FARM_PLATFORM = "desktop";\n${FARM_NODE_ENV_MODULE_SOURCE}`;

/** The line a desktop entry run as its own process prints once it listens. */
export const FARM_DESKTOP_READY_PREFIX = "farm:ready ";

const nodeServerSource = (desktop: boolean) => `const socketPath = process.env.NITRO_UNIX_SOCKET;
const server = serve({
  manual: true,
  silent: true,
  gracefulShutdown: false,
  port,
  hostname: host,
  node: socketPath ? { path: socketPath } : undefined,
  tls: cert && key ? { cert, key } : undefined,
  fetch: ${desktop ? "(request) => farmDesktopGuard(request) ?? nitroApp.fetch(request)" : "nitroApp.fetch"},
  plugins: [...tracingSrvxPlugins],
});
const nodeServer = server.node?.server;
if (!nodeServer) throw new Error("[Farm] Nitro did not create a Node server");

nodeServer.headersTimeout = farmServerConfig.headersTimeout;
nodeServer.requestTimeout = farmServerConfig.requestTimeout;
nodeServer.keepAliveTimeout = farmServerConfig.keepAliveTimeout;

let isShuttingDown = false;
nodeServer.on("request", (_request, response) => {
  response.once("finish", () => {
    if (isShuttingDown) nodeServer.closeIdleConnections?.();
  });
});

if (import.meta._websocket) {
  const { handleUpgrade } = wsAdapter({ resolve: resolveWebsocketHooks });
  nodeServer.on("upgrade", (request, socket, head) => {${
    desktop
      ? `
    const blocked = farmDesktopGuard({
      method: request.method || "GET",
      url: request.url || "/",
      headers: { get: (name) => [request.headers[name]].flat()[0] ?? null },
    });
    if (blocked) {
      socket.end("HTTP/1.1 403 Forbidden\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n");
      return;
    }`
      : ""
  }
    handleUpgrade(
      request,
      socket,
      head,
      new NodeRequest({ req: request, upgrade: { socket, head } }),
    );
  });
}
`;

// Bun.serve's graceful stop waits for in-flight requests and closes idle keep-alive
// connections itself.
const bunServerSource = (
  desktop: boolean,
) => `const ws = import.meta._websocket ? wsAdapter({ resolve: resolveWebsocketHooks }) : undefined;
const server = serve({
  manual: true,
  silent: true,
  gracefulShutdown: false,
  port,
  hostname: host,
  tls: cert && key ? { cert, key } : undefined,
  fetch: ${
    desktop
      ? `(request) =>
    farmDesktopGuard(request) ??
    (import.meta._websocket && request.headers.get("upgrade") === "websocket"
      ? ws.handleUpgrade(request, request.runtime.bun.server)
      : nitroApp.fetch(request))`
      : `import.meta._websocket
    ? (request) =>
        request.headers.get("upgrade") === "websocket"
          ? ws.handleUpgrade(request, request.runtime.bun.server)
          : nitroApp.fetch(request)
    : nitroApp.fetch`
  },
  bun: { websocket: import.meta._websocket ? ws?.websocket : undefined },
  plugins: [...tracingSrvxPlugins],
});

let isShuttingDown = false;
`;

/** Generate the long-running Node adapter entry while retaining Nitro's routing runtime. */
export function createFarmNodeServerEntry(options: FarmNodeServerEntryOptions): string {
  return createFarmServerEntry({
    ...options,
    runtime: "node",
    adapterModule: options.nodeAdapterModule,
  });
}

/**
 * Generate the Bun adapter entry. Nitro's own bun entry leaves shutdown to srvx, which
 * ignores Farm's lifecycle and timeout and keeps an idle server alive for a second after
 * SIGTERM; this entry shuts down as the Node one does.
 */
export function createFarmBunServerEntry(options: FarmBunServerEntryOptions): string {
  return createFarmServerEntry({
    ...options,
    runtime: "bun",
    adapterModule: options.bunAdapterModule,
  });
}

function createFarmServerEntry(options: {
  runtime: "node" | "bun";
  adapterModule: string;
  nitroEntryFile: string;
  server: ResolvedFarmServerConfig;
  websocketAdapterModule: string;
  desktop?: FarmDesktopServerEntryOptions;
}): string {
  const serverConfig = JSON.stringify(options.server);
  const nitroEntryImport = `./${options.nitroEntryFile.replace(/^\.\//, "")}`;
  const node = options.runtime === "node";
  const desktop = options.desktop;
  const envModule = desktop
    ? `import "./${FARM_DESKTOP_ENV_MODULE_FILE}";\n`
    : node
      ? `import "./${FARM_NODE_ENV_MODULE_FILE}";\n`
      : "";

  return `
${envModule}import "#nitro/virtual/polyfills";
import { ${node ? "NodeRequest, " : ""}serve } from ${JSON.stringify(options.adapterModule)};
import wsAdapter from ${JSON.stringify(options.websocketAdapterModule)};
import { resolveWebsocketHooks, useNitroApp, useNitroHooks } from "#nitro/runtime/app";
import { useRuntimeConfig } from "#nitro/runtime/runtime-config";
import { trapUnhandledErrors } from "#nitro/runtime/error/hooks";
import { setupCloseHooks } from "#nitro/runtime/shutdown";
import { startScheduleRunner } from "#nitro/runtime/task";
import { tracingSrvxPlugins } from "#nitro/virtual/tracing";
import { farmProductionLifecycle } from ${JSON.stringify(nitroEntryImport)};${
    desktop
      ? `
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createFarmDesktopGuard } from ${JSON.stringify(desktop.guardModule)};
${DESKTOP_START_SOURCE}
async function startFarmDesktopServer(options) {
let farmDesktopBoundPort;
const farmDesktopGuard = createFarmDesktopGuard({
  secret: options.secret,
  handshakeToken: options.handshakeToken,
  basePath: ${JSON.stringify(desktop.basePath)},
  port: () => farmDesktopBoundPort,
});
if (typeof options.dataDir !== "string" || !options.dataDir) {
  throw new TypeError("[Farm] start() needs dataDir, the directory appDataDir() returns.");
}
process.env.FARM_DESKTOP_DATA_DIR = options.dataDir;`
      : ""
  }

const farmServerConfig = ${serverConfig};
if (!process.env.NITRO_SHUTDOWN_TIMEOUT) {
  process.env.NITRO_SHUTDOWN_TIMEOUT = String(farmServerConfig.gracefulShutdownTimeout);
}
const shutdownConfig = {
  disabled: Boolean(process.env.NITRO_SHUTDOWN_DISABLED),
  signals: (process.env.NITRO_SHUTDOWN_SIGNALS || "SIGTERM SIGINT")
    .split(" ")
    .map((signal) => signal.trim())
    .filter(Boolean),
  timeout: Number.parseInt(process.env.NITRO_SHUTDOWN_TIMEOUT || "", 10) || 30000,
  forceExit: !process.env.NITRO_SHUTDOWN_NO_FORCE_EXIT,
};

const nitroApp = useNitroApp();
useNitroHooks().hook("close", async () => {
  try {
    await farmProductionLifecycle.close("production-server-closed");
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
});

let startupSignal;
let resolveStartupSignal;
const startupSignalPromise = new Promise((resolve) => {
  resolveStartupSignal = resolve;
});
const startupSignalListeners = new Map();
if (!shutdownConfig.disabled) {
  for (const signal of shutdownConfig.signals) {
    const listener = (receivedSignal) => {
      if (!startupSignal) {
        startupSignal = receivedSignal;
        resolveStartupSignal(receivedSignal);
      }
      farmProductionLifecycle.beginDrain(receivedSignal);
    };
    startupSignalListeners.set(signal, listener);
    process.once(signal, listener);
  }
}

try {
  await Promise.race([
    Promise.resolve().then(() => farmProductionLifecycle.start()),
    startupSignalPromise,
  ]);
} catch (error) {
  await farmProductionLifecycle.close("production-start-failed").catch((closeError) => {
    console.error("[Farm] Runtime cleanup after startup failure failed:", closeError);
  });
  throw error;
} finally {
  for (const [signal, listener] of startupSignalListeners) {
    process.removeListener(signal, listener);
  }
}

if (startupSignal) {
  let startupCloseTimer;
  const startupCloseCompleted = await Promise.race([
    Promise.resolve()
      .then(() => farmProductionLifecycle.close(startupSignal))
      .then(
        () => true,
        (error) => {
          console.error("[Farm] Runtime shutdown during startup failed:", error);
          process.exitCode = 1;
          return true;
        },
      ),
    new Promise((resolve) => {
      startupCloseTimer = setTimeout(() => resolve(false), farmServerConfig.gracefulShutdownTimeout);
    }),
  ]);
  clearTimeout(startupCloseTimer);
  if (!startupCloseCompleted) {
    console.warn("[Farm] Runtime startup did not settle before shutdown; forcing cleanup");
    let forcedCloseTimer;
    const forcedCloseCompleted = await Promise.race([
      Promise.resolve()
        .then(() => farmProductionLifecycle.forceClose(startupSignal))
        .then(
          () => true,
          (error) => {
            console.error("[Farm] Forced runtime shutdown during startup failed:", error);
            process.exitCode = 1;
            return true;
          },
        ),
      new Promise((resolve) => {
        forcedCloseTimer = setTimeout(
          () => resolve(false),
          farmServerConfig.gracefulShutdownTimeout,
        );
      }),
    ]);
    clearTimeout(forcedCloseTimer);
    if (!forcedCloseCompleted) {
      console.error("[Farm] Forced runtime shutdown during startup timed out");
      process.exitCode = 1;
    }
  }
  process.exit(process.exitCode || 0);
}

${
  desktop
    ? `// The shell picks the address. HOST and PORT from the user's environment never apply.
const cert = undefined;
const key = undefined;
const port = options.port ?? 0;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new TypeError("[Farm] start() port must be an integer from 0 to 65535.");
}
const host = options.host || "127.0.0.1";`
    : `const cert = process.env.NITRO_SSL_CERT;
const key = process.env.NITRO_SSL_KEY;
const configuredPort = Number(process.env.NITRO_PORT || process.env.PORT);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const host = process.env.NITRO_HOST || process.env.HOST;`
}
${node ? nodeServerSource(Boolean(desktop)) : bunServerSource(Boolean(desktop))}
setupCloseHooks(server);
trapUnhandledErrors();

let shutdownPromise;
async function shutdown(signal${desktop ? ", exitProcess = true" : ""}) {
  isShuttingDown = true;
  farmProductionLifecycle.beginDrain(signal);

  const gracefulClose = server.close().then(
    () => true,
    (error) => {
      console.error("[Farm] Runtime shutdown failed:", error);
      process.exitCode = 1;
      return true;
    },
  );
  ${node ? "nodeServer.closeIdleConnections?.();" : ""}
  let gracefulTimer;
  const gracefullyClosed = await Promise.race([
    gracefulClose,
    new Promise((resolve) => {
      gracefulTimer = setTimeout(() => resolve(false), shutdownConfig.timeout);
    }),
  ]);
  clearTimeout(gracefulTimer);

  if (!gracefullyClosed) {
    console.warn("[Farm] Graceful shutdown timed out; forcing cleanup");
    void server.close(true).catch((error) => {
      console.error("[Farm] Forced server shutdown failed:", error);
      process.exitCode = 1;
    });

    let forceTimer;
    const forceClosed = await Promise.race([
      Promise.resolve()
        .then(() => farmProductionLifecycle.forceClose("production-server-closed"))
        .then(
          () => true,
          (error) => {
            console.error("[Farm] Forced runtime shutdown failed:", error);
            process.exitCode = 1;
            return true;
          },
        ),
      new Promise((resolve) => {
        forceTimer = setTimeout(() => resolve(false), shutdownConfig.timeout);
      }),
    ]);
    clearTimeout(forceTimer);
    if (!forceClosed) {
      console.error("[Farm] Forced runtime shutdown timed out");
      process.exitCode = 1;
    }
  }

  if (shutdownConfig.forceExit${desktop ? " && exitProcess" : ""}) process.exit(process.exitCode || 0);
}

if (!shutdownConfig.disabled) {
  for (const signal of shutdownConfig.signals) {
    process.once(signal, (receivedSignal) => {
      shutdownPromise ||= shutdown(receivedSignal);
    });
  }
}

try {
  await server.serve();
  const protocol = cert && key ? "https" : "http";
  const addressInfo = ${node ? "nodeServer.address()" : "server.bun.server?.address"};${
    desktop
      ? `
  farmDesktopBoundPort = ${node ? "addressInfo?.port" : "server.bun.server?.port"};`
      : ""
  }
  if (typeof addressInfo === "string") {
    console.log(\`Listening on unix socket \${addressInfo}\`);
  } else if (addressInfo) {
    const configuredBaseURL = useRuntimeConfig().app.baseURL || "";
    const baseURL = configuredBaseURL.endsWith("/")
      ? configuredBaseURL.slice(0, -1)
      : configuredBaseURL;
    const address = addressInfo.family === "IPv6"
      ? \`[\${addressInfo.address}]\`
      : addressInfo.address;
    console.log(\`Listening on \${protocol}://\${address}:\${addressInfo.port}\${baseURL}\`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await farmProductionLifecycle.close("production-listen-error").catch((closeError) => {
    console.error("[Farm] Runtime cleanup after listen failure failed:", closeError);
  });
  throw error;
}

if (import.meta._tasks) {
  startScheduleRunner({ waitUntil: server.waitUntil });
}
${
  desktop
    ? `
const farmDesktopHost = host.includes(":") ? \`[\${host}]\` : host;
return {
  origin: \`http://\${farmDesktopHost}:\${farmDesktopBoundPort}\`,
  port: farmDesktopBoundPort,
  stop: () => (shutdownPromise ||= shutdown("stop", false)),
};
}

${DESKTOP_MAIN_SOURCE}
`
    : ""
}
export default {};
  `.trim();
}

/**
 * `start()` for a desktop shell that imports the server in-process. One server per process;
 * a second call returns the first one.
 */
const DESKTOP_START_SOURCE = `let farmDesktopServer;
export function start(options = {}) {
  farmDesktopServer ||= startFarmDesktopServer(options);
  return farmDesktopServer;
}`;

/**
 * A shell that runs the server as its own process (a sidecar) passes the values in the
 * environment and waits for the ready line, never for a timeout.
 */
const DESKTOP_MAIN_SOURCE = `function isFarmDesktopMainModule() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  try {
    return Boolean(process.argv[1]) && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isFarmDesktopMainModule()) {
  const env = process.env;
  const server = await start({
    secret: env.FARM_DESKTOP_SECRET,
    handshakeToken: env.FARM_DESKTOP_HANDSHAKE_TOKEN,
    dataDir: env.FARM_DESKTOP_DATA_DIR,
    port: env.FARM_DESKTOP_PORT ? Number(env.FARM_DESKTOP_PORT) : 0,
    host: env.FARM_DESKTOP_HOST,
  });
  // Child processes the app spawns must not inherit the session secret.
  delete env.FARM_DESKTOP_SECRET;
  delete env.FARM_DESKTOP_HANDSHAKE_TOKEN;
  console.log(${JSON.stringify(FARM_DESKTOP_READY_PREFIX)} + JSON.stringify({ port: server.port }));
}`;
