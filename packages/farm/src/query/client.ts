/**
 * Farm.js Client-Side Query State Management
 *
 * Type-safe URL search parameter state management - Like useState, but stored in the URL query string.
 * Client-only hooks for managing query parameters in the browser.
 */

import { useState, useEffect, useCallback } from "react";
import type { Parser } from "./parsers";

// Re-export parsers for convenience
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
} from "./parsers";

// Client-specific types
export type UrlUpdateType = "push" | "replace";
export type HistoryMethod = "pushState" | "replaceState";

export interface Options {
  history?: HistoryMethod;
  shallow?: boolean;
  scroll?: boolean;
  throttleMs?: number;
}

// Utility functions
const getCurrentSearchParams = (): URLSearchParams => {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
};

const updateURL = (updates: Record<string, string | null>, options: Options = {}) => {
  if (typeof window === "undefined") return;

  const { history = "pushState", shallow = true, scroll = false } = options;
  const url = new URL(window.location.href);

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  });

  const newUrl = url.toString();
  if (newUrl !== window.location.href) {
    window.history[history]({ scroll }, "", newUrl);

    // Dispatch custom event for shallow routing
    if (shallow) {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }
};

// Main hooks
export function useQueryState<T>(
  key: string,
  parser: Parser<T>,
  options: Options = {},
): [T | null, (value: T | null) => void] {
  const [state, setState] = useState<T | null>(() => {
    if (typeof window === "undefined") return null;
    const searchParams = getCurrentSearchParams();
    const value = searchParams.get(key);
    return value ? parser.parse(value) : null;
  });

  const setValue = useCallback(
    (value: T | null) => {
      setState(value);
      const serialized = value === null ? null : parser.serialize(value);
      updateURL({ [key]: serialized }, options);
    },
    [key, parser, options],
  );

  // Listen for URL changes (browser back/forward)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const searchParams = getCurrentSearchParams();
      const value = searchParams.get(key);
      const parsed = value ? parser.parse(value) : null;
      setState(parsed);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [key, parser]);

  return [state, setValue];
}

export function useQueryStates<T extends Record<string, Parser<any>>>(
  parsers: T,
  options: Options = {},
): [
  { [K in keyof T]: ReturnType<T[K]["parse"]> },
  (updates: Partial<{ [K in keyof T]: ReturnType<T[K]["parse"]> | null }>) => void,
] {
  const [state, setState] = useState<{ [K in keyof T]: ReturnType<T[K]["parse"]> }>(() => {
    if (typeof window === "undefined") {
      return {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };
    }

    const searchParams = getCurrentSearchParams();
    const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

    Object.entries(parsers).forEach(([key, parser]) => {
      const value = searchParams.get(key);
      result[key as keyof T] = value ? parser.parse(value) : null;
    });

    return result;
  });

  const setValues = useCallback(
    (updates: Partial<{ [K in keyof T]: ReturnType<T[K]["parse"]> | null }>) => {
      setState((prev) => ({ ...prev, ...updates }));

      const urlUpdates: Record<string, string | null> = {};
      Object.entries(updates).forEach(([key, value]) => {
        const parser = parsers[key];
        const serialized = value === null ? null : parser.serialize(value);
        urlUpdates[key] = serialized;
      });

      updateURL(urlUpdates, options);
    },
    [parsers, options],
  );

  // Listen for URL changes (browser back/forward)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const searchParams = getCurrentSearchParams();
      const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

      Object.entries(parsers).forEach(([key, parser]) => {
        const value = searchParams.get(key);
        result[key as keyof T] = value ? parser.parse(value) : null;
      });

      setState(result);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [parsers]);

  return [state, setValues];
}

// Convenience hooks
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

  // Import parsers dynamically to avoid circular dependency
  const { parseAsInteger } = require("./parsers");

  const [page, setPage] = useQueryState(pageKey, parseAsInteger.withDefault!(defaultPage));
  const [limit, setLimit] = useQueryState(limitKey, parseAsInteger.withDefault!(defaultLimit));

  const currentPage = page ?? defaultPage;
  const currentLimit = limit ?? defaultLimit;
  const offset = ((currentPage as number) - 1) * (currentLimit as number);

  return {
    page: currentPage,
    setPage,
    limit: currentLimit,
    setLimit,
    offset,
    resetPagination: () => {
      setPage(defaultPage);
      setLimit(defaultLimit);
    },
  };
}

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

  // Import parsers dynamically to avoid circular dependency
  const { parseAsString } = require("./parsers");

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
