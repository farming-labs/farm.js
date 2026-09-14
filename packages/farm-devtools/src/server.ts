import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { ViteDevServer } from "vite";
import { createModuleInspector, ModuleInspectionError } from "./modules.js";
import { DEVTOOLS_PATH } from "./types.js";

/** Guard our early middleware, before Vite's own host/CORS middleware runs. */
export function isTrustedRequest(req: IncomingMessage, server: ViteDevServer): boolean {
  try {
    const authority = req.headers.host ?? "";
    if (!authority || /[\s/@\\?#]/.test(authority)) return false;
    const protocol = (req.socket as { encrypted?: boolean } | undefined)?.encrypted
      ? "https:"
      : "http:";
    const host = new URL(`${protocol}//${authority}`);
    const hostname = host.hostname.replace(/^\[|\]$/g, "");
    const allowed = server.config.server.allowedHosts;
    const explicitHost = server.config.server.host;
    const trusted =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      isIP(hostname) !== 0 ||
      (typeof explicitHost === "string" && hostname === explicitHost) ||
      (Array.isArray(allowed) &&
        allowed.some((value) =>
          value.startsWith(".")
            ? hostname === value.slice(1) || hostname.endsWith(value)
            : hostname === value,
        ));
    if (!trusted || req.headers["sec-fetch-site"] === "cross-site") return false;
    if (req.headers.origin && new URL(req.headers.origin).origin !== host.origin) return false;
    return true;
  } catch {
    return false;
  }
}

export function installDevtoolsServer(server: ViteDevServer, options: { inspect: boolean }): void {
  const inspector = createModuleInspector(server);
  const assetRoot = new URL("./ui/", import.meta.url);
  const assets = new Map<string, Promise<Buffer>>();
  let closed = false;
  server.httpServer?.once("close", () => {
    closed = true;
    assets.clear();
  });
  server.middlewares.use(async (req, res, next) => {
    let url: URL;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      return next();
    }
    if (
      url.pathname !== DEVTOOLS_PATH &&
      url.pathname !== `${DEVTOOLS_PATH}.json` &&
      !url.pathname.startsWith(`${DEVTOOLS_PATH}/`)
    )
      return next();
    if (closed) return next();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!isTrustedRequest(req, server)) {
      res.statusCode = 403;
      res.end("DevTools requires a trusted, same-origin development request.");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }
    const send = (body: string | Buffer, type: string) => {
      res.setHeader("Content-Type", type);
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      if (url.pathname === `${DEVTOOLS_PATH}.json`) return next();
      if (url.pathname === DEVTOOLS_PATH) {
        if (url.searchParams.get("embedded") !== "1") return next();
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        );
        send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Farm.js DevTools</title><link rel="stylesheet" href="${DEVTOOLS_PATH}/assets/panel.css"></head><body><div id="farm-devtools" data-inspect="${options.inspect}"></div><script type="module" src="${DEVTOOLS_PATH}/assets/panel.js"></script></body></html>`,
          "text/html; charset=utf-8",
        );
        return;
      }
      if (url.pathname === `${DEVTOOLS_PATH}/modules.json` && options.inspect) {
        send(JSON.stringify(await inspector.list()), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === `${DEVTOOLS_PATH}/module.json` && options.inspect) {
        send(
          JSON.stringify(await inspector.read(url.searchParams.get("id") ?? "")),
          "application/json; charset=utf-8",
        );
        return;
      }
      if (url.pathname.startsWith(`${DEVTOOLS_PATH}/assets/`)) {
        const name = url.pathname.slice(`${DEVTOOLS_PATH}/assets/`.length);
        const type =
          name === "panel.js"
            ? "text/javascript; charset=utf-8"
            : name === "panel.css"
              ? "text/css; charset=utf-8"
              : name === "logo.svg"
                ? "image/svg+xml"
                : /^[a-zA-Z0-9_-]+\.woff2$/.test(name)
                  ? "font/woff2"
                  : undefined;
        if (type) {
          if (!assets.has(name)) assets.set(name, readFile(new URL(name, assetRoot)));
          send(await assets.get(name)!, type);
          return;
        }
      }
      res.statusCode = 404;
      send("Not found", "text/plain; charset=utf-8");
    } catch (error) {
      res.statusCode = error instanceof ModuleInspectionError ? error.status : 500;
      send(
        JSON.stringify({
          error:
            error instanceof ModuleInspectionError
              ? error.message
              : "DevTools could not read this resource. Refresh the app and try again.",
        }),
        "application/json; charset=utf-8",
      );
    }
  });
}
