/**
 * Middleware Context Implementation
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { ViteDevServer } from "vite";
import type { MiddlewareContext, CookieJar, CookieOptions } from "./types";
import { parseMiddlewareCookieHeader } from "./cookie-header";

/**
 * Serialize a cookie
 */
function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge != null) {
    cookie += `; Max-Age=${options.maxAge}`;
  }

  if (options.expires) {
    cookie += `; Expires=${options.expires.toUTCString()}`;
  }

  if (options.path) {
    cookie += `; Path=${options.path}`;
  } else {
    cookie += "; Path=/";
  }

  if (options.domain) {
    cookie += `; Domain=${options.domain}`;
  }

  if (options.secure) {
    cookie += "; Secure";
  }

  if (options.httpOnly) {
    cookie += "; HttpOnly";
  }

  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
  }

  return cookie;
}

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

  delete(name: string): void {
    delete this.cookies[name];
    const cookieString = serializeCookie(name, "", {
      maxAge: 0,
      expires: new Date(0),
    });
    this.setCookies.push(cookieString);
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
): MiddlewareContext {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
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
