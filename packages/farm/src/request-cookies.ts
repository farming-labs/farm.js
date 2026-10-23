export interface ParsedRequestCookie {
  name: string;
  value: string;
}

/** Parse request cookies in wire order without collapsing duplicate names. */
export function parseRequestCookieHeader(header: string | null | undefined): ParsedRequestCookie[] {
  if (!header?.trim()) return [];

  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        return {
          name: decodeCookieName(part),
          value: "",
        };
      }

      return {
        name: decodeCookieName(part.slice(0, separatorIndex).trim()),
        value: decodeCookiePart(part.slice(separatorIndex + 1).trim()),
      };
    })
    .filter((cookie) => cookie.name.length > 0);
}

const RESERVED_PREFIX = /^__(host|secure)-/i;

/**
 * A cookie name as Farm wrote it: names are percent-encoded when set, so they are decoded when read.
 * A browser enforces the `__Host-` / `__Secure-` prefixes on the raw name only, so an encoded name
 * like `__Host%2Dsid` reaches the server without the guarantees. Decoded, it would read as the
 * protected `__Host-sid`: a sibling subdomain could set it with a longer Path, which browsers send
 * first, and shadow the real one. A name keeps its raw form when decoding would add the prefix.
 */
export function decodeCookieName(raw: string): string {
  const decoded = decodeCookiePart(raw);
  return RESERVED_PREFIX.test(decoded) && !RESERVED_PREFIX.test(raw) ? raw : decoded;
}

function decodeCookiePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
