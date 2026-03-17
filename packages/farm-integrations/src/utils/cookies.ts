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
        return [key, decodeURIComponent(rest.join("="))];
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
