/**
 * Farm.js Client-Side Query State Management
 */

"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  useQueryState as useNuqsQueryState,
  useQueryStates as useNuqsQueryStates,
  type Parser,
  type Options,
  type UrlUpdateType,
} from "nuqs";
import type { FarmQueryStateContext, QueryStateConfig } from "./types";

// Create context for Farm.js query state
const FarmQueryStateContext = createContext<FarmQueryStateContext | null>(null);

/**
 * Farm.js Query State Provider
 * Provides query state context to client components
 */
export function FarmQueryStateProvider({
  children,
  searchParams,
  pathname = typeof window !== "undefined" ? window.location.pathname : "/",
}: {
  children: ReactNode;
  searchParams?: URLSearchParams;
  pathname?: string;
}) {
  const [currentSearchParams, setCurrentSearchParams] = useState<URLSearchParams>(
    searchParams || new URLSearchParams(),
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setCurrentSearchParams(urlParams);
    }
  }, []);

  const updateUrl = (
    params: Record<string, any>,
    options?: {
      method?: "push" | "replace";
      shallow?: boolean;
      scroll?: boolean;
    },
  ) => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const newSearchParams = new URLSearchParams(url.search);

    // Update search parameters
    Object.entries(params).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        newSearchParams.delete(key);
      } else {
        newSearchParams.set(key, String(value));
      }
    });

    // Update URL
    const newUrl = `${url.pathname}?${newSearchParams.toString()}`;
    const method = options?.method || "push";

    if (method === "replace") {
      window.history.replaceState(null, "", newUrl);
    } else {
      window.history.pushState(null, "", newUrl);
    }

    setCurrentSearchParams(newSearchParams);

    // Trigger scroll if needed
    if (options?.scroll !== false) {
      window.scrollTo(0, 0);
    }
  };

  const clearParams = () => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    window.history.pushState(null, "", url.pathname);
    setCurrentSearchParams(new URLSearchParams());
  };

  const contextValue: FarmQueryStateContext = {
    searchParams: currentSearchParams,
    pathname,
    updateUrl,
    clearParams,
  };

  return (
    <FarmQueryStateContext.Provider value={contextValue}>{children}</FarmQueryStateContext.Provider>
  );
}

/**
 * Hook to access Farm.js query state context
 */
export function useFarmQueryState() {
  const context = useContext(FarmQueryStateContext);
  if (!context) {
    throw new Error("useFarmQueryState must be used within a FarmQueryStateProvider");
  }
  return context;
}

/**
 * Enhanced useQueryState hook with Farm.js integration
 *
 * @example
 * ```tsx
 * // Simple string parameter
 * const [search, setSearch] = useQueryState('q', parseAsString);
 *
 * // Integer with default
 * const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
 *
 * // Boolean parameter
 * const [enabled, setEnabled] = useQueryState('enabled', parseAsBoolean);
 * ```
 */
export function useQueryState<T>(
  key: string,
  parser: Parser<T>,
  options?: Options,
): [
  T,
  (
    value: T | null,
    options?: { method?: UrlUpdateType; shallow?: boolean; scroll?: boolean },
  ) => void,
] {
  const [value, setValue] = useNuqsQueryState(key, parser, options);

  const setValueWithOptions = (
    newValue: T | null,
    updateOptions?: { method?: UrlUpdateType; shallow?: boolean; scroll?: boolean },
  ) => {
    setValue(newValue, {
      method: updateOptions?.method || "push",
      shallow: updateOptions?.shallow,
      scroll: updateOptions?.scroll,
    });
  };

  return [value, setValueWithOptions];
}

/**
 * Enhanced useQueryStates hook with Farm.js integration
 *
 * @example
 * ```tsx
 * const [filters, setFilters] = useQueryStates({
 *   search: parseAsString,
 *   page: parseAsInteger.withDefault(1),
 *   category: parseAsString,
 *   sort: parseAsString.withDefault('name'),
 * });
 *
 * // Update multiple parameters at once
 * setFilters({ search: 'react', page: 1 });
 * ```
 */
export function useQueryStates<T extends Record<string, Parser<any>>>(
  parsers: T,
  options?: Options,
): [
  { [K in keyof T]: ReturnType<T[K]["parse"]> },
  (
    updates: Partial<{ [K in keyof T]: ReturnType<T[K]["parse"]> | null }>,
    options?: {
      method?: UrlUpdateType;
      shallow?: boolean;
      scroll?: boolean;
    },
  ) => void,
] {
  const [values, setValues] = useNuqsQueryStates(parsers, options);

  const setValuesWithOptions = (
    updates: Partial<{ [K in keyof T]: ReturnType<T[K]["parse"]> | null }>,
    updateOptions?: { method?: UrlUpdateType; shallow?: boolean; scroll?: boolean },
  ) => {
    setValues(updates, {
      method: updateOptions?.method || "push",
      shallow: updateOptions?.shallow,
      scroll: updateOptions?.scroll,
    });
  };

  return [values, setValuesWithOptions];
}

/**
 * Hook for managing pagination state in URL
 *
 * @example
 * ```tsx
 * const { page, setPage, limit, setLimit, offset } = usePagination({
 *   defaultPage: 1,
 *   defaultLimit: 10,
 * });
 * ```
 */
export function usePagination(options?: {
  defaultPage?: number;
  defaultLimit?: number;
  pageKey?: string;
  limitKey?: string;
}) {
  const {
    defaultPage = 1,
    defaultLimit = 10,
    pageKey = "page",
    limitKey = "limit",
  } = options || {};

  const [page, setPage] = useQueryState(pageKey, parseAsInteger.withDefault(defaultPage));
  const [limit, setLimit] = useQueryState(limitKey, parseAsInteger.withDefault(defaultLimit));

  const offset = (page - 1) * limit;

  return {
    page,
    setPage,
    limit,
    setLimit,
    offset,
    // Helper to reset pagination
    resetPagination: () => {
      setPage(defaultPage);
      setLimit(defaultLimit);
    },
  };
}

/**
 * Hook for managing search and filter state
 *
 * @example
 * ```tsx
 * const { search, setSearch, filters, setFilters, clearFilters } = useSearchFilters({
 *   searchKey: 'q',
 *   defaultFilters: { category: 'all', sort: 'name' },
 * });
 * ```
 */
export function useSearchFilters<T extends Record<string, any>>(options?: {
  searchKey?: string;
  defaultFilters?: T;
  filterKeys?: (keyof T)[];
}) {
  const {
    searchKey = "search",
    defaultFilters = {} as T,
    filterKeys = Object.keys(defaultFilters) as (keyof T)[],
  } = options || {};

  const [search, setSearch] = useQueryState(searchKey, parseAsString);

  // Create parsers for each filter
  const filterParsers = filterKeys.reduce(
    (acc, key) => {
      acc[key as string] = parseAsString;
      return acc;
    },
    {} as Record<string, Parser<string>>,
  );

  const [filters, setFilters] = useQueryStates(filterParsers);

  const clearFilters = () => {
    setSearch(null);
    const clearedFilters = filterKeys.reduce(
      (acc, key) => {
        acc[key as string] = null;
        return acc;
      },
      {} as Record<string, null>,
    );
    setFilters(clearedFilters);
  };

  return {
    search,
    setSearch,
    filters: filters as T,
    setFilters,
    clearFilters,
  };
}

// Re-export parseAsString for convenience
import { parseAsString, parseAsInteger } from "nuqs";
