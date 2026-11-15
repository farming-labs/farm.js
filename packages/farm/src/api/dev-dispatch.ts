import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ViteDevServer } from "vite";
import type { PluginAPIDispatch } from "./plugin-route-runtime";

/**
 * Internal: sends a plugin's app-endpoint request (an MCP tool, say) back through this dev
 * server, so the endpoint's middleware and integration guards run for it, as in production.
 *
 * The request's origin came from the caller's Host header, so the connection never goes
 * there: it always goes to this server's own listener. The Host header still carries the
 * caller's value, which already passed Vite's host check, so routing and origin checks see
 * the same request a direct call would.
 */
export function createFarmDevServerDispatch(
  server: Pick<ViteDevServer, "httpServer" | "config">,
): PluginAPIDispatch {
  return (request) =>
    new Promise<Response>((resolve, reject) => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") {
        throw new Error(
          "Farm cannot dispatch an app endpoint request: the Vite dev server has no listening HTTP server.",
        );
      }
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        headers[name] = value;
      });
      headers.host = url.host;
      const secure = Boolean(server.config.server.https);
      const outgoing = (secure ? https : http).request(
        {
          host: loopbackAddress(address),
          port: address.port,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers,
          signal: request.signal,
          // The listener is this process's own dev server, often with a self-signed certificate.
          ...(secure ? { rejectUnauthorized: false } : {}),
        },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            for (const entry of Array.isArray(value) ? value : [value]) {
              responseHeaders.append(name, entry);
            }
          }
          const status = incoming.statusCode ?? 502;
          // A null-body status (204, 205, 304) cannot carry a body into a Response.
          const hasBody =
            request.method !== "HEAD" && status !== 204 && status !== 205 && status !== 304;
          if (!hasBody) incoming.resume();
          try {
            resolve(
              new Response(
                hasBody
                  ? (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>)
                  : null,
                { status, statusText: incoming.statusMessage, headers: responseHeaders },
              ),
            );
          } catch (error) {
            incoming.destroy();
            reject(error);
          }
        },
      );
      outgoing.on("error", reject);
      if (request.body) {
        Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>)
          .on("error", (error) => outgoing.destroy(error))
          .pipe(outgoing);
      } else {
        outgoing.end();
      }
    });
}

function loopbackAddress({ address }: AddressInfo): string {
  // A wildcard listener accepts loopback connections on its family.
  return address === "0.0.0.0" ? "127.0.0.1" : address === "::" ? "::1" : address;
}
