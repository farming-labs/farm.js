import type { CookieOptions } from "./index.js";

/**
 * Parse cookies from a Cookie header.
 *
 * A single request cookie whose value is not valid UTF-8 percent-encoding
 * (a latin-1 value from an old link, a crawler, or a bare `%`) must not take
 * the whole map down: an unguarded `decodeURIComponent` throws `URIError`,
 * which — because the middleware runner swallows the throw and calls `next()` —
 * would silently skip every middleware for that request (a dev-time auth
 * bypass). Decoding falls back to the raw value per entry instead.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader.split(";").reduce(
    (cookies, cookie) => {
      const [name, ...rest] = cookie.split("=");
      const value = rest.join("=").trim();
      if (name && value) {
        cookies[name.trim()] = decodeCookieValue(value);
      }
      return cookies;
    },
    {} as Record<string, string>,
  );
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Whether a middleware registered at `middlewarePath` applies to `pathname`.
 *
 * Matching is by path segment, not raw string prefix: middleware at `/admin`
 * covers `/admin` and everything under `/admin/`, but not sibling routes like
 * `/administrator` or `/admin-public` that merely share a textual prefix.
 */
export function middlewareMatchesPath(pathname: string, middlewarePath: string): boolean {
  if (middlewarePath === "/") return true;
  if (pathname === middlewarePath) return true;
  return pathname.startsWith(`${middlewarePath}/`);
}

/**
 * Serialize a cookie.
 *
 * `Max-Age=0` is the canonical immediate-expiry directive, so the attribute is
 * emitted whenever `maxAge` is provided — a `0` must not be dropped the way a
 * plain truthiness check would drop it.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
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
