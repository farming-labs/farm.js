import { createHmac, timingSafeEqual } from "node:crypto";

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

/**
 * Decode a cookie value, tolerating malformed percent-encoding. A request can
 * carry a cookie whose value is not valid UTF-8 percent-encoding (a latin-1
 * value from an old link, a crawler, or an attacker-planted sibling-domain
 * cookie); `decodeURIComponent` throws `URIError` on those. Falling back to the
 * raw value keeps a single bad cookie from turning every auth route into a 500.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookieHeaderMap(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [key, decodeCookieValue(rest.join("="))];
      }),
  );
}

export function parseCookieHeaderList(header: string | null): ParsedCookie[] {
  return Object.entries(parseCookieHeaderMap(header)).map(([name, value]) => ({
    name,
    value,
  }));
}

export function getCookieValue(headers: Headers, name: string): string | null {
  return parseCookieHeaderMap(headers.get("cookie"))[name] ?? null;
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

/**
 * Sign a value for storage in a cookie.
 *
 * Auth integrations put state that the browser must hand back (OAuth `state`,
 * session payloads) into cookies. Those values are attacker-reachable, so they
 * carry an HMAC and are rejected on any mismatch. One implementation is shared
 * so the verification rules cannot drift between integrations.
 *
 * This provides integrity, not confidentiality: the payload is encoded, not
 * encrypted, and is readable by anyone holding the cookie. Do not sign secrets
 * the browser should not see.
 */
export function signCookieValue(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Verify and decode a value produced by {@link signCookieValue}. Returns null
 * for anything missing, malformed, tampered with, or signed by another secret,
 * so callers can treat a null as "no usable value" without distinguishing the
 * failure modes to the client.
 */
export function unsignCookieValue<T>(signed: string | undefined | null, secret: string): T | null {
  if (!signed) {
    return null;
  }

  const separator = signed.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const payload = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  // timingSafeEqual throws on length mismatch, so compare lengths first.
  if (signature.length !== expected.length) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
