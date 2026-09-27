import { getCurrentRequest } from "./server/request";
import { parseRequestCookieHeader } from "./request-cookies";

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
  const parsed = parseRequestCookieHeader(cookieHeader);

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
