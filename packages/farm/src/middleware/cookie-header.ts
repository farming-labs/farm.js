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
