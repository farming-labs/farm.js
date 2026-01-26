/**
 * Middleware helper utilities for pages
 */

import type { MiddlewareProps } from "../types";

/**
 * Unwrap middleware data from PageProps
 *
 * @example
 * ```tsx
 * export default async function Page(props: PageProps) {
 *   const { user, stats } = await unwrapMiddleware(props.middleware, {
 *     user: null,
 *     stats: { views: 0, clicks: 0 }
 *   });
 *
 *   return <div>Welcome {user?.name}</div>;
 * }
 * ```
 */
export function unwrapMiddleware<T extends Record<string, any>>(
  middleware: MiddlewareProps | undefined,
  defaults?: Partial<T>,
): Partial<T> {
  if (!middleware) {
    return (defaults || {}) as Partial<T>;
  }

  const result: any = { ...defaults };

  for (const [key, value] of middleware.data) {
    result[key] = value;
  }

  return result as Partial<T>;
}

/**
 * Get a single value from middleware with a default
 *
 * @example
 * ```tsx
 * export default async function Page(props: PageProps) {
 *   const user = await getMiddlewareValue(props.middleware, 'user', null);
 *   return <div>Welcome {user?.name || 'Guest'}</div>;
 * }
 * ```
 */
export function getFromMiddleware<T = any>(
  middleware: MiddlewareProps | undefined,
  key: string,
  defaultValue?: T,
): T | undefined {
  if (!middleware) {
    return defaultValue;
  }

  const value = middleware.data.get(key);
  return value !== undefined ? value : defaultValue;
}

/**
 * Check if middleware data exists
 */
export function hasMiddlewareData(middleware: MiddlewareProps | undefined): boolean {
  if (!middleware) return false;
  return middleware.data.size > 0;
}
