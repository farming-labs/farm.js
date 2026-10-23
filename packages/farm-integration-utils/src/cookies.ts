import { parseRequestCookieHeader } from "@farm.js/core/internal/request-cookies";

export interface ParsedCookie {
  name: string;
  value: string;
}

export interface RequestCookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  secure?: boolean;
  domain?: string;
  expires?: Date;
}

/** Collapse duplicate names using the first value in request-header order. */
export function parseCookieHeaderMap(header: string | null): Record<string, string> {
  const cookies = Object.create(null) as Record<string, string>;

  for (const cookie of parseCookieHeaderList(header)) {
    if (Object.prototype.hasOwnProperty.call(cookies, cookie.name)) continue;
    cookies[cookie.name] = cookie.value;
  }

  return cookies;
}

export function parseCookieHeaderList(header: string | null): ParsedCookie[] {
  return parseRequestCookieHeader(header);
}

/** Read the first matching value, consistent with core `cookies().get(name)`. */
export function getCookieValue(headers: Headers, name: string): string | null {
  return (
    parseCookieHeaderList(headers.get("cookie")).find((cookie) => cookie.name === name)?.value ??
    null
  );
}

export function createRequestCookie(
  name: string,
  value: string,
  request: Request,
  options: RequestCookieOptions = {},
): string {
  // Browsers silently discard a `__Host-` or `__Secure-` cookie without the
  // attributes its name requires, and a SameSite=None cookie without Secure.
  // Both a set and its deletion would then do nothing, so these come from the
  // name and SameSite rather than from the caller.
  const hostPrefixed = name.startsWith("__Host-");
  const secure =
    hostPrefixed ||
    name.startsWith("__Secure-") ||
    options.sameSite === "None" ||
    (options.secure ?? isHttpsRequest(request));
  const path = hostPrefixed ? "/" : options.path || "/";
  const domain = hostPrefixed ? undefined : options.domain;
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${path}`];

  if (options.maxAge != null) {
    if (!Number.isFinite(options.maxAge)) {
      throw new TypeError(`Cookie "${name}" maxAge must be a finite number of seconds.`);
    }
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (domain) {
    parts.push(`Domain=${domain}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (secure) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${options.sameSite || "Lax"}`);

  return parts.join("; ");
}

export function clearRequestCookie(
  name: string,
  request: Request,
  options: Omit<RequestCookieOptions, "maxAge"> = {},
): string {
  return createRequestCookie(name, "", request, {
    ...options,
    maxAge: 0,
  });
}

/**
 * Behind a TLS-terminating proxy the request URL is `http:`. Trusting
 * `X-Forwarded-Proto: https` here only ever adds `Secure`, and only for the
 * client that sent it, so it is safe without `trustProxy`.
 */
function isHttpsRequest(request: Request): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return forwarded?.toLowerCase() === "https";
}
