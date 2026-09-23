import { AsyncLocalStorage } from "node:async_hooks";
import { setAPIRequestRuntimeResolver, type APIRequestRuntime } from "./server-client-bridge";

const API_RUNTIME_STORAGE = Symbol.for("@farm.js/core/api-request-storage");
const runtimeGlobal = globalThis as typeof globalThis & {
  [API_RUNTIME_STORAGE]?: AsyncLocalStorage<APIRequestRuntime>;
};
const storage = (runtimeGlobal[API_RUNTIME_STORAGE] ??= new AsyncLocalStorage<APIRequestRuntime>());
setAPIRequestRuntimeResolver(() => storage.getStore());

/** Bind the owning app's live route dispatcher, never a process-wide route table. */
export function _runWithAPIRequestRuntime<T>(runtime: APIRequestRuntime, run: () => T): T {
  return storage.run(runtime, run);
}
