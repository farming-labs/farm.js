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
          name: decodeCookiePart(part),
          value: "",
        };
      }

      return {
        name: decodeCookiePart(part.slice(0, separatorIndex).trim()),
        value: decodeCookiePart(part.slice(separatorIndex + 1).trim()),
      };
    })
    .filter((cookie) => cookie.name.length > 0);
}

function decodeCookiePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
