"use client";

import {
  computed,
  onScopeDispose,
  readonly,
  shallowRef,
  type ComputedRef,
  type ShallowRef,
} from "vue";
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

function bindFarmStore<T>(
  store: FarmClientStore<T>,
  dispose?: () => void,
): Readonly<ShallowRef<T>> {
  const state = shallowRef(store.getSnapshot()) as ShallowRef<T>;
  const unsubscribe = store.subscribe(() => {
    state.value = store.getSnapshot();
  });
  onScopeDispose(() => {
    unsubscribe();
    dispose?.();
  });
  return readonly(state) as Readonly<ShallowRef<T>>;
}

export interface FarmVueRouter {
  state: Readonly<ShallowRef<FarmRendererRouterSnapshot>>;
  pathname: ComputedRef<string>;
  searchParams: ComputedRef<URLSearchParams>;
  params: ComputedRef<Record<string, string>>;
  pageState: ComputedRef<unknown>;
  navigation: ComputedRef<FarmRendererRouterSnapshot["navigation"]>;
  push: FarmRendererRouter["push"];
  replace: FarmRendererRouter["replace"];
  refresh: FarmRendererRouter["refresh"];
  prefetch: FarmRendererRouter["prefetch"];
  back: FarmRendererRouter["back"];
  forward: FarmRendererRouter["forward"];
  pushState: FarmRendererRouter["pushState"];
  replaceState: FarmRendererRouter["replaceState"];
}

export function useRouter(options: FarmRendererRouterOptions = {}): FarmVueRouter {
  const router = createRendererRouter(options);
  const state = bindFarmStore(router);
  return {
    state,
    pathname: computed(() => state.value.pathname),
    searchParams: computed(() => state.value.searchParams),
    params: computed(() => state.value.params),
    pageState: computed(() => state.value.pageState),
    navigation: computed(() => state.value.navigation),
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

export type FarmVueAction<TInput, TResult, TError extends Error = Error> = FarmActionSubmit<
  TInput,
  TResult
> & {
  state: Readonly<ShallowRef<FarmActionSnapshot<TResult, TError>>>;
  pending: ComputedRef<boolean>;
  status: ComputedRef<FarmActionSnapshot<TResult, TError>["status"]>;
  data: ComputedRef<TResult | null>;
  error: ComputedRef<TError | null>;
  reset(): void;
};

export function useAction<TInput, TResult, TError extends Error = Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | { readonly action: ServerFn<TInput, TResult, TError> },
  options: FarmActionOptions<TInput, TResult, TError> = {},
): FarmVueAction<TInput, TResult, TError> {
  const action = createRendererAction(target, options);
  const state = bindFarmStore(action);
  const call = ((input?: TInput | FormData) =>
    action.submit(input as TInput | FormData)) as FarmActionSubmit<TInput, TResult>;
  return Object.assign(call, {
    state,
    pending: computed(() => state.value.pending),
    status: computed(() => state.value.status),
    data: computed(() => state.value.data),
    error: computed(() => state.value.error),
    reset: () => action.reset(),
  });
}

export interface FarmVueQuery<TData> {
  state: Readonly<ShallowRef<FarmRendererQuerySnapshot<TData>>>;
  data: ComputedRef<TData | undefined>;
  error: ComputedRef<Error | null>;
  status: ComputedRef<FarmRendererQuerySnapshot<TData>["status"]>;
  pending: ComputedRef<boolean>;
  fetching: ComputedRef<boolean>;
  stale: ComputedRef<boolean>;
  refetch(): Promise<TData>;
}

export function useServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: FarmRendererQueryOptions = {},
): FarmVueQuery<TData> {
  const observer = createRendererQuery(query, input, options);
  const state = bindFarmStore(observer, observer.dispose);
  return {
    state,
    data: computed(() => state.value.data),
    error: computed(() => state.value.error),
    status: computed(() => state.value.status),
    pending: computed(() => state.value.pending),
    fetching: computed(() => state.value.fetching),
    stale: computed(() => state.value.stale),
    refetch: observer.refetch,
  };
}

export interface FarmVueTheme {
  state: Readonly<ShallowRef<FarmThemeSnapshot>>;
  theme: ComputedRef<FarmThemeSnapshot["theme"]>;
  resolvedTheme: ComputedRef<FarmThemeSnapshot["resolvedTheme"]>;
  mounted: ComputedRef<boolean>;
  setTheme: ReturnType<typeof createRendererTheme>["setTheme"];
  toggleTheme: ReturnType<typeof createRendererTheme>["toggleTheme"];
}

export function useTheme(): FarmVueTheme {
  const theme = createRendererTheme();
  const state = bindFarmStore(theme);
  return {
    state,
    theme: computed(() => state.value.theme),
    resolvedTheme: computed(() => state.value.resolvedTheme),
    mounted: computed(() => state.value.mounted),
    setTheme: theme.setTheme,
    toggleTheme: theme.toggleTheme,
  };
}

export function useI18n() {
  const i18n = createRendererI18n();
  const state = bindFarmStore(i18n);
  return {
    state,
    locale: computed(() => state.value?.locale),
    locales: computed(() => state.value?.locales || []),
    direction: computed(() => state.value?.direction),
    t: createReactiveTranslator(state, i18n.t),
    setLocale: i18n.setLocale,
  };
}

export function useTranslations(): FarmTranslator {
  const i18n = createRendererI18n();
  return createReactiveTranslator(bindFarmStore(i18n), i18n.t);
}

function createReactiveTranslator(
  state: Readonly<ShallowRef<FarmI18nClientSnapshot | undefined>>,
  source: FarmTranslator,
): FarmTranslator {
  const translate = ((...args: Parameters<FarmTranslator>) => {
    void state.value;
    return source(...args);
  }) as FarmTranslator;
  translate.rich = (...args) => {
    void state.value;
    return source.rich(...args);
  };
  translate.raw = (key) => {
    void state.value;
    return source.raw(key);
  };
  translate.has = (key) => {
    void state.value;
    return source.has(key);
  };
  return translate;
}
