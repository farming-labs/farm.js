import { AsyncLocalStorage } from "node:async_hooks";
import type { FarmLocaleResolution } from "./resolver";
import { _setFarmI18nSnapshotResolver } from "./bridge";
import { FarmI18nRuntime, createFarmI18nRuntime } from "./runtime";
import type {
  FarmI18nClientSnapshot,
  FarmI18nLocale,
  FarmI18nLocaleSource,
  FarmI18nMessageArgs,
  FarmI18nMessageKey,
  FarmTranslator,
} from "./types";

interface FarmI18nRequestState {
  runtime: FarmI18nRuntime;
  resolution: FarmLocaleResolution;
  snapshot: FarmI18nClientSnapshot;
}

interface FarmListFormatOptions {
  localeMatcher?: "lookup" | "best fit";
  type?: "conjunction" | "disjunction" | "unit";
  style?: "long" | "short" | "narrow";
}

const FARM_I18N_REQUEST_STORE = Symbol.for("farm.i18n.requestStore");
const FARM_I18N_DEFAULT_RUNTIME = Symbol.for("farm.i18n.defaultRuntime");

type GlobalFarmI18nState = typeof globalThis & {
  [FARM_I18N_REQUEST_STORE]?: AsyncLocalStorage<FarmI18nRequestState>;
  [FARM_I18N_DEFAULT_RUNTIME]?: FarmI18nRuntime;
};

function getRequestStore(): AsyncLocalStorage<FarmI18nRequestState> {
  const state = globalThis as GlobalFarmI18nState;
  return (state[FARM_I18N_REQUEST_STORE] ??= new AsyncLocalStorage<FarmI18nRequestState>());
}

function getState(): FarmI18nRequestState {
  const state = getRequestStore().getStore();
  if (!state) {
    throw new Error(
      "No Farm i18n request context is active. Use this API while rendering, inside an API route, or use createTranslator(locale).",
    );
  }
  return state;
}

export function _setDefaultFarmI18nRuntime(runtime: FarmI18nRuntime | undefined): void {
  (globalThis as GlobalFarmI18nState)[FARM_I18N_DEFAULT_RUNTIME] = runtime;
}

export async function _runWithFarmI18nRequest<T>(
  runtime: FarmI18nRuntime,
  request: Request,
  fn: (resolution: FarmLocaleResolution) => T | Promise<T>,
  options: { redirect?: boolean } = {},
): Promise<T> {
  const resolution = runtime.resolveRequest(request, options);
  const state: FarmI18nRequestState = {
    runtime,
    resolution,
    snapshot: runtime.getClientSnapshot(resolution),
  };
  return getRequestStore().run(state, () => fn(resolution));
}

export async function runWithLocale<T>(
  locale: FarmI18nLocale,
  fn: () => T | Promise<T>,
): Promise<T> {
  const runtime = getDefaultRuntime();
  assertLocale(runtime, locale);
  const resolution: FarmLocaleResolution = {
    locale,
    source: "explicit",
    pathname: "/",
    persist: false,
  };
  const state: FarmI18nRequestState = {
    runtime,
    resolution,
    snapshot: runtime.getClientSnapshot(resolution),
  };
  return getRequestStore().run(state, fn);
}

export function getLocale(): FarmI18nLocale {
  return getState().resolution.locale as FarmI18nLocale;
}

export function getLocaleSource(): FarmI18nLocaleSource {
  return getState().resolution.source;
}

export const t = createTranslatorFromState(() => getState());

export function createTranslator(locale: FarmI18nLocale): FarmTranslator {
  const runtime = getDefaultRuntime();
  assertLocale(runtime, locale);
  return createTranslatorFromState(() => ({
    runtime,
    resolution: {
      locale,
      source: "explicit",
      pathname: "/",
      persist: false,
    },
    snapshot: runtime.getClientSnapshot({
      locale,
      source: "explicit",
      pathname: "/",
      persist: false,
    }),
  }));
}

export function getFarmI18nClientSnapshot(): FarmI18nClientSnapshot | undefined {
  return getRequestStore().getStore()?.snapshot;
}

export const format = {
  number(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(getLocale(), options).format(value);
  },
  currency(
    value: number,
    currency: string,
    options: Omit<Intl.NumberFormatOptions, "style" | "currency"> = {},
  ): string {
    return new Intl.NumberFormat(getLocale(), {
      ...options,
      style: "currency",
      currency,
    }).format(value);
  },
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(getLocale(), options).format(value);
  },
  relativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    return new Intl.RelativeTimeFormat(getLocale(), options).format(value, unit);
  },
  list(values: Iterable<string>, options?: FarmListFormatOptions): string {
    const ListFormat = (Intl as any).ListFormat;
    return new ListFormat(getLocale(), options).format(Array.from(values));
  },
};

function getDefaultRuntime(): FarmI18nRuntime {
  const runtime = (globalThis as GlobalFarmI18nState)[FARM_I18N_DEFAULT_RUNTIME];
  if (!runtime?.config.enabled) {
    throw new Error("Farm i18n is not configured for this application.");
  }
  return runtime;
}

function assertLocale(runtime: FarmI18nRuntime, locale: string): void {
  if (!runtime.config.locales.includes(locale)) {
    throw new Error(`Unsupported Farm i18n locale "${locale}".`);
  }
}

function createTranslatorFromState(resolveState: () => FarmI18nRequestState): FarmTranslator {
  const translator = ((key: string, values?: Record<string, unknown>) => {
    const state = resolveState();
    return state.runtime.translate(state.resolution.locale, key, values);
  }) as FarmTranslator;
  translator.rich = (key: string, values?: Record<string, unknown>) => {
    const state = resolveState();
    return state.runtime.translateRich(state.resolution.locale, key, values);
  };
  translator.raw = (key: string) => {
    const state = resolveState();
    return state.runtime.getRawMessage(state.resolution.locale, key);
  };
  translator.has = (key: string) => {
    const state = resolveState();
    return state.runtime.hasMessage(state.resolution.locale, key);
  };
  return translator;
}

_setFarmI18nSnapshotResolver(() => getFarmI18nClientSnapshot());

export { FarmI18nRuntime, createFarmI18nRuntime };
export type { FarmI18nClientSnapshot, FarmI18nLocale, FarmI18nMessageArgs, FarmI18nMessageKey };
