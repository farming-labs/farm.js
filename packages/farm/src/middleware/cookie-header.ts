import type { CookieOptions } from "./types";

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Cookies are not required to be percent-encoded; keep the raw value
    // instead of failing the whole request on malformed encoding.
    return value;
  }
}

export function parseMiddlewareCookieHeader(cookieHeader?: string | null): Record<string, string> {
  const cookies = Object.create(null) as Record<string, string>;
  if (!cookieHeader) return cookies;

  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;

    const name = cookie.slice(0, separator).trim();
    if (!name) continue;

    const value = cookie.slice(separator + 1).trim();
    cookies[name] = decodeCookieValue(value);
  }

  return cookies;
}

/**
 * Apply the attributes a cookie name prefix makes mandatory.
 *
 * Browsers reject a `Set-Cookie` whose name starts with `__Host-` or
 * `__Secure-` unless it carries `Secure` (and, for `__Host-`, `Path=/` with no
 * `Domain`). A rejected header is discarded silently, so emitting one without
 * these attributes makes both a set and a *deletion* a no-op — a logout that
 * looks like it worked while the session cookie stays live. The attributes are
 * therefore derived from the name rather than trusted from the caller.
 */
export function applyCookieNamePrefixRequirements(
  name: string,
  options: CookieOptions,
): CookieOptions {
  if (name.startsWith("__Host-")) {
    return { ...options, secure: true, path: "/", domain: undefined };
  }
  if (name.startsWith("__Secure-")) {
    return { ...options, secure: true };
  }
  return options;
}

export function serializeMiddlewareCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const resolved = applyCookieNamePrefixRequirements(name, options);
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (resolved.maxAge != null) cookie += `; Max-Age=${resolved.maxAge}`;
  if (resolved.expires) cookie += `; Expires=${resolved.expires.toUTCString()}`;
  cookie += `; Path=${resolved.path || "/"}`;
  if (resolved.domain) cookie += `; Domain=${resolved.domain}`;
  if (resolved.secure) cookie += "; Secure";
  if (resolved.httpOnly) cookie += "; HttpOnly";
  if (resolved.sameSite) {
    cookie += `; SameSite=${resolved.sameSite.charAt(0).toUpperCase()}${resolved.sameSite.slice(1)}`;
  }

  return cookie;
}

/**
 * Serialize the tombstone that removes a cookie. A deletion only matches the
 * stored cookie when its `Path` and `Domain` match the ones it was set with,
 * so callers must be able to pass them through.
 */
export function serializeMiddlewareCookieDeletion(
  name: string,
  options: CookieOptions = {},
): string {
  return serializeMiddlewareCookie(name, "", { ...options, maxAge: 0, expires: new Date(0) });
}
