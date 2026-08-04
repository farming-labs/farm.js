import type { ResolvedFarmServerConfig } from "../server-http";

export interface FarmNodeServerEntryOptions {
  nitroEntryFile: string;
  nodeHandlerModule: string;
  server: ResolvedFarmServerConfig;
  websocketAdapterModule: string;
}

/** Generate the long-running Node adapter entry while retaining Nitro's routing runtime. */
export function createFarmNodeServerEntry(options: FarmNodeServerEntryOptions): string {
  const serverConfig = JSON.stringify(options.server);
  const nitroEntryImport = `./${options.nitroEntryFile.replace(/^\.\//, "")}`;

  return `
import "#nitro-internal-pollyfills";
import { Server as HttpServer } from "node:http";
import { Server as HttpsServer } from "node:https";
import wsAdapter from ${JSON.stringify(options.websocketAdapterModule)};
import { toNodeHandler } from ${JSON.stringify(options.nodeHandlerModule)};
import { useNitroApp, useRuntimeConfig } from "nitro/runtime";
import {
  getGracefulShutdownConfig,
  setupGracefulShutdown,
  startScheduleRunner,
  trapUnhandledNodeErrors,
} from "nitro/runtime/internal";
import { farmProductionLifecycle } from ${JSON.stringify(nitroEntryImport)};

const farmServerConfig = ${serverConfig};
if (!process.env.NITRO_SHUTDOWN_TIMEOUT) {
  process.env.NITRO_SHUTDOWN_TIMEOUT = String(farmServerConfig.gracefulShutdownTimeout);
}
const shutdownConfig = getGracefulShutdownConfig();

const nitroApp = useNitroApp();
nitroApp.hooks.hook("close", async () => {
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
    console.error("[Farm] Runtime shutdown during startup timed out");
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

const cert = process.env.NITRO_SSL_CERT;
const key = process.env.NITRO_SSL_KEY;
const server = cert && key
  ? new HttpsServer({ key, cert }, toNodeHandler(nitroApp.fetch))
  : new HttpServer(toNodeHandler(nitroApp.fetch));

server.headersTimeout = farmServerConfig.headersTimeout;
server.requestTimeout = farmServerConfig.requestTimeout;
server.keepAliveTimeout = farmServerConfig.keepAliveTimeout;

if (!shutdownConfig.disabled) {
  for (const signal of shutdownConfig.signals) {
    process.once(signal, () => farmProductionLifecycle.beginDrain(signal));
  }
}

const configuredPort = Number(process.env.NITRO_PORT || process.env.PORT);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const host = process.env.NITRO_HOST || process.env.HOST;
const socketPath = process.env.NITRO_UNIX_SOCKET;
const listener = server.listen(socketPath ? { path: socketPath } : { port, host }, () => {
  const protocol = cert && key ? "https" : "http";
  const addressInfo = listener.address();
  if (typeof addressInfo === "string") {
    console.log(\`Listening on unix socket \${addressInfo}\`);
    return;
  }
  if (!addressInfo) return;
  const configuredBaseURL = useRuntimeConfig().app.baseURL || "";
  const baseURL = configuredBaseURL.endsWith("/") ? configuredBaseURL.slice(0, -1) : configuredBaseURL;
  const address = addressInfo.family === "IPv6" ? \`[\${addressInfo.address}]\` : addressInfo.address;
  console.log(\`Listening on \${protocol}://\${address}:\${addressInfo.port}\${baseURL}\`);
});

server.once("error", async (error) => {
  console.error(error);
  process.exitCode = 1;
  await farmProductionLifecycle.close("production-listen-error").catch((closeError) => {
    console.error("[Farm] Runtime cleanup after listen failure failed:", closeError);
  });
});

trapUnhandledNodeErrors();
setupGracefulShutdown(listener, nitroApp);

if (import.meta._websocket) {
  const { handleUpgrade } = wsAdapter(nitroApp.h3App.websocket);
  server.on("upgrade", handleUpgrade);
}
if (import.meta._tasks) {
  startScheduleRunner();
}

export default {};
  `.trim();
}
