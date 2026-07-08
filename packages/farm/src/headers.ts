import { getCurrentRequest } from "./server/request";

export interface RequestCookie {
  name: string;
  value: string;
}

export interface ReadonlyHeaders extends Iterable<[string, string]> {
  get(name: string): string | null;
  has(name: string): boolean;
  forEach(callbackfn: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
}

export interface ReadonlyRequestCookies extends Iterable<RequestCookie> {
  get(name: string): RequestCookie | undefined;
  getAll(name?: string): RequestCookie[];
  has(name: string): boolean;
  toString(): string;
}

export function headers(): ReadonlyHeaders {
  return new Headers(getCurrentRequest().headers) as ReadonlyHeaders;
}

export function cookies(): ReadonlyRequestCookies {
  const cookieHeader = getCurrentRequest().headers.get("cookie") || "";
  const parsed = parseCookieHeader(cookieHeader);

  return {
    get(name) {
      return parsed.find((cookie) => cookie.name === name);
    },
    getAll(name) {
      return name ? parsed.filter((cookie) => cookie.name === name) : [...parsed];
    },
    has(name) {
      return parsed.some((cookie) => cookie.name === name);
    },
    toString() {
      return cookieHeader;
    },
    [Symbol.iterator]() {
      return parsed[Symbol.iterator]();
    },
  };
}

function parseCookieHeader(header: string): RequestCookie[] {
  if (!header.trim()) return [];

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

function decodeCookiePart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
