import IntlMessageFormat from "intl-messageformat";
import { getActiveFarmI18nSnapshot } from "./bridge";
import { localizeFarmHref, resolveFarmLocalePath } from "./routing";
import type {
  FarmI18nClientSnapshot,
  FarmI18nLocale,
  FarmI18nMessageArgs,
  FarmI18nMessageKey,
  FarmTranslator,
} from "./types";

type Listener = () => void;

const listeners = new Set<Listener>();
const compiled = new Map<string, IntlMessageFormat>();
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
  if (changed) compiled.clear();
  for (const listener of listeners) listener();
}

const translate = (key: string, values?: Record<string, unknown>, rich = false): unknown => {
  const snapshot = requireSnapshot();
  const message = snapshot.messages[key];
  if (message === undefined) return key;
  const cacheKey = `${snapshot.locale}\u0000${key}\u0000${message}`;
  let formatter = compiled.get(cacheKey);
  if (!formatter) {
    formatter = new IntlMessageFormat(message, snapshot.locale);
    compiled.set(cacheKey, formatter);
  }
  const result = formatter.format(values as any);
  if (rich) return Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (Array.isArray(result) && result.some((part) => typeof part !== "string")) {
    throw new Error(`Farm i18n message "${key}" contains rich content. Render it with t.rich().`);
  }
  return Array.isArray(result) ? result.join("") : String(result);
};

export const t = ((key: string, values?: Record<string, unknown>) =>
  translate(key, values)) as FarmTranslator;
t.rich = (key: string, values?: Record<string, unknown>) => translate(key, values, true);
t.raw = (key: string) => requireSnapshot().messages[key] ?? key;
t.has = (key: string) => key in requireSnapshot().messages;

export function localizeActiveFarmHref(href: string, locale?: FarmI18nLocale): string {
  const snapshot = getFarmI18nClientState();
  if (!snapshot) return href;
  return localizeFarmHref(href, locale || snapshot.locale, snapshot);
}

export function isFarmLocaleChangeHref(href: string): boolean {
  const snapshot = getFarmI18nClientState();
  if (!snapshot || typeof window === "undefined") return false;
  if (snapshot.routing === "none") return false;
  const target = new URL(href, window.location.origin);
  const match = resolveFarmLocalePath(target.pathname, snapshot);
  const targetLocale = match.locale || snapshot.defaultLocale;
  return targetLocale !== snapshot.locale;
}

export function createFarmClientTranslator(): FarmTranslator {
  return (<TKey extends FarmI18nMessageKey>(key: TKey, ...args: FarmI18nMessageArgs<TKey>) =>
    t(key, ...args)) as FarmTranslator;
}

function requireSnapshot(): FarmI18nClientSnapshot {
  const snapshot = getFarmI18nClientState();
  if (!snapshot) {
    throw new Error("Farm i18n is not configured or has not been hydrated.");
  }
  return snapshot;
}
