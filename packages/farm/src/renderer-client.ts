"use client";

import { createFarmRouter, type FarmRouter, type FarmRouterRouteInput } from "./router";
import {
  getRouter as getSPARouter,
  readPageState,
  type FarmNavigationState,
  type FarmNavigateOptions,
} from "./client/spa-router";
import { subscribeHistoryChange } from "./client/history-sync";
import { getFarmClientDataCache, type FarmClientCacheStatus } from "./client-cache";
import type { ServerFn } from "./server-fn";
import type { ServerQuery } from "./server-query";
import {
  createServerQueryCallKey,
  fetchServerQuery,
  type ServerQueryFetchOptions,
} from "./server-query-runtime";
import { getTheme, setTheme, subscribeTheme, toggleTheme } from "./theme/runtime";
import type { FarmThemePreference, FarmThemeSnapshot } from "./theme/types";
import { createFarmLocaleCookie } from "./i18n/resolver";
import { localizeFarmHref, stripFarmLocaleFromPathname } from "./i18n/routing";
import {
  createFarmClientTranslator,
  getFarmI18nClientState,
  subscribeFarmI18n,
} from "./i18n/client-runtime";
import type { FarmI18nClientSnapshot, FarmI18nLocale, FarmTranslator } from "./i18n/types";
import {
  applyFarmBasePath,
  getFarmBasePath,
  normalizeFarmBasePath,
  stripFarmBasePath,
} from "./base-path";

export interface FarmClientStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface FarmRendererRouterOptions {
  basePath?: string;
  routes?: readonly FarmRouterRouteInput[];
}

export interface FarmRendererRouterSnapshot {
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
  pageState: unknown;
  navigation: FarmNavigationState;
}

export interface FarmRendererRouter extends FarmClientStore<FarmRendererRouterSnapshot> {
  push(href: string, options?: Omit<FarmNavigateOptions, "replace">): Promise<void>;
  replace(href: string, options?: Omit<FarmNavigateOptions, "replace">): Promise<void>;
  refresh(options?: Omit<FarmNavigateOptions, "replace" | "refresh">): Promise<void>;
  prefetch(href: string): Promise<void>;
  back(): void;
  forward(): void;
  pushState<TState>(state: TState, href?: string): void;
  replaceState<TState>(state: TState, href?: string): void;
}

export function createRendererRouter(options: FarmRendererRouterOptions = {}): FarmRendererRouter {
  const basePath =
    options.basePath === undefined ? getFarmBasePath() : normalizeFarmBasePath(options.basePath);
  const matcher = options.routes?.length ? createFarmRouter([...options.routes]) : null;
  const router = getSPARouter();
  let snapshot = readRendererRouterSnapshot(basePath, matcher, router.getNavigationState());

  const read = () => {
    snapshot = readRendererRouterSnapshot(basePath, matcher, router.getNavigationState());
    return snapshot;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const notify = () => {
        read();
        listener();
      };
      const unsubscribeNavigation = router.subscribeNavigation(notify);
      const unsubscribeHistory = subscribeHistoryChange(notify);
      read();
      return () => {
        unsubscribeNavigation();
        unsubscribeHistory();
      };
    },
    push(href, navigateOptions) {
      return typeof window === "undefined"
        ? Promise.resolve()
        : router.navigate(resolveRendererHref(href, basePath), navigateOptions);
    },
    replace(href, navigateOptions) {
      return typeof window === "undefined"
        ? Promise.resolve()
        : router.navigate(resolveRendererHref(href, basePath), {
            ...navigateOptions,
            replace: true,
          });
    },
    refresh: (refreshOptions) =>
      typeof window === "undefined" ? Promise.resolve() : router.refresh(refreshOptions),
    prefetch: (href) =>
      typeof window === "undefined"
        ? Promise.resolve()
        : router.prefetch(resolveRendererHref(href, basePath)),
    back() {
      if (typeof window !== "undefined") window.history.back();
    },
    forward() {
      if (typeof window !== "undefined") window.history.forward();
    },
    pushState(state, href) {
      if (typeof window !== "undefined") {
        router.pushState(state, href && resolveRendererHref(href, basePath));
        read();
      }
    },
    replaceState(state, href) {
      if (typeof window !== "undefined") {
        router.replaceState(state, href && resolveRendererHref(href, basePath));
        read();
      }
    },
  };
}

export type FarmActionStatus = "idle" | "pending" | "success" | "error";

export interface FarmActionSnapshot<TResult, TError extends Error = Error> {
  pending: boolean;
  status: FarmActionStatus;
  data: TResult | null;
  error: TError | null;
}

export interface FarmActionOptions<TInput, TResult, TError extends Error = Error> {
  initialResult?: TResult | null;
  resetOnSubmit?: boolean;
  optimistic?: (context: {
    input: TInput | FormData | undefined;
    formData?: FormData;
    current: TResult | null;
  }) => TResult | null | undefined;
  rollbackOnError?: boolean;
  onSuccess?: (result: TResult) => void;
  onError?: (error: TError) => void;
  onSettled?: (result: TResult | null, error: TError | null) => void;
}

export type FarmActionSubmit<TInput, TResult> = [unknown] extends [TInput]
  ? (input?: TInput | FormData) => Promise<TResult>
  : (input: TInput | FormData) => Promise<TResult>;

export type FarmAction<TInput, TResult, TError extends Error = Error> = FarmClientStore<
  FarmActionSnapshot<TResult, TError>
> & {
  submit: FarmActionSubmit<TInput, TResult>;
  reset(): void;
};

export type FarmRouteActionTarget<TServerFn extends ServerFn<any, any, any>> = {
  readonly action: TServerFn;
};

export function createRendererAction<TInput, TResult, TError extends Error = Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | FarmRouteActionTarget<ServerFn<TInput, TResult, TError>>,
  options: FarmActionOptions<TInput, TResult, TError> = {},
): FarmAction<TInput, TResult, TError> {
  const serverFn = resolveRendererServerFn(target);
  const listeners = new Set<() => void>();
  const initialResult = options.initialResult ?? null;
  let requestId = 0;
  let pendingCount = 0;
  let snapshot: FarmActionSnapshot<TResult, TError> = {
    pending: false,
    status: "idle",
    data: initialResult,
    error: null,
  };

  const update = (next: FarmActionSnapshot<TResult, TError>) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async submit(input?: TInput | FormData) {
      const currentRequest = ++requestId;
      const previous = snapshot.data;
      const formData = isRendererFormData(input) ? input : undefined;
      const optimistic = options.optimistic?.({ input, formData, current: previous });
      const hasOptimistic = optimistic !== undefined;
      pendingCount += 1;
      update({
        pending: true,
        status: "pending",
        data: hasOptimistic ? optimistic : options.resetOnSubmit === false ? previous : null,
        error: null,
      });

      try {
        const result = await serverFn(input as TInput | FormData);
        pendingCount = Math.max(0, pendingCount - 1);
        if (currentRequest === requestId) {
          update({
            pending: pendingCount > 0,
            status: pendingCount > 0 ? "pending" : "success",
            data: result,
            error: null,
          });
          options.onSuccess?.(result);
          options.onSettled?.(result, null);
        }
        return result;
      } catch (cause) {
        pendingCount = Math.max(0, pendingCount - 1);
        const error = normalizeRendererClientError(cause) as TError;
        if (currentRequest === requestId) {
          update({
            pending: pendingCount > 0,
            status: pendingCount > 0 ? "pending" : "error",
            data:
              hasOptimistic && options.rollbackOnError
                ? previous
                : options.resetOnSubmit === false
                  ? snapshot.data
                  : null,
            error,
          });
          options.onError?.(error);
          options.onSettled?.(null, error);
        }
        throw error;
      }
    },
    reset() {
      requestId += 1;
      pendingCount = 0;
      update({ pending: false, status: "idle", data: initialResult, error: null });
    },
  } as FarmAction<TInput, TResult, TError>;
}

export interface FarmRendererQueryOptions extends ServerQueryFetchOptions {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
}

export interface FarmRendererQuerySnapshot<TData> {
  data: TData | undefined;
  error: Error | null;
  status: FarmClientCacheStatus;
  pending: boolean;
  fetching: boolean;
  stale: boolean;
}

export interface FarmRendererQuery<TData> extends FarmClientStore<
  FarmRendererQuerySnapshot<TData>
> {
  refetch(): Promise<TData>;
  dispose(): void;
}

export function createRendererQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: FarmRendererQueryOptions = {},
): FarmRendererQuery<TData> {
  const cache = getFarmClientDataCache();
  const key = createServerQueryCallKey(query, input);
  const listeners = new Set<() => void>();
  let unsubscribeCache: (() => void) | undefined;
  let cleanupBrowser: (() => void) | undefined;

  const run = (force = false) => fetchServerQuery(query, input, { ...options, force });
  const ensureStarted = () => {
    if (options.enabled === false || unsubscribeCache) return;
    unsubscribeCache = cache.subscribe(key, () => {
      for (const listener of listeners) listener();
    });
    if (!cache.get(key) || cache.isStale(key)) void run().catch(() => undefined);

    if (typeof window !== "undefined") {
      const refresh = () => {
        if (cache.isStale(key)) void run().catch(() => undefined);
      };
      const onFocus = options.refetchOnWindowFocus === false ? undefined : refresh;
      const onOnline = options.refetchOnReconnect === false ? undefined : refresh;
      if (onFocus) window.addEventListener("focus", onFocus);
      if (onOnline) window.addEventListener("online", onOnline);
      cleanupBrowser = () => {
        if (onFocus) window.removeEventListener("focus", onFocus);
        if (onOnline) window.removeEventListener("online", onOnline);
      };
    }
  };

  return {
    getSnapshot() {
      const entry = cache.get<TData>(key);
      const status = entry?.status ?? (entry ? "success" : "idle");
      return {
        data: entry?.data,
        error: entry?.error ?? null,
        status,
        pending: status === "pending" && (entry?.updatedAt ?? 0) === 0,
        fetching: entry?.fetching ?? false,
        stale: cache.isStale(key),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureStarted();
      return () => listeners.delete(listener);
    },
    refetch: () => run(true),
    dispose() {
      unsubscribeCache?.();
      cleanupBrowser?.();
      unsubscribeCache = undefined;
      cleanupBrowser = undefined;
      listeners.clear();
    },
  };
}

export interface FarmRendererTheme extends FarmClientStore<FarmThemeSnapshot> {
  setTheme(theme: FarmThemePreference): void;
  toggleTheme(): FarmThemeSnapshot["resolvedTheme"];
}

export function createRendererTheme(): FarmRendererTheme {
  return {
    getSnapshot: getTheme,
    subscribe: subscribeTheme,
    setTheme,
    toggleTheme,
  };
}

export interface FarmRendererI18n extends FarmClientStore<FarmI18nClientSnapshot | undefined> {
  readonly t: FarmTranslator;
  setLocale(locale: FarmI18nLocale): void;
}

export function createRendererI18n(): FarmRendererI18n {
  return {
    getSnapshot: getFarmI18nClientState,
    subscribe: subscribeFarmI18n,
    t: createFarmClientTranslator(),
    setLocale(locale) {
      const snapshot = getFarmI18nClientState();
      if (!snapshot) throw new Error("Farm i18n is not configured or has not been hydrated.");
      if (!snapshot.locales.includes(locale)) {
        throw new Error(`Unsupported Farm i18n locale "${locale}".`);
      }
      if (typeof window === "undefined") return;
      document.cookie = createFarmLocaleCookie(locale, { cookie: snapshot.cookie });
      const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(localizeFarmHref(href, locale, snapshot));
    },
  };
}

function readRendererRouterSnapshot(
  basePath: string,
  matcher: FarmRouter | null,
  navigation: FarmNavigationState,
): FarmRendererRouterSnapshot {
  if (typeof window === "undefined") {
    return {
      pathname: "/",
      searchParams: new URLSearchParams(),
      params: {},
      pageState: null,
      navigation,
    };
  }

  const url = new URL(window.location.href);
  const pathname = stripFarmBasePath(url.pathname, basePath);
  const i18n = getFarmI18nClientState();
  const routePathname = i18n ? stripFarmLocaleFromPathname(pathname, i18n) : pathname;

  return {
    pathname,
    searchParams: url.searchParams,
    params: matcher?.match(routePathname)?.params || {},
    pageState: readPageState(),
    navigation,
  };
}

function resolveRendererHref(href: string, basePath: string): string {
  return applyFarmBasePath(href, basePath);
}

function resolveRendererServerFn<TInput, TResult, TError extends Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | FarmRouteActionTarget<ServerFn<TInput, TResult, TError>>,
): ServerFn<TInput, TResult, TError> {
  if (typeof target === "function") return target;
  if (target && typeof target.action === "function") return target.action;
  throw new TypeError(
    "createRendererAction requires a server function or a route with a declared action",
  );
}

function normalizeRendererClientError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  const error = new Error(typeof cause === "string" ? cause : "FARMJS client operation failed");
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function isRendererFormData(value: unknown): value is FormData {
  return typeof FormData !== "undefined" && value instanceof FormData;
}
