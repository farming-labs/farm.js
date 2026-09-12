/** Browser-safe bridge: neither handlers nor Node.js imports cross this boundary. */
export interface APIRequestRuntime {
  basePath: string;
  dispatch(request: Request): Promise<Response>;
}

const API_RUNTIME_RESOLVER = Symbol.for("farm.apiRequestRuntimeResolver");
type RuntimeGlobal = typeof globalThis & {
  [API_RUNTIME_RESOLVER]?: () => APIRequestRuntime | undefined;
};

export function setAPIRequestRuntimeResolver(resolver: () => APIRequestRuntime | undefined): void {
  (globalThis as RuntimeGlobal)[API_RUNTIME_RESOLVER] = resolver;
}

export function resolveAPIRequestRuntime(): APIRequestRuntime | undefined {
  return (globalThis as RuntimeGlobal)[API_RUNTIME_RESOLVER]?.();
}
