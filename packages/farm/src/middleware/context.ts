/**
 * Middleware Context Implementation
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { ViteDevServer } from "vite";
import type { MiddlewareContext, CookieJar, CookieOptions } from "./types";
import type { FarmServerConfig, ResolvedFarmServerConfig } from "../server-http";
import { resolveFarmRequestURL } from "../server/request";
import {
  parseMiddlewareCookieHeader,
  serializeMiddlewareCookie as serializeCookie,
  serializeMiddlewareCookieDeletion,
} from "./cookie-header";

/**
 * Serialize a cookie
 */
/**
 * Cookie Jar implementation
 */
class CookieJarImpl implements CookieJar {
  private cookies: Record<string, string>;
  private setCookies: string[];

  constructor(
    private req: IncomingMessage,
    private res: ServerResponse,
  ) {
    this.cookies = parseMiddlewareCookieHeader(req.headers.cookie);
    const existing = res.getHeader("Set-Cookie");
    this.setCookies = Array.isArray(existing)
      ? existing.map(String)
      : existing === undefined
        ? []
        : [String(existing)];
  }

  get(name: string): string | undefined {
    return this.cookies[name];
  }

  set(name: string, value: string, options: CookieOptions = {}): void {
    this.cookies[name] = value;
    const cookieString = serializeCookie(name, value, options);
    this.setCookies.push(cookieString);

    // Update Set-Cookie header
    this.res.setHeader("Set-Cookie", this.setCookies);
  }

  delete(name: string, options: CookieOptions = {}): void {
    delete this.cookies[name];
    // Path and Domain must match the cookie that was set, or the tombstone
    // addresses a different cookie and the original survives.
    this.setCookies.push(serializeMiddlewareCookieDeletion(name, options));
    this.res.setHeader("Set-Cookie", this.setCookies);
  }

  getAll(): Record<string, string> {
    return { ...this.cookies };
  }
}

/**
 * Create a middleware context from request/response
 */
export function createContext(
  req: IncomingMessage,
  res: ServerResponse,
  viteServer?: ViteDevServer,
  parent?: MiddlewareContext["parent"],
  server?: FarmServerConfig | ResolvedFarmServerConfig,
): MiddlewareContext {
  const url = resolveFarmRequestURL(req, { trustProxy: server?.trustProxy });
  const headers = new Map<string, string>();
  const data = parent?.data ? new Map(parent.data) : new Map<string, any>();
  const locals = parent?.locals ? new Map(parent.locals) : new Map<string, any>();
  const cookies = new CookieJarImpl(req, res);

  if (parent?.headers) {
    for (const [key, value] of Object.entries(parent.headers)) {
      headers.set(key, value);
    }
  }

  let handled = false;

  const applyResponseHeaders = () => {
    for (const [key, value] of headers) {
      try {
        res.setHeader(key, value);
      } catch {
        // Keep helper behavior aligned with the middleware manager: an invalid
        // optional header must not prevent the response itself from completing.
      }
    }
  };

  const ctx: MiddlewareContext = {
    request: req,
    response: res,
    url,
    pathname: url.pathname,
    searchParams: url.searchParams,
    method: req.method || "GET",
    params: {},
    route: url.pathname,
    parent,
    vite: {
      isDev: process.env.NODE_ENV !== "production",
      hmr: !!viteServer?.hot,
      server: viteServer,
    },
    data,
    locals,
    headers,
    cookies,
    _handled: false,

    redirect(redirectUrl: string, status = 307): void {
      if (handled) {
        console.warn("Response already sent, cannot redirect");
        return;
      }

      ctx._redirectUrl = redirectUrl;
      ctx._handled = true;
      handled = true;

      applyResponseHeaders();
      res.writeHead(status, {
        Location: redirectUrl,
        "Content-Type": "text/plain",
      });
      res.end(`Redirecting to ${redirectUrl}`);
    },

    rewrite(rewriteUrl: string): void {
      ctx._rewriteUrl = rewriteUrl;
      // Update the URL for downstream middleware
      const newUrl = new URL(rewriteUrl, `http://${req.headers.host || "localhost"}`);
      ctx.url = newUrl;
      ctx.pathname = newUrl.pathname;
      ctx.searchParams = newUrl.searchParams;
      ctx.route = newUrl.pathname;
      // Update the original request URL
      req.url = rewriteUrl;
    },

    json(jsonData: any, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send JSON");
        return;
      }

      ctx._handled = true;
      handled = true;

      applyResponseHeaders();
      res.writeHead(status, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(jsonData));
    },

    text(content: string, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send text");
        return;
      }

      ctx._handled = true;
      handled = true;

      applyResponseHeaders();
      res.writeHead(status, {
        "Content-Type": "text/plain",
      });
      res.end(content);
    },

    html(content: string, status = 200): void {
      if (handled) {
        console.warn("Response already sent, cannot send HTML");
        return;
      }

      ctx._handled = true;
      handled = true;

      applyResponseHeaders();
      res.writeHead(status, {
        "Content-Type": "text/html",
      });
      res.end(content);
    },
  };

  return ctx;
}
