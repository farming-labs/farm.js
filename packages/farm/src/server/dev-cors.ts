import type { IncomingMessage, ServerResponse } from "http";

/**
 * Vite's default `server.cors.origin`: `localhost`, `*.localhost`, `127.0.0.1`, and `[::1]` on any
 * port. Another local dev server, such as a federation host, loads modules from this one.
 */
const VITE_DEFAULT_CORS_ORIGIN =
  /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
/** The methods Vite's CORS middleware allows in a preflight. */
const VITE_DEFAULT_CORS_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE";

function appendVary(res: ServerResponse, value: string): void {
  const current = res.getHeader("Vary");
  const values = String(current ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (values.includes("*") || values.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    return;
  }
  res.setHeader("Vary", [...values, value].join(", "));
}

/**
 * Vite's default CORS policy for the requests Farm hands to Vite: modules, `/@vite/*`, `/@fs/*`,
 * pre-bundled dependencies, and public files. Mounted after Farm's own routes, so pages, API
 * routes, middleware, and `routeRules` answer `OPTIONS` and CORS as they do in production.
 */
export function createFarmDevViteCorsMiddleware() {
  return function farmDevViteCors(
    req: IncomingMessage,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): void {
    const origin = req.headers.origin;
    if (
      typeof origin === "string" &&
      VITE_DEFAULT_CORS_ORIGIN.test(origin) &&
      !res.hasHeader("Access-Control-Allow-Origin")
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    appendVary(res, "Origin");
    if (req.method?.toUpperCase() !== "OPTIONS") {
      next();
      return;
    }
    res.setHeader("Access-Control-Allow-Methods", VITE_DEFAULT_CORS_METHODS);
    appendVary(res, "Access-Control-Request-Headers");
    const requestHeaders = req.headers["access-control-request-headers"];
    if (requestHeaders) res.setHeader("Access-Control-Allow-Headers", requestHeaders);
    res.statusCode = 204;
    res.setHeader("Content-Length", "0");
    res.end();
  };
}
