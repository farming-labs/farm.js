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
