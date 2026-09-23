import { createSearchClient } from "./client-runtime.js";
import type { FarmSearchClient, FarmSearchPublicConfig, SearchClientOptions } from "./types.js";

export type {
  FarmSearchClient,
  SearchClientOptions,
  SearchFilterCounts,
  SearchFilterExpression,
  SearchFilterPrimitive,
  SearchFilters,
  SearchQueryOptions,
  SearchResponse,
  SearchResult,
  SearchSort,
  SearchSubResult,
  SearchTimings,
} from "./types.js";

let configuredSearch: FarmSearchPublicConfig = {
  available: false,
  bundlePath: "/_farm/search/",
  excerptLength: 30,
};

/** @internal Configured by the Farm client plugin before hydration. */
export function configureFarmSearch(config: FarmSearchPublicConfig): void {
  configuredSearch = { ...config };
}

/** Create a lazy, renderer-neutral client for the generated static search index. */
export function createSearch(options: SearchClientOptions = {}): FarmSearchClient {
  return createSearchClient(
    () => configuredSearch,
    options,
    (url) => import(/* @vite-ignore */ url),
  );
}
