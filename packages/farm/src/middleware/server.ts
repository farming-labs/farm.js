/**
 * Server-side middleware utilities for accessing middleware data in pages
 */

/**
 * Global storage for current request's middleware data
 * This is a simple global variable that works across ALL module instances
 * Safe because Node.js is single-threaded and rendering is synchronous
 */
declare global {
  var __FARM_CURRENT_MIDDLEWARE__: Map<string, any> | undefined;
}

if (typeof globalThis.__FARM_CURRENT_MIDDLEWARE__ === "undefined") {
  globalThis.__FARM_CURRENT_MIDDLEWARE__ = new Map();
}

/**
 * Internal: Set middleware data for the current request
 * This is called by the server renderer BEFORE rendering starts
 */
export function _setCurrentMiddlewareData(data: Record<string, any>): void {
  globalThis.__FARM_CURRENT_MIDDLEWARE__ = new Map(Object.entries(data));
}

/**
 * Internal: Clear middleware data after request completes
 */
export function _clearCurrentMiddlewareData(): void {
  globalThis.__FARM_CURRENT_MIDDLEWARE__ = new Map();
}

/**
 * Internal: Run code with middleware data available
 * This is called by the server renderer
 */
export async function _runWithMiddlewareData<T>(
  data: Record<string, any>,
  fn: () => T | Promise<T>,
): Promise<T> {
  _setCurrentMiddlewareData(data);
  try {
    const result = await fn();
    return result;
  } finally {
    _clearCurrentMiddlewareData();
  }
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
  return (globalThis.__FARM_CURRENT_MIDDLEWARE__ || new Map()) as Map<keyof T, T[keyof T]>;
}

/**
 * Get a specific value from middleware data (synchronous)
 * Uses AsyncLocalStorage for automatic request-scoping - no props needed!
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
