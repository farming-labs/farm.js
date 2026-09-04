/**
 * Farm.js Client-Side Query State Management
 *
 * Type-safe URL search parameter state management - Like useState, but stored in the URL query string.
 * Client-only hooks for managing query parameters in the browser.
 * Inspired by nuqs implementation patterns.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { notifyHistoryChange, subscribeHistoryChange } from "../client/history-sync";
import { _resolveCurrentRequest } from "../server/request-bridge";
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
  if (typeof window !== "undefined") return new URLSearchParams(window.location.search);

  // Server rendering used to see an empty query string here, so a hook read one
  // value on the server and another in the browser. React reports that as a
  // hydration mismatch and discards the server rendered markup for the branch.
  const request = _resolveCurrentRequest();
  if (!request) return new URLSearchParams();
  try {
    return new URL(request.url).searchParams;
  } catch {
    return new URLSearchParams();
  }
};

const throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const compareStructuredValues = (
  current: unknown,
  next: unknown,
  seen = new WeakMap<object, object>(),
): boolean | undefined => {
  if (Object.is(current, next)) return true;
  if (current === null || next === null || typeof current !== typeof next) return false;
  if (typeof current !== "object" || typeof next !== "object") return false;
  if (current instanceof Date || next instanceof Date) {
    return current instanceof Date && next instanceof Date && current.getTime() === next.getTime();
  }
  if (Array.isArray(current) || Array.isArray(next)) {
    if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
      return false;
    }
    const knownNext = seen.get(current);
    if (knownNext) return knownNext === next;
    seen.set(current, next);
    for (let index = 0; index < current.length; index++) {
      const equal = compareStructuredValues(current[index], next[index], seen);
      if (equal !== true) return equal;
    }
    return true;
  }

  const currentPrototype = Object.getPrototypeOf(current);
  const nextPrototype = Object.getPrototypeOf(next);
  if (currentPrototype !== nextPrototype) return false;
  if (currentPrototype !== Object.prototype && currentPrototype !== null) return undefined;

  const knownNext = seen.get(current);
  if (knownNext) return knownNext === next;
  seen.set(current, next);

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);
  if (
    currentKeys.length !== nextKeys.length ||
    currentKeys.some((key) => !Object.prototype.hasOwnProperty.call(next, key))
  ) {
    return false;
  }
  for (const key of currentKeys) {
    const equal = compareStructuredValues(
      (current as Record<string, unknown>)[key],
      (next as Record<string, unknown>)[key],
      seen,
    );
    if (equal !== true) return equal;
  }
  return true;
};

const areParsedValuesEqual = <T>(parser: Parser<T>, current: T | null, next: T | null) => {
  if (Object.is(current, next)) return true;
  const structuredResult = compareStructuredValues(current, next);
  if (structuredResult === false) return false;
  if (current === null || next === null) return false;

  try {
    return parser.serialize(current) === parser.serialize(next);
  } catch {
    return structuredResult === true;
  }
};

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

const commitURLUpdate = (
  updates: Record<string, string | null>,
  options: Options,
  emitUpdate: boolean,
) => {
  const { history = "pushState", shallow = true, scroll = false } = options;
  const url = new URL(window.location.href);
  const newSearchParams = applyChange(url.searchParams, updates);
  const newSearch = newSearchParams.toString();
  const newUrl = url.pathname + (newSearch ? `?${newSearch}` : "") + url.hash;
  const currentUrl = url.pathname + url.search + url.hash;

  if (newUrl === currentUrl) return;

  // Preserve Farm's history state (page state, interception markers) and
  // keep its recorded path in sync with the new query string so pops
  // report the entry's real location.
  const historyState = window.history.state;
  const nextHistoryState =
    historyState && typeof historyState === "object" && "path" in historyState
      ? { ...historyState, path: newUrl }
      : historyState;

  if (history === "replaceState") {
    window.history.replaceState(nextHistoryState, "", newUrl);
  } else {
    window.history.pushState(nextHistoryState, "", newUrl);
  }

  if (emitUpdate) {
    const actualSearchParams = new URLSearchParams(window.location.search);
    emitter.emitUpdate(actualSearchParams);
  }

  if (shallow) notifyHistoryChange("url-search");

  if (scroll) {
    window.scrollTo(0, 0);
  }
};

const updateURL = (
  updates: Record<string, string | null>,
  options: Options = {},
  emitUpdate = true,
): (() => void) | undefined => {
  if (typeof window === "undefined") return;

  const { throttleMs } = options;
  if (!throttleMs || throttleMs <= 0) {
    commitURLUpdate(updates, options, emitUpdate);
    return;
  }

  const throttleKey = Object.keys(updates).sort().join(",");
  const existingTimeout = throttleTimers.get(throttleKey);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    throttleTimers.delete(throttleKey);
  }

  const currentUrl = new URL(window.location.href);
  const nextSearch = applyChange(currentUrl.searchParams, updates).toString();
  if (nextSearch === currentUrl.searchParams.toString()) return;

  const timeout = setTimeout(() => {
    if (throttleTimers.get(throttleKey) === timeout) {
      throttleTimers.delete(throttleKey);
    }
    commitURLUpdate(updates, options, emitUpdate);
  }, throttleMs);

  throttleTimers.set(throttleKey, timeout);
  return () => {
    if (throttleTimers.get(throttleKey) !== timeout) return;
    clearTimeout(timeout);
    throttleTimers.delete(throttleKey);
  };
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
    const searchParams = getCurrentSearchParams();
    const value = searchParams.get(key);
    const parsed = parser.parse(value ?? "");
    return parsed;
  });

  const stateRef = useRef(state);
  const stateKeyRef = useRef(key);
  const isInternalUpdateRef = useRef(false);
  const cancelPendingUpdateRef = useRef<(() => void) | undefined>(undefined);
  stateRef.current = state;

  const setValue = useCallback(
    (value: T | null) => {
      isInternalUpdateRef.current = true;

      setState(value);
      stateRef.current = value;

      const serialized = value === null ? null : parser.serialize(value);

      emitter.emitKey(key, { state: value, query: serialized });

      cancelPendingUpdateRef.current?.();
      cancelPendingUpdateRef.current = updateURL({ [key]: serialized }, options, true);

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
      const sourceChanged = stateKeyRef.current !== key;
      stateKeyRef.current = key;
      if (sourceChanged || !areParsedValuesEqual(parser, stateRef.current, parsed)) {
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
      if (!areParsedValuesEqual(parser, stateRef.current, parsed)) {
        setState(parsed);
        stateRef.current = parsed;
      }
    };

    const onKeyUpdate = (payload: { state: any; query: string | null }) => {
      if (isInternalUpdateRef.current) {
        return;
      }

      if (!areParsedValuesEqual(parser, stateRef.current, payload.state)) {
        setState(payload.state);
        stateRef.current = payload.state;
      }
    };

    // Page-state writes with an href can change the query string without a
    // popstate, so listen through the shared history channel (real
    // back/forward events included). Self-updates no-op via the Object.is
    // comparison above.
    onPopState();
    const unsubscribeHistory = subscribeHistoryChange(onPopState);
    emitter.on("update", onEmitterUpdate);
    emitter.onKey(key, onKeyUpdate);

    return () => {
      unsubscribeHistory();
      emitter.off("update", onEmitterUpdate);
      emitter.offKey(key, onKeyUpdate);
    };
  }, [key, parser]);

  useEffect(
    () => () => {
      cancelPendingUpdateRef.current?.();
      cancelPendingUpdateRef.current = undefined;
    },
    [key],
  );

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
  const watchKeys = JSON.stringify(keys);

  const [state, setState] = useState<{ [K in keyof T]: ReturnType<T[K]["parse"]> }>(() => {
    const searchParams = getCurrentSearchParams();
    const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };

    Object.entries(parsers).forEach(([key, parser]) => {
      const value = searchParams.get(key);
      result[key as keyof T] = parser.parse(value ?? "");
    });

    return result;
  });

  const stateRef = useRef(state);
  const pendingUpdatesRef = useRef(new Map<string, () => void>());
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

      const updateKey = Object.keys(urlUpdates).sort().join(",");
      pendingUpdatesRef.current.get(updateKey)?.();
      const cancelPendingUpdate = updateURL(urlUpdates, options, true);
      if (cancelPendingUpdate) {
        pendingUpdatesRef.current.set(updateKey, cancelPendingUpdate);
      } else {
        pendingUpdatesRef.current.delete(updateKey);
      }
    },
    [parsers, options],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyChange = (searchParams: URLSearchParams) => {
      const result = {} as { [K in keyof T]: ReturnType<T[K]["parse"]> };
      const currentKeys = Object.keys(stateRef.current);
      let hasChanged =
        currentKeys.length !== keys.length ||
        currentKeys.some((key) => !Object.prototype.hasOwnProperty.call(parsers, key));

      Object.entries(parsers).forEach(([key, parser]) => {
        const value = searchParams.get(key);
        const parsed = parser.parse(value ?? "");
        const currentValue = stateRef.current[key as keyof T];

        if (!areParsedValuesEqual(parser, currentValue, parsed)) {
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
      applyChange(searchParams);
    };

    const onEmitterUpdate = (searchParams: URLSearchParams) => {
      applyChange(searchParams);
    };

    applyChange(getCurrentSearchParams());
    const unsubscribeHistory = subscribeHistoryChange(onPopState);
    emitter.on("update", onEmitterUpdate);

    return () => {
      unsubscribeHistory();
      emitter.off("update", onEmitterUpdate);
    };
  }, [watchKeys, parsers]);

  useEffect(
    () => () => {
      for (const cancelPendingUpdate of pendingUpdatesRef.current.values()) {
        cancelPendingUpdate();
      }
      pendingUpdatesRef.current.clear();
    },
    [watchKeys],
  );

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
