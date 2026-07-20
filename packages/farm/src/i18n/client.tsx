"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createFarmLocaleCookie } from "./resolver";
import { localizeFarmHref } from "./routing";
import {
  _hydrateFarmI18n,
  createFarmClientTranslator,
  getFarmI18nClientState,
  subscribeFarmI18n,
  t,
} from "./client-runtime";
import type { FarmI18nClientSnapshot, FarmI18nLocale, FarmTranslator } from "./types";

export interface FarmLocaleState {
  locale: FarmI18nLocale;
  locales: readonly FarmI18nLocale[];
  direction: "ltr" | "rtl";
  setLocale(locale: FarmI18nLocale): void;
}

interface FarmListFormatOptions {
  localeMatcher?: "lookup" | "best fit";
  type?: "conjunction" | "disjunction" | "unit";
  style?: "long" | "short" | "narrow";
}

export function useLocale(): FarmLocaleState {
  const snapshot = useFarmI18nSnapshot();
  return useMemo(
    () => ({
      locale: snapshot.locale as FarmI18nLocale,
      locales: snapshot.locales as readonly FarmI18nLocale[],
      direction: snapshot.direction,
      setLocale,
    }),
    [snapshot],
  );
}

export function useTranslations(): FarmTranslator {
  useFarmI18nSnapshot();
  return createFarmClientTranslator();
}

export function getLocale(): FarmI18nLocale {
  return requireSnapshot().locale as FarmI18nLocale;
}

export function getLocaleSource(): FarmI18nClientSnapshot["source"] {
  return requireSnapshot().source;
}

export function createTranslator(): FarmTranslator {
  return createFarmClientTranslator();
}

export function setLocale(locale: FarmI18nLocale): void {
  const snapshot = requireSnapshot();
  if (!snapshot.locales.includes(locale)) {
    throw new Error(`Unsupported Farm i18n locale "${locale}".`);
  }
  if (typeof window === "undefined") return;

  document.cookie = createFarmLocaleCookie(locale, { cookie: snapshot.cookie });

  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextHref = localizeFarmHref(currentHref, locale, snapshot);
  window.location.assign(nextHref);
}

export function _setFarmI18nClientSnapshot(snapshot: FarmI18nClientSnapshot): void {
  _hydrateFarmI18n(snapshot);
}

export const format = {
  number(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(requireSnapshot().locale, options).format(value);
  },
  currency(
    value: number,
    currency: string,
    options: Omit<Intl.NumberFormatOptions, "style" | "currency"> = {},
  ): string {
    return new Intl.NumberFormat(requireSnapshot().locale, {
      ...options,
      style: "currency",
      currency,
    }).format(value);
  },
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(requireSnapshot().locale, options).format(value);
  },
  relativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    return new Intl.RelativeTimeFormat(requireSnapshot().locale, options).format(value, unit);
  },
  list(values: Iterable<string>, options?: FarmListFormatOptions): string {
    const ListFormat = (Intl as any).ListFormat;
    return new ListFormat(requireSnapshot().locale, options).format(Array.from(values));
  },
};

function useFarmI18nSnapshot(): FarmI18nClientSnapshot {
  const snapshot = useSyncExternalStore(
    subscribeFarmI18n,
    getFarmI18nClientState,
    getFarmI18nClientState,
  );
  if (!snapshot) {
    throw new Error("Farm i18n is not configured or has not been hydrated.");
  }
  return snapshot;
}

function requireSnapshot(): FarmI18nClientSnapshot {
  const snapshot = getFarmI18nClientState();
  if (!snapshot) {
    throw new Error("Farm i18n is not configured or has not been hydrated.");
  }
  return snapshot;
}

export { t };
export type {
  FarmI18nClientSnapshot,
  FarmI18nLocale,
  FarmI18nMessageArgs,
  FarmI18nMessageKey,
} from "./types";
