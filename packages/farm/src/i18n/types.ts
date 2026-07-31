export type FarmI18nRouting = "prefix-always" | "prefix-except-default" | "none";

export type FarmI18nDetectionSignal = "url" | "cookie" | "accept-language";
export type FarmI18nLocaleSource = FarmI18nDetectionSignal | "default" | "explicit";
export type FarmI18nDirection = "ltr" | "rtl";

export interface FarmI18nCookieConfig {
  name?: string;
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}

export interface FarmI18nUserConfig {
  locales: readonly string[];
  defaultLocale: string;
  /** Directory containing `<locale>.json`, or a path containing `{locale}`. */
  messages?: string;
  routing?: FarmI18nRouting;
  detection?: false | readonly FarmI18nDetectionSignal[];
  fallbackLocale?: string;
  strict?: boolean;
  cookie?: FarmI18nCookieConfig;
  direction?: Partial<Record<string, FarmI18nDirection>>;
  /** @deprecated Use `detection: false` to disable automatic detection. */
  localeDetection?: boolean;
}

export interface ResolvedFarmI18nCookieConfig {
  name: string;
  maxAge: number;
  path: string;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
}

export interface ResolvedFarmI18nConfig {
  enabled: boolean;
  locales: readonly string[];
  defaultLocale: string;
  messages: string;
  routing: FarmI18nRouting;
  detection: readonly FarmI18nDetectionSignal[];
  fallbackLocale: string;
  strict: boolean;
  cookie: ResolvedFarmI18nCookieConfig;
  direction: Readonly<Record<string, FarmI18nDirection>>;
}

export type FarmI18nCatalog = Record<string, string>;
export type FarmI18nCatalogs = Record<string, FarmI18nCatalog>;

export interface FarmI18nClientSnapshot {
  locale: string;
  source: FarmI18nLocaleSource;
  locales: readonly string[];
  defaultLocale: string;
  routing: FarmI18nRouting;
  cookie: ResolvedFarmI18nCookieConfig;
  direction: FarmI18nDirection;
  messages: FarmI18nCatalog;
}

/** The generated `farm.d.ts` file augments this interface. */
export interface FarmI18nMessageRegistry {}

/** The generated `farm.d.ts` file augments this interface. */
export interface FarmI18nLocaleRegistry {}

type RegisteredMessageKey = Extract<keyof FarmI18nMessageRegistry, string>;
type RegisteredLocale = Extract<keyof FarmI18nLocaleRegistry, string>;

export type FarmI18nMessageKey = [RegisteredMessageKey] extends [never]
  ? string
  : RegisteredMessageKey;

export type FarmI18nLocale = [RegisteredLocale] extends [never] ? string : RegisteredLocale;

export type FarmI18nMessageValues<TKey extends FarmI18nMessageKey> =
  TKey extends RegisteredMessageKey ? FarmI18nMessageRegistry[TKey] : Record<string, unknown>;

export type FarmI18nMessageArgs<TKey extends FarmI18nMessageKey> = TKey extends RegisteredMessageKey
  ? keyof FarmI18nMessageRegistry[TKey] extends never
    ? [values?: FarmI18nMessageRegistry[TKey]]
    : [values: FarmI18nMessageRegistry[TKey]]
  : [values?: Record<string, unknown>];

export interface FarmTranslator {
  <TKey extends FarmI18nMessageKey>(key: TKey, ...args: FarmI18nMessageArgs<TKey>): string;
  rich<TKey extends FarmI18nMessageKey>(key: TKey, ...args: FarmI18nMessageArgs<TKey>): unknown;
  raw<TKey extends FarmI18nMessageKey>(key: TKey): string;
  has(key: string): boolean;
}

declare global {
  interface Window {
    __FARM_I18N__?: FarmI18nClientSnapshot;
  }
}
