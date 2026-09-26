import type { ResolvedFarmServerConfig } from "../server-http";

export interface FarmNodeServerEntryOptions {
  nitroEntryFile: string;
  nodeAdapterModule: string;
  server: ResolvedFarmServerConfig;
  websocketAdapterModule: string;
}

/** Generate the long-running Node adapter entry while retaining Nitro's routing runtime. */
export function createFarmNodeServerEntry(options: FarmNodeServerEntryOptions): string {
  const serverConfig = JSON.stringify(options.server);
  const nitroEntryImport = `./${options.nitroEntryFile.replace(/^\.\//, "")}`;

  return `
import "#nitro/virtual/polyfills";
import { NodeRequest, serve } from ${JSON.stringify(options.nodeAdapterModule)};
import wsAdapter from ${JSON.stringify(options.websocketAdapterModule)};
import { useNitroApp, useNitroHooks } from "nitro/app";
import { useRuntimeConfig } from "nitro/runtime-config";
import { resolveWebsocketHooks } from "#nitro/runtime/app";
import { trapUnhandledErrors } from "#nitro/runtime/error/hooks";
import { setupCloseHooks } from "#nitro/runtime/shutdown";
import { startScheduleRunner } from "#nitro/runtime/task";
import { tracingSrvxPlugins } from "#nitro/virtual/tracing";
import { farmProductionLifecycle } from ${JSON.stringify(nitroEntryImport)};

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

const cert = process.env.NITRO_SSL_CERT;
const key = process.env.NITRO_SSL_KEY;
const configuredPort = Number(process.env.NITRO_PORT || process.env.PORT);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const host = process.env.NITRO_HOST || process.env.HOST;
const socketPath = process.env.NITRO_UNIX_SOCKET;
const server = serve({
  manual: true,
  silent: true,
  gracefulShutdown: false,
  port,
  hostname: host,
  node: socketPath ? { path: socketPath } : undefined,
  tls: cert && key ? { cert, key } : undefined,
  fetch: nitroApp.fetch,
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
  nodeServer.on("upgrade", (request, socket, head) => {
    handleUpgrade(
      request,
      socket,
      head,
      new NodeRequest({ req: request, upgrade: { socket, head } }),
    );
  });
}

setupCloseHooks(server);
trapUnhandledErrors();

let shutdownPromise;
async function shutdown(signal) {
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
  nodeServer.closeIdleConnections?.();
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

  if (shutdownConfig.forceExit) process.exit(process.exitCode || 0);
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
  const addressInfo = nodeServer.address();
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

export default {};
  `.trim();
}
