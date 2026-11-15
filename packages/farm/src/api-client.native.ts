/**
 * `@farm.js/core/api/client` for React Native screens (`page.native.tsx`). Metro resolves this
 * file through the `react-native` export condition; web builds never see it, so web bundles do
 * not change. It has the web client's exports and types: an app's `createApiClients` module works
 * unchanged on a native screen, and `apiClient.notes.post({ body })` calls the same API route the
 * web page calls.
 *
 * Without a `baseURL` or `fetch` of their own, the clients call the app's server (`mobile.server`,
 * or the dev server under `farm dev --mobile`) through `serverFetch` from `@farm.js/native`, which
 * sends the device's session once the user signed in on a web screen.
 */
import * as web from "./api-client";

export * from "./api-client";

/** Where requests for the app's server point until `serverFetch` sends them. */
const SERVER = "https://farm-native.invalid";

/**
 * `@farm.js/native` registers `serverFetch` here when a native bundle loads, so core needs no
 * dependency on it.
 */
const SERVER_FETCH = Symbol.for("farm.native.serverFetch");

type ServerFetch = (path: string, init?: RequestInit) => Promise<Response>;

function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== SERVER) return fetch(input, init);
  const serverFetch = (globalThis as Record<symbol, ServerFetch | undefined>)[SERVER_FETCH];
  if (!serverFetch) {
    throw new Error(
      "@farm.js/core/api/client needs @farm.js/native on a native screen: install it, or pass " +
        "createApiClients({ baseURL }) to call another server.",
    );
  }
  return serverFetch(`${url.pathname}${url.search}`, init);
}

function nativeOptions<T extends { baseURL?: string; fetch?: typeof fetch }>(options: T): T {
  return options.baseURL || options.fetch
    ? options
    : { ...options, baseURL: SERVER, fetch: nativeFetch as typeof fetch };
}

export const createApiClients = ((options = {}) =>
  web.createApiClients(nativeOptions(options) as never)) as typeof web.createApiClients;

export const createAPIClient = ((options = {}) =>
  web.createAPIClient(nativeOptions(options) as never)) as typeof web.createAPIClient;
