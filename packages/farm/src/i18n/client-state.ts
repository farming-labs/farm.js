import type IntlMessageFormat from "intl-messageformat";
import { resolveFarmNavigationURL } from "../client/navigation-url";
import { getActiveFarmI18nSnapshot } from "./bridge";
import { localizeFarmHref, resolveFarmLocalePath } from "./routing";
import type { FarmI18nClientSnapshot, FarmI18nLocale } from "./types";

type Listener = () => void;

const listeners = new Set<Listener>();
// State owns invalidation so a locale change clears formatters before notifying
// subscribers, even if they translate synchronously. The type-only import keeps
// ICU parsing/formatting out of navigation-only bundles.
export const compiledFarmI18nMessages = new Map<string, IntlMessageFormat>();
let currentSnapshot: FarmI18nClientSnapshot | undefined;

export function getFarmI18nClientState(): FarmI18nClientSnapshot | undefined {
  return currentSnapshot || getActiveFarmI18nSnapshot();
}

export function subscribeFarmI18n(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function _hydrateFarmI18n(snapshot: FarmI18nClientSnapshot | undefined): void {
  if (!snapshot) return;
  const changed = currentSnapshot?.locale !== snapshot.locale;
  currentSnapshot = snapshot;
  if (typeof window !== "undefined") window.__FARM_I18N__ = snapshot;
  if (typeof document !== "undefined") {
    document.documentElement.lang = snapshot.locale;
    document.documentElement.dir = snapshot.direction;
  }
  if (changed) compiledFarmI18nMessages.clear();
  for (const listener of listeners) listener();
}

export function localizeActiveFarmHref(href: string, locale?: FarmI18nLocale): string {
  const snapshot = getFarmI18nClientState();
  if (!snapshot) return href;
  return localizeFarmHref(href, locale || snapshot.locale, snapshot);
}

export function isFarmLocaleChangeHref(href: string): boolean {
  const snapshot = getFarmI18nClientState();
  if (!snapshot || typeof window === "undefined") return false;
  if (snapshot.routing === "none") return false;
  const target = resolveFarmNavigationURL(href, window.location.href);
  const match = resolveFarmLocalePath(target.pathname, snapshot);
  const targetLocale = match.locale || snapshot.defaultLocale;
  return targetLocale !== snapshot.locale;
}
