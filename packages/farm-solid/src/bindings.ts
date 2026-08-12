"use client";

import { createSignal, onCleanup, type Accessor } from "solid-js";
import {
  createRendererAction,
  createRendererI18n,
  createRendererQuery,
  createRendererRouter,
  createRendererTheme,
  type FarmActionOptions,
  type FarmActionSnapshot,
  type FarmActionSubmit,
  type FarmClientStore,
  type FarmRendererI18n,
  type FarmRendererQueryOptions,
  type FarmRendererQuerySnapshot,
  type FarmRendererRouter,
  type FarmRendererRouterOptions,
  type FarmRendererRouterSnapshot,
} from "@farm.js/core/renderer-client";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";
import type { FarmI18nClientSnapshot, FarmTranslator } from "@farm.js/core/i18n";
import type { FarmThemeSnapshot } from "@farm.js/core/theme";

function bindFarmStore<T>(store: FarmClientStore<T>, dispose?: () => void): Accessor<T> {
  const [snapshot, setSnapshot] = createSignal(store.getSnapshot(), { equals: false });
  const unsubscribe = store.subscribe(() => setSnapshot(() => store.getSnapshot()));
  onCleanup(() => {
    unsubscribe();
    dispose?.();
  });
  return snapshot;
}

export type FarmSolidRouter = FarmRendererRouterSnapshot &
  Pick<
    FarmRendererRouter,
    "push" | "replace" | "refresh" | "prefetch" | "back" | "forward" | "pushState" | "replaceState"
  >;

export function useRouter(options: FarmRendererRouterOptions = {}): FarmSolidRouter {
  const router = createRendererRouter(options);
  const snapshot = bindFarmStore(router);
  return {
    get pathname() {
      return snapshot().pathname;
    },
    get searchParams() {
      return snapshot().searchParams;
    },
    get params() {
      return snapshot().params;
    },
    get pageState() {
      return snapshot().pageState;
    },
    get navigation() {
      return snapshot().navigation;
    },
    push: router.push,
    replace: router.replace,
    refresh: router.refresh,
    prefetch: router.prefetch,
    back: router.back,
    forward: router.forward,
    pushState: router.pushState,
    replaceState: router.replaceState,
  };
}

export type FarmSolidAction<TInput, TResult, TError extends Error = Error> = FarmActionSubmit<
  TInput,
  TResult
> & {
  readonly pending: boolean;
  readonly status: FarmActionSnapshot<TResult, TError>["status"];
  readonly data: TResult | null;
  readonly error: TError | null;
  reset(): void;
};

export function useAction<TInput, TResult, TError extends Error = Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | { readonly action: ServerFn<TInput, TResult, TError> },
  options: FarmActionOptions<TInput, TResult, TError> = {},
): FarmSolidAction<TInput, TResult, TError> {
  const action = createRendererAction(target, options);
  const snapshot = bindFarmStore(action);
  const call = ((input?: TInput | FormData) =>
    action.submit(input as TInput | FormData)) as FarmActionSubmit<TInput, TResult>;
  return Object.defineProperties(call, {
    pending: { get: () => snapshot().pending },
    status: { get: () => snapshot().status },
    data: { get: () => snapshot().data },
    error: { get: () => snapshot().error },
    reset: { value: () => action.reset() },
  }) as FarmSolidAction<TInput, TResult, TError>;
}

export function useServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: FarmRendererQueryOptions = {},
): FarmRendererQuerySnapshot<TData> & { refetch(): Promise<TData> } {
  const observer = createRendererQuery(query, input, options);
  const snapshot = bindFarmStore(observer, observer.dispose);
  return {
    get data() {
      return snapshot().data;
    },
    get error() {
      return snapshot().error;
    },
    get status() {
      return snapshot().status;
    },
    get pending() {
      return snapshot().pending;
    },
    get fetching() {
      return snapshot().fetching;
    },
    get stale() {
      return snapshot().stale;
    },
    refetch: observer.refetch,
  };
}

export function useTheme() {
  const theme = createRendererTheme();
  const snapshot = bindFarmStore(theme);
  return {
    get theme() {
      return snapshot().theme;
    },
    get resolvedTheme() {
      return snapshot().resolvedTheme;
    },
    get mounted() {
      return snapshot().mounted;
    },
    setTheme: theme.setTheme,
    toggleTheme: theme.toggleTheme,
  } satisfies FarmThemeSnapshot & Record<string, unknown>;
}

export function useI18n() {
  const i18n = createRendererI18n();
  const snapshot = bindFarmStore(i18n);
  return {
    get snapshot(): FarmI18nClientSnapshot | undefined {
      return snapshot();
    },
    get locale() {
      return snapshot()?.locale;
    },
    get locales() {
      return snapshot()?.locales || [];
    },
    get direction() {
      return snapshot()?.direction;
    },
    t: createReactiveTranslator(snapshot, i18n),
    setLocale: i18n.setLocale,
  };
}

export function useTranslations(): FarmTranslator {
  const i18n = createRendererI18n();
  return createReactiveTranslator(bindFarmStore(i18n), i18n);
}

function createReactiveTranslator(
  snapshot: Accessor<FarmI18nClientSnapshot | undefined>,
  i18n: FarmRendererI18n,
): FarmTranslator {
  const translate = ((...args: Parameters<FarmTranslator>) => {
    snapshot();
    return i18n.t(...args);
  }) as FarmTranslator;
  translate.rich = (...args) => {
    snapshot();
    return i18n.t.rich(...args);
  };
  translate.raw = (key) => {
    snapshot();
    return i18n.t.raw(key);
  };
  translate.has = (key) => {
    snapshot();
    return i18n.t.has(key);
  };
  return translate;
}
