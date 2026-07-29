import type { PluginOption } from "vite";
import type { ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "http";
import { H3Event, toNodeListener } from "h3";
import { fromWebHandler } from "h3";

/**
 * Convert Node.js request to Web Standard Request
 */
function nodeToWebRequest(req: IncomingMessage, baseUrl: string): Request {
  const url = new URL(req.url || "/", baseUrl);
  const headers = new Headers();

  // Copy headers
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
  }

  // Get body for non-GET requests
  let body: ReadableStream | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = req as any; // Node.js stream can be used as ReadableStream
  }

  return new Request(url.toString(), {
    method: req.method || "GET",
    headers,
    body,
  });
}

/**
 * Convert Web Standard Response to Node.js response
 */
async function webToNodeResponse(res: ServerResponse, webRes: Response): Promise<void> {
  // Set status
  res.statusCode = webRes.status;

  // Set headers
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  // Write body
  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
}

/**
 * Development server plugin for universal build pattern
 * Converts Node.js requests to Web Standard Requests and back
 */
export function devServerPlugin(): PluginOption {
  return {
    name: "farm-dev-server",
    configureServer(viteDevServer: ViteDevServer) {
      viteDevServer.middlewares.use(async (req, res, next) => {
        try {
          // Always handle Farm.js internal routes
          const isFarmRoute = req.url?.startsWith("/__farm/");

          // Debug logging
          if (isFarmRoute) {
            console.log("[Farm.js] [DEV-SERVER] Farm route detected:", req.url);
          }

          // Skip Vite internal requests (but not Farm routes)
          if (
            !isFarmRoute &&
            (req.url?.startsWith("/@") ||
              req.url?.startsWith("/node_modules") ||
              (req.url?.includes(".") && !req.url?.endsWith(".html")))
          ) {
            return next();
          }

          // Convert Node.js request to Web Standard Request
          const baseUrl = `http://${req.headers.host || "localhost:3000"}`;
          const webReq = nodeToWebRequest(req, baseUrl);

          // Import server entry (using virtual module or actual file)
          // For dev, we can use the actual server-entry file
          const serverEntryPath = "/@farm/server-entry";
          let serverEntry;
          try {
            serverEntry = await viteDevServer.ssrLoadModule(serverEntryPath);
          } catch {
            // Fallback: try to load from actual file
            const { join } = await import("path");
            const actualPath = join(
              viteDevServer.config.root,
              "node_modules",
              "@farm.js",
              "core",
              "src",
              "nitro",
              "server-entry.ts",
            );
            serverEntry = await viteDevServer.ssrLoadModule(actualPath);
          }

          // Call the fetch handler
          const handler = serverEntry.default?.fetch || serverEntry.fetch;
          if (!handler) {
            throw new Error("Server entry does not export a fetch handler");
          }

          const webRes = await handler(webReq);

          // Convert Web Standard Response back to Node.js
          await webToNodeResponse(res, webRes);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
