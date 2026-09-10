export type SearchFilterPrimitive = string | number | boolean;

export type SearchFilterExpression =
  | SearchFilterPrimitive
  | SearchFilterPrimitive[]
  | { [key: string]: SearchFilterExpression | SearchFilterExpression[] };

export type SearchFilters = Record<string, SearchFilterExpression | SearchFilterExpression[]>;
export type SearchSort = Record<string, "asc" | "desc">;
export type SearchFilterCounts = Record<string, Record<string, number>>;

export interface SearchQueryOptions {
  /** Pagefind filter expression. */
  filters?: SearchFilters;
  /** One Pagefind sort key and direction. Sorting replaces relevance order. */
  sort?: SearchSort;
  /** Number of fully loaded results. Defaults to 20. */
  limit?: number;
  /** Number of result handles to skip before loading. Defaults to 0. */
  offset?: number;
}

export interface SearchClientOptions {
  /** Override the generated search bundle URL. */
  bundlePath?: string;
  /** Override the configured result excerpt length. */
  excerptLength?: number;
  /** Add the query to result links through this parameter. */
  highlightParam?: string | false;
}

export interface SearchSubResult {
  title: string;
  url: string;
  excerpt: string;
  plainExcerpt: string;
}

export interface SearchResult {
  id: string;
  score: number;
  url: string;
  title: string;
  excerpt: string;
  /** Excerpt without Pagefind's mark elements. Safe to render as ordinary text. */
  plainExcerpt: string;
  content: string;
  wordCount: number;
  words: number[];
  matchedMetaFields: string[];
  meta: Record<string, string>;
  filters: Record<string, string[]>;
  subResults: SearchSubResult[];
}

export interface SearchTimings {
  preload: number;
  search: number;
  total: number;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Number of matching results after filters, before offset and limit. */
  total: number;
  /** Number of results that matched the term before filters. */
  unfilteredTotal: number;
  filters: SearchFilterCounts;
  totalFilters: SearchFilterCounts;
  timings: SearchTimings;
}

export interface FarmSearchClient {
  search(term: string | null, options?: SearchQueryOptions): Promise<SearchResponse>;
  preload(term: string, options?: Pick<SearchQueryOptions, "filters" | "sort">): Promise<void>;
  filters(): Promise<SearchFilterCounts>;
  destroy(): Promise<void>;
}

export interface FarmSearchPublicConfig {
  available: boolean;
  bundlePath: string;
  excerptLength: number;
  highlightParam?: string;
}
