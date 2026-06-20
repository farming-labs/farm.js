type CurrentRequestResolver = () => Request | undefined;

const CURRENT_REQUEST_RESOLVER_KEY = Symbol.for("farm.currentRequestResolver");

type GlobalWithCurrentRequestResolver = typeof globalThis & {
  [CURRENT_REQUEST_RESOLVER_KEY]?: CurrentRequestResolver;
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
