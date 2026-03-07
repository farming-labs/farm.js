/**
 * Farm.js Server-Side Query State Management
 *
 * Server-side utilities for parsing and handling URL search parameters
 */

import type { Parser } from "./parsers";
export { parseRouteParams, loadRouteParams, type RouteParamsInput } from "./params";

export {
  asString,
  asInteger,
  asFloat,
  asBoolean,
  asArrayOf,
  asJson,
  asIsoDate,
  asIsoDateTime,
  createParser,
  type Parser,
  type inferParserType,
} from "./parsers";

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Server-side utility to load and parse search parameters
 *
 * @example
 * ```tsx
 * // In a server component
 * import { loadSearchParams, parseAsString, parseAsInteger } from 'farm/query/server';
 *
 * export default async function MyPage({ searchParams }: PageProps) {
 *   const params = await loadSearchParams(searchParams, {
 *     search: parseAsString.withDefault!(''),
 *     page: parseAsInteger.withDefault!(1),
 *   });
 *
 *   return <div>Search: {params.search}, Page: {params.page}</div>;
 * }
 * ```
 */
export async function loadSearchParams<T extends Record<string, Parser<any>>>(
  searchParams: Promise<URLSearchParams | Record<string, string | string[] | undefined>>,
  parsers: T,
): Promise<{ [K in keyof T]: ReturnType<T[K]["parse"]> }> {
  const params = await searchParams;

  let urlParams: URLSearchParams;
  if (params instanceof URLSearchParams) {
    urlParams = params;
  } else {
    urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          urlParams.append(key, v);
        }
      } else if (value !== undefined && value !== null) {
        urlParams.set(key, String(value));
      }
    }
  }

  const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

  for (const [key, parser] of Object.entries(parsers)) {
    const value = urlParams.get(key);

    if (value !== null && value !== "") {
      try {
        result[key as keyof T] = parser.parse(value);
      } catch (error) {
        console.error(`Failed to parse parameter "${key}":`, error);
        throw error;
      }
    } else {
      result[key as keyof T] = parser.parse("");
    }
  }

  return result;
}

/**
 * Creates pagination metadata for server components.
 *
 * @param searchParams The search parameters promise.
 * @param options Configuration options for pagination.
 * @returns Pagination metadata.
 */
export async function createPaginationMeta(
  searchParams: Promise<URLSearchParams | Record<string, string | string[] | undefined>>,
  options: {
    totalItems: number;
    itemsPerPage?: number;
    pageParam?: string;
  },
) {
  const params = await searchParams;

  let urlParams: URLSearchParams;
  if (params instanceof URLSearchParams) {
    urlParams = params;
  } else {
    urlParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          urlParams.append(key, v);
        }
      } else if (value !== undefined && value !== null) {
        urlParams.set(key, String(value));
      }
    }
  }

  const pageParam = options.pageParam || "page";
  const itemsPerPage = options.itemsPerPage || 10;
  const currentPage = Number.parseInt(urlParams.get(pageParam) || "1", 10);

  const totalPages = Math.ceil(options.totalItems / itemsPerPage);
  const offset = (currentPage - 1) * itemsPerPage;
  const limit = itemsPerPage;

  return {
    currentPage,
    itemsPerPage,
    totalItems: options.totalItems,
    totalPages,
    offset,
    limit,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
  };
}
