"use client";

import { readable, type Readable } from "svelte/store";
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
import type { FarmI18nClientSnapshot, FarmI18nLocale, FarmTranslator } from "@farm.js/core/i18n";
import type { FarmThemePreference, FarmThemeSnapshot } from "@farm.js/core/theme";

function readableFarmStore<T>(store: FarmClientStore<T>, dispose?: () => void): Readable<T> {
  return readable(store.getSnapshot(), (set) => {
    const update = () => set(store.getSnapshot());
    const unsubscribe = store.subscribe(update);
    update();
    return () => {
      unsubscribe();
      dispose?.();
    };
  });
}

export interface FarmSvelteRouter extends Readable<FarmRendererRouterSnapshot> {
  push: FarmRendererRouter["push"];
  replace: FarmRendererRouter["replace"];
  refresh: FarmRendererRouter["refresh"];
  prefetch: FarmRendererRouter["prefetch"];
  back: FarmRendererRouter["back"];
  forward: FarmRendererRouter["forward"];
  pushState: FarmRendererRouter["pushState"];
  replaceState: FarmRendererRouter["replaceState"];
}

export function createRouter(options: FarmRendererRouterOptions = {}): FarmSvelteRouter {
  const router = createRendererRouter(options);
  return Object.assign(readableFarmStore(router), {
    push: router.push,
    replace: router.replace,
    refresh: router.refresh,
    prefetch: router.prefetch,
    back: router.back,
    forward: router.forward,
    pushState: router.pushState,
    replaceState: router.replaceState,
  });
}

export type FarmSvelteAction<TInput, TResult, TError extends Error = Error> = FarmActionSubmit<
  TInput,
  TResult
> &
  Readable<FarmActionSnapshot<TResult, TError>> & {
    reset(): void;
  };

export function createAction<TInput, TResult, TError extends Error = Error>(
  target:
    | ServerFn<TInput, TResult, TError>
    | { readonly action: ServerFn<TInput, TResult, TError> },
  options: FarmActionOptions<TInput, TResult, TError> = {},
): FarmSvelteAction<TInput, TResult, TError> {
  const action = createRendererAction(target, options);
  const call = ((input?: TInput | FormData) =>
    action.submit(input as TInput | FormData)) as FarmActionSubmit<TInput, TResult>;
  return Object.assign(call, readableFarmStore(action), {
    reset: () => action.reset(),
  });
}

export interface FarmSvelteQuery<TData> extends Readable<FarmRendererQuerySnapshot<TData>> {
  refetch(): Promise<TData>;
}

export function createServerQuery<TInput, TData>(
  query: ServerQuery<TInput, TData>,
  input: TInput,
  options: FarmRendererQueryOptions = {},
): FarmSvelteQuery<TData> {
  const observer = createRendererQuery(query, input, options);
  return Object.assign(readableFarmStore(observer, observer.dispose), {
    refetch: observer.refetch,
  });
}

export interface FarmSvelteTheme extends Readable<FarmThemeSnapshot> {
  setTheme(theme: FarmThemePreference): void;
  toggleTheme(): FarmThemeSnapshot["resolvedTheme"];
}

export function createTheme(): FarmSvelteTheme {
  const theme = createRendererTheme();
  return Object.assign(readableFarmStore(theme), {
    setTheme: theme.setTheme,
    toggleTheme: theme.toggleTheme,
  });
}

export interface FarmSvelteI18n extends Readable<FarmI18nClientSnapshot | undefined> {
  readonly t: FarmTranslator;
  setLocale(locale: FarmI18nLocale): void;
}

export function createI18n(): FarmSvelteI18n {
  const i18n = createRendererI18n();
  return Object.assign(readableFarmStore(i18n), {
    t: i18n.t,
    setLocale: i18n.setLocale,
  });
}
