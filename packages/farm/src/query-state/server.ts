/**
 * Farm.js Server-Side Query State Management
 */

import {
  createLoader,
  createSerializer,
  type SearchParams,
  type UrlKeys,
  type Parser,
} from "nuqs/server";

/**
 * Server-side utility to load and parse search parameters
 *
 * @example
 * ```tsx
 * // In a server component
 * import { loadSearchParams } from 'farm/query-state/server';
 *
 * export default async function SearchPage({ searchParams }: PageProps) {
 *   const { search, page, category } = await loadSearchParams(searchParams, {
 *     search: parseAsString,
 *     page: parseAsInteger.withDefault(1),
 *     category: parseAsString,
 *   });
 *
 *   return <div>Search: {search}, Page: {page}, Category: {category}</div>;
 * }
 * ```
 */
export async function loadSearchParams<T extends Record<string, Parser<any>>>(
  searchParams: Promise<SearchParams>,
  parsers: T,
  options?: {
    urlKeys?: UrlKeys<T>;
  },
): Promise<{ [K in keyof T]: ReturnType<T[K]["parse"]> }> {
  const loader = createLoader(parsers, options);
  return await loader(searchParams);
}

/**
 * Server-side utility to serialize search parameters
 *
 * @example
 * ```tsx
 * // In a server component
 * import { serializeSearchParams } from 'farm/query-state/server';
 *
 * export default function Pagination({ currentPage }: { currentPage: number }) {
 *   const nextPageUrl = serializeSearchParams('/search', {
 *     page: currentPage + 1,
 *     search: 'react',
 *   });
 *
 *   return <a href={nextPageUrl}>Next Page</a>;
 * }
 * ```
 */
export function serializeSearchParams<T extends Record<string, any>>(
  baseUrl: string,
  params: T,
  options?: {
    urlKeys?: UrlKeys<T>;
  },
): string {
  const serializer = createSerializer(params, options);
  return serializer(baseUrl, params);
}

/**
 * Server-side utility to create canonical URLs
 *
 * @example
 * ```tsx
 * // In a server component for SEO
 * import { createCanonicalUrl } from 'farm/query-state/server';
 *
 * export async function generateMetadata({ searchParams }: PageProps) {
 *   const canonicalUrl = createCanonicalUrl('/products', searchParams, {
 *     page: parseAsInteger.withDefault(1),
 *     category: parseAsString,
 *   });
 *
 *   return {
 *     alternates: {
 *       canonical: canonicalUrl,
 *     },
 *   };
 * }
 * ```
 */
export async function createCanonicalUrl<T extends Record<string, Parser<any>>>(
  basePath: string,
  searchParams: Promise<SearchParams>,
  parsers: T,
  options?: {
    urlKeys?: UrlKeys<T>;
    includeParams?: (keyof T)[];
  },
): Promise<string> {
  const { includeParams = Object.keys(parsers) as (keyof T)[] } = options || {};

  // Load only the parameters that should be included in canonical URL
  const filteredParsers = includeParams.reduce(
    (acc, key) => {
      acc[key as string] = parsers[key];
      return acc;
    },
    {} as Record<string, Parser<any>>,
  );

  const params = await loadSearchParams(searchParams, filteredParsers, options);
  return serializeSearchParams(basePath, params, options);
}

/**
 * Server-side utility to validate search parameters
 *
 * @example
 * ```tsx
 * // In a server component
 * import { validateSearchParams } from 'farm/query-state/server';
 *
 * export default async function ProductPage({ searchParams }: PageProps) {
 *   const validation = await validateSearchParams(searchParams, {
 *     id: parseAsInteger,
 *     category: parseAsString,
 *   });
 *
 *   if (!validation.valid) {
 *     return <div>Invalid parameters: {validation.errors.join(', ')}</div>;
 *   }
 *
 *   return <div>Product ID: {validation.data.id}</div>;
 * }
 * ```
 */
export async function validateSearchParams<T extends Record<string, Parser<any>>>(
  searchParams: Promise<SearchParams>,
  parsers: T,
  options?: {
    urlKeys?: UrlKeys<T>;
  },
): Promise<{
  valid: boolean;
  data?: { [K in keyof T]: ReturnType<T[K]["parse"]> };
  errors: string[];
}> {
  try {
    const data = await loadSearchParams(searchParams, parsers, options);
    return { valid: true, data, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "Invalid parameters"],
    };
  }
}

/**
 * Server-side utility to create pagination metadata
 *
 * @example
 * ```tsx
 * // In a server component
 * import { createPaginationMeta } from 'farm/query-state/server';
 *
 * export default async function ProductList({ searchParams }: PageProps) {
 *   const pagination = await createPaginationMeta(searchParams, {
 *     page: parseAsInteger.withDefault(1),
 *     limit: parseAsInteger.withDefault(10),
 *   });
 *
 *   return (
 *     <div>
 *       <div>Page {pagination.page} of {pagination.totalPages}</div>
 *       <div>Showing {pagination.startItem} to {pagination.endItem} of {pagination.totalItems}</div>
 *     </div>
 *   );
 * }
 * ```
 */
export async function createPaginationMeta(
  searchParams: Promise<SearchParams>,
  options?: {
    pageKey?: string;
    limitKey?: string;
    defaultPage?: number;
    defaultLimit?: number;
    totalItems?: number;
  },
) {
  const {
    pageKey = "page",
    limitKey = "limit",
    defaultPage = 1,
    defaultLimit = 10,
    totalItems = 0,
  } = options || {};

  const { page, limit } = await loadSearchParams(searchParams, {
    [pageKey]: parseAsInteger.withDefault(defaultPage),
    [limitKey]: parseAsInteger.withDefault(defaultLimit),
  });

  const totalPages = Math.ceil(totalItems / limit);
  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, totalItems);

  return {
    page,
    limit,
    totalPages,
    totalItems,
    startItem,
    endItem,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };
}

// Re-export parseAsInteger for convenience
import { parseAsInteger } from "nuqs/server";
