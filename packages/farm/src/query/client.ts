/**
 * Farm.js Client-Side Query State Management
 *
 * Type-safe URL search parameter state management - Like useState, but stored in the URL query string.
 * Client-only hooks for managing query parameters in the browser.
 * Inspired by nuqs implementation patterns.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { emitter } from "./sync";
export { parseRouteParams, loadRouteParams, type RouteParamsInput } from "./params";

import { asString as asStringClient, asInteger as asIntegerClient, type Parser } from "./parsers";

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

export type UrlUpdateType = "push" | "replace";
export type HistoryMethod = "pushState" | "replaceState";

export interface Options {
  history?: HistoryMethod;
  shallow?: boolean;
  scroll?: boolean;
  throttleMs?: number;
}

const getCurrentSearchParams = (): URLSearchParams => {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
};

const throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const applyChange = (
  searchParams: URLSearchParams,
  updates: Record<string, string | null>,
  keepExisting = true,
): URLSearchParams => {
  const newParams = keepExisting ? new URLSearchParams(searchParams) : new URLSearchParams();

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
  });

  return newParams;
};

const updateURL = (
  updates: Record<string, string | null>,
  options: Options = {},
  emitUpdate = true,
) => {
  if (typeof window === "undefined") return;

  const { history = "pushState", shallow = true, scroll = false, throttleMs } = options;
  const url = new URL(window.location.href);

  const newSearchParams = applyChange(new URLSearchParams(url.search), updates);
  const newSearch = newSearchParams.toString();
  const newUrl = url.pathname + (newSearch ? `?${newSearch}` : "") + url.hash;
  const currentUrl =
    window.location.pathname + (window.location.search || "") + window.location.hash;

  if (newUrl !== currentUrl) {
    const update = () => {
      if (history === "replaceState") {
        window.history.replaceState(null, "", newUrl);
      } else {
        window.history.pushState(null, "", newUrl);
      }

      if (emitUpdate) {
        const actualSearchParams = new URLSearchParams(window.location.search);
        emitter.emitUpdate(actualSearchParams);
      }

      if (shallow) {
        setTimeout(() => {
          window.dispatchEvent(new PopStateEvent("popstate"));
        }, 0);
      }

      if (scroll) {
        window.scrollTo(0, 0);
      }
    };

    if (throttleMs && throttleMs > 0) {
      const throttleKey = Object.keys(updates).sort().join(",");

      const existingTimeout = throttleTimers.get(throttleKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeout = setTimeout(() => {
        update();
        throttleTimers.delete(throttleKey);
      }, throttleMs);

      throttleTimers.set(throttleKey, timeout);
    } else {
      update();
    }
  }
};

export function useQueryState<TParser extends Parser<any>>(
  key: string,
  parser: TParser,
  options?: Options,
): [
  NonNullable<ReturnType<TParser["parse"]>> | null,
  (value: NonNullable<ReturnType<TParser["parse"]>> | null) => void,
];
export function useQueryState<T>(
  key: string,
  parser: Parser<T>,
  options?: Options,
): [T | null, (value: T | null) => void];
export function useQueryState<TParser extends Parser<any>>(
  key: string,
  parser: TParser,
  options?: Options,
): [
  NonNullable<ReturnType<TParser["parse"]>> | null,
  (value: NonNullable<ReturnType<TParser["parse"]>> | null) => void,
] {
  type T = NonNullable<ReturnType<TParser["parse"]>>;
  const [state, setState] = useState<T | null>(() => {
    if (typeof window === "undefined") return parser.parse("");
    const searchParams = getCurrentSearchParams();
    const value = searchParams.get(key);
    const parsed = parser.parse(value ?? "");
    return parsed;
  });

  const stateRef = useRef(state);
  const isInternalUpdateRef = useRef(false);
  stateRef.current = state;

  const setValue = useCallback(
    (value: T | null) => {
      isInternalUpdateRef.current = true;

      setState(value);
      stateRef.current = value;

      const serialized = value === null ? null : parser.serialize(value);

      emitter.emitKey(key, { state: value, query: serialized });

      updateURL({ [key]: serialized }, options, true);

      setTimeout(() => {
        isInternalUpdateRef.current = false;
      }, 10);
    },
    [key, parser, options],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onPopState = () => {
      const searchParams = getCurrentSearchParams();
      const value = searchParams.get(key);
      const parsed = parser.parse(value ?? "");
      if (!Object.is(stateRef.current, parsed)) {
        setState(parsed);
        stateRef.current = parsed;
      }
    };

    const onEmitterUpdate = (searchParams: URLSearchParams) => {
      if (isInternalUpdateRef.current) {
        return;
      }

      const value = searchParams.get(key);
      const parsed = parser.parse(value ?? "");
      if (!Object.is(stateRef.current, parsed)) {
        setState(parsed);
        stateRef.current = parsed;
      }
    };

    const onKeyUpdate = (payload: { state: any; query: string | null }) => {
      if (isInternalUpdateRef.current) {
        return;
      }

      if (!Object.is(stateRef.current, payload.state)) {
        setState(payload.state);
        stateRef.current = payload.state;
      }
    };

    window.addEventListener("popstate", onPopState);
    emitter.on("update", onEmitterUpdate);
    emitter.onKey(key, onKeyUpdate);

    return () => {
      window.removeEventListener("popstate", onPopState);
      emitter.off("update", onEmitterUpdate);
      emitter.offKey(key, onKeyUpdate);
    };
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
  const keys = Object.keys(parsers);
  const watchKeys = keys.join("&");

  const [state, setState] = useState<{ [K in keyof T]: ReturnType<T[K]["parse"]> }>(() => {
    const searchParams =
      typeof window === "undefined" ? new URLSearchParams() : getCurrentSearchParams();
    const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

    Object.entries(parsers).forEach(([key, parser]) => {
      const value = searchParams.get(key);
      result[key as keyof T] = parser.parse(value ?? "");
    });

    return result;
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const setValues = useCallback(
    (updates: Partial<{ [K in keyof T]: ReturnType<T[K]["parse"]> | null }>) => {
      const newState = { ...stateRef.current, ...updates };
      setState(newState);
      stateRef.current = newState;

      Object.entries(updates).forEach(([key, value]) => {
        const parser = parsers[key];
        if (parser) {
          const serialized = value === null ? null : parser.serialize(value);
          emitter.emitKey(key, { state: value, query: serialized });
        }
      });

      const urlUpdates: Record<string, string | null> = {};
      Object.entries(updates).forEach(([key, value]) => {
        const parser = parsers[key];
        if (parser) {
          const serialized = value === null ? null : parser.serialize(value);
          urlUpdates[key] = serialized;
        }
      });

      updateURL(urlUpdates, options, true);
    },
    [parsers, options],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyChange = (searchParams: URLSearchParams, fromEmitter = false) => {
      const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };
      let hasChanged = false;

      Object.entries(parsers).forEach(([key, parser]) => {
        const value = searchParams.get(key);
        const parsed = parser.parse(value ?? "");
        const currentValue = stateRef.current[key as keyof T];

        if (!Object.is(currentValue, parsed)) {
          hasChanged = true;
        }
        result[key as keyof T] = parsed;
      });

      if (hasChanged) {
        setState(result);
        stateRef.current = result;
      }
    };

    const onPopState = () => {
      const searchParams = getCurrentSearchParams();
      applyChange(searchParams, false);
    };

    const onEmitterUpdate = (searchParams: URLSearchParams) => {
      applyChange(searchParams, true);
    };

    window.addEventListener("popstate", onPopState);
    emitter.on("update", onEmitterUpdate);

    return () => {
      window.removeEventListener("popstate", onPopState);
      emitter.off("update", onEmitterUpdate);
    };
  }, [watchKeys, parsers]);

  return [state, setValues];
}

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

  const [page, setPage] = useQueryState(pageKey, asIntegerClient.withDefault!(defaultPage));
  const [limit, setLimit] = useQueryState(limitKey, asIntegerClient.withDefault!(defaultLimit));

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

  const [search, setSearch] = useQueryState(searchKey, asStringClient);

  const filterParsers = filterKeys.reduce(
    (acc, key) => {
      acc[key as string] = asStringClient;
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
