import net from "node:net";
import type { Plugin, ViteDevServer } from "vite";
import { logger } from "../utils";

const OTHER_LOOPBACK: Record<string, string> = { "::1": "127.0.0.1", "127.0.0.1": "::1" };

/**
 * The default dev host, `localhost`, resolves to one address: `::1` on macOS and `127.0.0.1` on
 * most Linux hosts. A server bound there refuses the other loopback, and that is often the one a
 * client uses: an Android emulator reaches the host's `127.0.0.1` as `10.0.2.2`, and so does
 * `adb reverse`. When Vite binds the default host, also listen on the other loopback address and
 * hand its connections to the same HTTP server. Both addresses are loopback, so nothing outside
 * the machine can connect; `--host` is still the way to expose the server.
 */
export function createFarmDevLoopbackPlugin(): Plugin {
  return {
    name: "farm:dev-loopback",
    configureServer(server) {
      // Vite calls listen again on the same server object after a restart, with this wrapper.
      const listen = server.listen.bind(server);
      server.listen = async (...args) => {
        const result = await listen(...args);
        await listenOnOtherLoopback(server);
        return result;
      };
    },
  };
}

async function listenOnOtherLoopback(server: ViteDevServer): Promise<void> {
  const host = server.config.server.host;
  if (host !== undefined && host !== false && host !== "localhost") return;
  const httpServer = server.httpServer;
  const address = httpServer?.address();
  if (!httpServer || !address || typeof address !== "object") return;
  const other = OTHER_LOOPBACK[address.address];
  if (!other) return;

  // The HTTP server parses the request, upgrades HMR sockets, and tracks the
  // socket so Vite's close destroys it.
  const loopback = net.createServer((socket) => httpServer.emit("connection", socket));
  const listening = await new Promise<boolean>((resolve) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        logger.warn(
          `Another process is listening on ${formatHost(other)}:${address.port}; the dev server answers on ${formatHost(address.address)}:${address.port} only.`,
        );
      }
      // Any other code, such as EADDRNOTAVAIL, means this machine has no loopback of that family.
      resolve(false);
    };
    loopback.once("error", onError);
    loopback.listen({ port: address.port, host: other, ipv6Only: other === "::1" }, () => {
      loopback.off("error", onError);
      resolve(true);
    });
  });
  if (!listening) return;
  loopback.on("error", (error) => logger.warn(`Dev loopback listener failed: ${String(error)}`));
  httpServer.once("close", () => loopback.close());
}

function formatHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}
