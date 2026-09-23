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
  type ArrayParserOptions,
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
    // Read every value, not just the first. A repeated key is joined with commas,
    // the format `asArrayOf` parses and its `serialize` writes, so a repeated
    // parameter round-trips. A single value is passed through untouched, so a
    // value that already contains commas keeps its meaning.
    const values = urlParams.getAll(key);
    const value = values.length > 1 ? values.join(",") : (values[0] ?? null);

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
  const itemsPerPage = options.itemsPerPage ?? 10;
  assertPaginationInteger(options.totalItems, "totalItems", true);
  assertPaginationInteger(itemsPerPage, "itemsPerPage", false);

  const requestedPage = parsePositivePaginationInteger(urlParams.get(pageParam));
  const currentPage =
    requestedPage !== null && Number.isSafeInteger((requestedPage - 1) * itemsPerPage)
      ? requestedPage
      : 1;

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

function parsePositivePaginationInteger(value: string | null): number | null {
  if (!value || !/^[+]?[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function assertPaginationInteger(value: number, name: string, allowZero: boolean): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `Pagination ${name} must be a safe integer greater than or equal to ${minimum}.`,
    );
  }
}
