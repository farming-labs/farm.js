import type { IncomingMessage, ServerResponse } from "node:http";
import type { ViteDevServer } from "vite";
import { sendWebResponse } from "../server/response";
import { FARM_DESKTOP_DEV_SESSION, type FarmDesktopDevSession } from "./config";
import { createFarmDesktopGuard } from "./guard";

export { FARM_DESKTOP_DEV_SESSION };

export function getFarmDesktopDevSession(): FarmDesktopDevSession | undefined {
  return (globalThis as Record<PropertyKey, unknown>)[FARM_DESKTOP_DEV_SESSION] as
    | FarmDesktopDevSession
    | undefined;
}

/**
 * The desktop guard as the first dev middleware, ahead of Farm's routes and Vite's module and
 * file serving, so the dev server answers only the desktop window as the packaged app does.
 * Vite's HMR WebSocket keeps its own token check.
 */
export function createFarmDesktopDevGuard(
  server: ViteDevServer,
  options: { basePath: string },
): (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void {
  const session = getFarmDesktopDevSession();
  if (!session) {
    throw new Error(
      "[Farm] FARM_PLATFORM=desktop without a desktop session. Start desktop development with `farm dev --desktop`.",
    );
  }
  const guard = createFarmDesktopGuard({
    secret: session.secret,
    handshakeToken: session.handshakeToken,
    basePath: options.basePath,
    handshakeState: session,
    port: () => {
      const address = server.httpServer?.address();
      return address && typeof address === "object" ? address.port : undefined;
    },
  });
  return (request, response, next) => {
    const blocked = guard({
      method: request.method || "GET",
      url: request.url || "/",
      headers: {
        get(name) {
          const value = request.headers[name];
          return Array.isArray(value) ? value.join(", ") : (value ?? null);
        },
      },
    });
    if (!blocked) return next();
    // The window never sees a 403 body, so say in the terminal what was refused and why.
    server.config.logger.warn(
      `[farm] desktop guard refused ${request.method} ${(request.url || "/").split("?")[0]}: ${blocked.headers.get("x-farm-desktop-guard") ?? "forbidden"}`,
      { timestamp: true },
    );
    sendWebResponse(response, blocked).catch(next);
  };
}
