import { _assertRequestReadAllowed, getCurrentRequest } from "./server/request";
import { _resolveCurrentCspNonce } from "./server/request-bridge";
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
  _assertRequestReadAllowed("headers()");
  return new Headers(getCurrentRequest().headers) as ReadonlyHeaders;
}

export function cookies(): ReadonlyRequestCookies {
  _assertRequestReadAllowed("cookies()");
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

/**
 * The CSP nonce of the response being rendered, or `undefined` when
 * `security.csp.nonce` is off or nothing is being rendered.
 *
 * In nonce mode Farm keeps the nonce only on scripts that carry it: its own
 * bootstraps and the renderer's streaming scripts. Pass it to an inline
 * script the app writes itself, `<script nonce={getCspNonce()}>`, to let that
 * script run. Every other script loses its nonce attribute.
 */
export function getCspNonce(): string | undefined {
  _assertRequestReadAllowed("getCspNonce()");
  return _resolveCurrentCspNonce();
}
