type CurrentRequestResolver = () => Request | undefined;
type AppRequestView = (request: Request) => Request;

const CURRENT_REQUEST_RESOLVER_KEY = Symbol.for("farm.currentRequestResolver");
const APP_REQUEST_VIEW_KEY = Symbol.for("farm.appRequestView");

type GlobalWithCurrentRequestResolver = typeof globalThis & {
  [CURRENT_REQUEST_RESOLVER_KEY]?: CurrentRequestResolver;
  [APP_REQUEST_VIEW_KEY]?: AppRequestView;
};

function getGlobalState(): GlobalWithCurrentRequestResolver {
  return globalThis as GlobalWithCurrentRequestResolver;
}

export function _setCurrentRequestResolver(resolver: CurrentRequestResolver | undefined): void {
  getGlobalState()[CURRENT_REQUEST_RESOLVER_KEY] = resolver;
}

export function _resolveCurrentRequest(): Request | undefined {
  return getGlobalState()[CURRENT_REQUEST_RESOLVER_KEY]?.();
}

export function _setAppRequestView(view: AppRequestView | undefined): void {
  getGlobalState()[APP_REQUEST_VIEW_KEY] = view;
}

/**
 * The current request as app code receives it, such as a server function's or
 * server query's `request` during a render. Reading its headers counts as a
 * request read, as `headers()` does, so a PPR or ISR render that depends on
 * them is never shared between visitors.
 */
export function _resolveCurrentRequestForApp(): Request | undefined {
  const request = _resolveCurrentRequest();
  const view = getGlobalState()[APP_REQUEST_VIEW_KEY];
  return request && view ? view(request) : request;
}

type CspNonceResolver = () => string | undefined;

const CSP_NONCE_RESOLVER_KEY = Symbol.for("farm.cspNonceResolver");

export function _setCspNonceResolver(resolver: CspNonceResolver | undefined): void {
  (globalThis as typeof globalThis & Record<symbol, unknown>)[CSP_NONCE_RESOLVER_KEY] = resolver;
}

/** The CSP nonce of the response being rendered, when `security.csp.nonce` is on. */
export function _resolveCurrentCspNonce(): string | undefined {
  const resolver = (globalThis as typeof globalThis & Record<symbol, unknown>)[
    CSP_NONCE_RESOLVER_KEY
  ] as CspNonceResolver | undefined;
  return resolver?.();
}

type SharedCacheScopeRunner = <T>(label: string, fn: () => T) => T;

const SHARED_CACHE_SCOPE_RUNNER_KEY = Symbol.for("farm.sharedCacheScopeRunner");

export function _setSharedCacheScopeRunner(runner: SharedCacheScopeRunner | undefined): void {
  (globalThis as typeof globalThis & Record<symbol, unknown>)[SHARED_CACHE_SCOPE_RUNNER_KEY] =
    runner;
}

/**
 * Run `fn` as the body of a cache entry every request shares, such as an
 * `unstable_cache` function. Reading the request inside it throws: the value
 * would be cached for one visitor and served to the rest.
 */
export function _runInSharedCacheScope<T>(label: string, fn: () => T): T {
  const runner = (globalThis as typeof globalThis & Record<symbol, unknown>)[
    SHARED_CACHE_SCOPE_RUNNER_KEY
  ] as SharedCacheScopeRunner | undefined;
  return runner ? runner(label, fn) : fn();
}
