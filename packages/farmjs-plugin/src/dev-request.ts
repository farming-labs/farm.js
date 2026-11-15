import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

type DevRequest = Pick<IncomingMessage, "url" | "headers"> & { originalUrl?: string };

/**
 * Node request headers as Web `Headers`. An HTTP/2 request carries
 * pseudo-headers (`:path`, `:authority`, ...) in `req.headers`, and `Headers`
 * throws on those names, so they are skipped. `:authority` stands in for a
 * missing `host`, which is how HTTP/2 carries it.
 */
export function createDevRequestHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined || key.startsWith(":")) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  const authority = nodeHeaders[":authority"];
  if (!headers.has("host") && typeof authority === "string" && authority) {
    headers.set("host", authority);
  }
  return headers;
}

function resolveDevOrigin(headers: IncomingHttpHeaders): string {
  const authority = headers[":authority"];
  const host = headers.host ?? (typeof authority === "string" ? authority : undefined);
  // A host that is not a bare authority (it has a path, query, fragment or
  // userinfo) must not be able to move the request path.
  if (host && !/[\s/?#@\\]/u.test(host)) {
    try {
      return new URL(`http://${host}`).origin;
    } catch {
      // Fall through to localhost.
    }
  }
  return "http://localhost";
}

/**
 * The URL of a dev request. The path and query come only from `url` (parsed
 * like `new URL(url, "http://localhost")`), and the Host header only picks the
 * origin, so matching and dispatch see the same pathname whatever the Host is.
 */
export function resolveDevRequestURL(req: DevRequest, url = req.url || "/"): URL {
  const requested = new URL(url, "http://localhost");
  const resolved = new URL(resolveDevOrigin(req.headers));
  resolved.pathname = requested.pathname;
  resolved.search = requested.search;
  return resolved;
}

function cleanUrl(url: string): string {
  return url.replace(/[?#].*$/s, "");
}

function stripViteBase(url: string, base: string | undefined): string {
  if (!base || base === "/") return url;
  const devBase = base.endsWith("/") ? base : `${base}/`;
  if (cleanUrl(url) === devBase.slice(0, -1)) return "/";
  return url.startsWith(devBase) ? url.slice(devBase.length - 1) : url;
}

/**
 * Plugin middleware returned from `configureServer` runs after Vite's own, so
 * Vite's host check, CORS and base handling still apply to it. Under the
 * default `appType: "spa"` Vite's HTML fallback runs before it too, and
 * rewrites every GET that accepts HTML or any type (a plain `fetch()`) to an
 * `.html` file. Returns the URL the client asked for when that happened: the
 * original URL with Vite's base removed, as Vite's base middleware does.
 */
export function resolveViteHtmlFallbackUrl(
  req: DevRequest,
  base: string | undefined,
): string | undefined {
  const current = req.url || "/";
  const original = req.originalUrl;
  if (!original || original === current || !cleanUrl(current).endsWith(".html")) {
    return undefined;
  }
  const requested = stripViteBase(original, base);
  if (cleanUrl(requested).endsWith(".html")) return undefined;
  return requested;
}
