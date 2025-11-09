/**
 * Farm.js Server-Side Query State Management
 * 
 * Server-side utilities for parsing and handling URL search parameters
 */

// Re-export shared parsers for convenience
export {
  parseAsString,
  parseAsInteger,
  parseAsFloat,
  parseAsBoolean,
  parseAsArrayOf,
  parseAsJson,
  parseAsIsoDate,
  parseAsIsoDateTime,
  createParser,
  type Parser,
  type inferParserType,
} from './parsers';

// Server-specific types
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
export async function loadSearchParams<T extends Record<string, any>>(
  searchParams: Promise<URLSearchParams>,
  parsers: T
): Promise<{ [K in keyof T]: ReturnType<T[K]['parse']> }> {
  const params = await searchParams;
  const result = {} as { [K in keyof T]: ReturnType<T[K]['parse']> };
  
  for (const [key, parser] of Object.entries(parsers)) {
    const value = params.get(key);
    
    // If value exists, parse it
    if (value !== null && value !== '') {
      try {
        result[key as keyof T] = parser.parse(value);
      } catch (error) {
        // If parsing fails and there's no default, throw error
        console.error(`Failed to parse parameter "${key}":`, error);
        throw error;
      }
    } else {
      // No value found - parser should handle this with its withDefault logic
      // If the parser was created with withDefault, calling parse('') will return the default
      result[key as keyof T] = parser.parse('');
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
  searchParams: Promise<URLSearchParams>,
  options: {
    totalItems: number;
    itemsPerPage?: number;
    pageParam?: string;
  }
) {
  const params = await searchParams;
  const pageParam = options.pageParam || 'page';
  const itemsPerPage = options.itemsPerPage || 10;
  const currentPage = Number.parseInt(params.get(pageParam) || '1', 10);

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
