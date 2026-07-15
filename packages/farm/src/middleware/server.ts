/**
 * Server-side middleware utilities for accessing middleware data in pages
 */

import { AsyncLocalStorage } from "async_hooks";
import type { ReadonlyMiddlewareStore } from "./types";

type MiddlewareStoreInput = Record<string, any> | Map<string, any>;
const MIDDLEWARE_DATA_STORE_KEY = Symbol.for("farm.middlewareDataStore");
const MIDDLEWARE_CONTEXT_STORE_KEY = Symbol.for("farm.middlewareContextStore");

function getGlobalMiddlewareStore(key: symbol): AsyncLocalStorage<Map<string, any>> {
  const state = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = state[key];
  if (existing instanceof AsyncLocalStorage) {
    return existing as AsyncLocalStorage<Map<string, any>>;
  }

  const store = new AsyncLocalStorage<Map<string, any>>();
  state[key] = store;
  return store;
}

const middlewareStore = getGlobalMiddlewareStore(MIDDLEWARE_DATA_STORE_KEY);
const middlewareContextStore = getGlobalMiddlewareStore(MIDDLEWARE_CONTEXT_STORE_KEY);

function toMiddlewareMap(data: MiddlewareStoreInput): Map<string, any> {
  if (data instanceof Map) {
    return new Map(data);
  }
  return new Map(Object.entries(data));
}

/**
 * Internal: Set middleware data for the current request
 * This is called by the server renderer before rendering starts.
 * Prefer _runWithMiddlewareData for request-scoped async flows.
 */
export function _setCurrentMiddlewareData(data: MiddlewareStoreInput): void {
  middlewareStore.enterWith(toMiddlewareMap(data));
}

/**
 * Internal: Clear middleware data after request completes
 */
export function _clearCurrentMiddlewareData(): void {
  middlewareStore.enterWith(new Map());
}

/** Internal: Clear server-only middleware context after rendering. */
export function _clearCurrentMiddlewareContext(): void {
  middlewareContextStore.enterWith(new Map());
}

/**
 * Internal: Run code with middleware data available
 * This is called by the server renderer
 */
export async function _runWithMiddlewareData<T>(
  data: MiddlewareStoreInput,
  fn: () => T | Promise<T>,
): Promise<T> {
  return middlewareStore.run(toMiddlewareMap(data), fn);
}

/** Internal: Run code with server-only middleware context available. */
export async function _runWithMiddlewareContext<T>(
  context: MiddlewareStoreInput,
  fn: () => T | Promise<T>,
): Promise<T> {
  return middlewareContextStore.run(toMiddlewareMap(context), fn);
}

/**
 * Get middleware data in a server component
 * No props needed - uses global storage!
 *
 * @example
 * ```tsx
 * import { getMiddlewareData } from 'farm/middleware';
 *
 * export default function Page() {
 *   const data = getMiddlewareData();  // ← No props needed!
 *   const user = data.get('user');
 *   const demoInfo = data.get('demoInfo');
 *
 *   return <div>Welcome {user?.name}</div>;
 * }
 * ```
 */
export function getMiddlewareData<T extends Record<string, any> = Record<string, any>>(): Map<
  keyof T,
  T[keyof T]
> {
  return (middlewareStore.getStore() || new Map()) as Map<keyof T, T[keyof T]>;
}

/**
 * Get a specific value from middleware data (synchronous)
 * Uses AsyncLocalStorage for request scoping - no props needed.
 *
 * @example
 * ```tsx
 * import { getMiddlewareValue } from 'farm/middleware';
 *
 * export default function Page() {
 *   const user = getMiddlewareValue<User>('user');  // ← No props needed!
 *   const stats = getMiddlewareValue('dashboardStats');
 *
 *   return <div>Welcome {user?.name}</div>;
 * }
 * ```
 */
export function getMiddlewareValue<T = any>(key: string): T | undefined {
  const data = getMiddlewareData();
  return data.get(key);
}

/**
 * Read server-only values set by route middleware for the current request.
 * The returned store is available to the matched page, layouts, and nested
 * Server Components, but is never added to hydration props.
 */
export function getMiddlewareContext<
  T extends Record<string, any> = Record<string, any>,
>(): ReadonlyMiddlewareStore<T> {
  return (middlewareContextStore.getStore() || new Map()) as unknown as ReadonlyMiddlewareStore<T>;
}

/**
 * Type-safe middleware data accessor with type parameter
 *
 * @example
 * ```tsx
 * import { createMiddlewareAccessor } from 'farm/middleware/server';
 *
 * interface MiddlewareData {
 *   user: { id: number; name: string };
 *   dashboardStats: { views: number; clicks: number };
 * }
 *
 * const getData = createMiddlewareAccessor<MiddlewareData>();
 *
 * export default function Page() {
 *   const data = getData();
 *   const user = data.user;  // Fully typed!
 *   const stats = data.dashboardStats;  // Fully typed!
 *
 *   return <div>Welcome {user?.name}</div>;
 * }
 * ```
 */
export function createMiddlewareAccessor<T extends Record<string, any>>() {
  return (): Partial<T> => {
    const data = getMiddlewareData();
    const result: any = {};

    for (const [key, value] of data) {
      result[key] = value;
    }

    return result as Partial<T>;
  };
}
