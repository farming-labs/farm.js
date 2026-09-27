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
  const requestUrl = new URL(request.url);
  const secure = options.secure ?? requestUrl.protocol === "https:";
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
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
