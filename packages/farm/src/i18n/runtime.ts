import IntlMessageFormat from "intl-messageformat";
import { readFarmI18nCatalogs } from "./catalog";
import { getFarmLocaleDirection } from "./routing";
import { resolveFarmLocaleRequest, type FarmLocaleResolution } from "./resolver";
import type { FarmI18nCatalogs, FarmI18nClientSnapshot, ResolvedFarmI18nConfig } from "./types";

export class FarmI18nRuntime {
  readonly config: ResolvedFarmI18nConfig;
  private catalogs: FarmI18nCatalogs;
  private compiled = new Map<string, IntlMessageFormat>();
  private warnedMissing = new Set<string>();

  constructor(config: ResolvedFarmI18nConfig, catalogs: FarmI18nCatalogs = {}) {
    this.config = config;
    this.catalogs = catalogs;
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) return;
    const bundle = await readFarmI18nCatalogs(this.config);
    this.replaceCatalogs(bundle.catalogs);
  }

  async reload(): Promise<void> {
    await this.initialize();
  }

  replaceCatalogs(catalogs: FarmI18nCatalogs): void {
    this.catalogs = catalogs;
    this.compiled.clear();
    this.warnedMissing.clear();
  }

  getCatalogs(): FarmI18nCatalogs {
    return Object.fromEntries(
      Object.entries(this.catalogs).map(([locale, catalog]) => [locale, { ...catalog }]),
    );
  }

  resolveRequest(request: Request, options: { redirect?: boolean } = {}): FarmLocaleResolution {
    return resolveFarmLocaleRequest(request, this.config, options);
  }

  translate(locale: string, key: string, values?: Record<string, unknown>): string {
    const result = this.formatMessage(locale, key, values);
    if (Array.isArray(result) && result.some((part) => typeof part !== "string")) {
      throw new Error(`Farm i18n message "${key}" contains rich content. Render it with t.rich().`);
    }
    return Array.isArray(result) ? result.join("") : String(result);
  }

  translateRich(locale: string, key: string, values?: Record<string, unknown>): unknown {
    const result = this.formatMessage(locale, key, values);
    return Array.isArray(result) && result.length === 1 ? result[0] : result;
  }

  getRawMessage(locale: string, key: string): string {
    return this.resolveMessage(locale, key);
  }

  hasMessage(locale: string, key: string): boolean {
    return (
      (this.catalogs[locale]?.[key] ?? this.catalogs[this.config.fallbackLocale]?.[key]) !==
      undefined
    );
  }

  getClientSnapshot(resolution: FarmLocaleResolution): FarmI18nClientSnapshot {
    return {
      locale: resolution.locale,
      source: resolution.source,
      locales: this.config.locales,
      defaultLocale: this.config.defaultLocale,
      routing: this.config.routing,
      cookie: this.config.cookie,
      direction: getFarmLocaleDirection(resolution.locale, this.config.direction),
      messages: {
        ...this.catalogs[this.config.fallbackLocale],
        ...this.catalogs[resolution.locale],
      },
    };
  }

  private formatMessage(locale: string, key: string, values?: Record<string, unknown>): unknown {
    const message = this.resolveMessage(locale, key);
    const cacheKey = `${locale}\u0000${key}\u0000${message}`;
    let formatter = this.compiled.get(cacheKey);
    if (!formatter) {
      formatter = new IntlMessageFormat(message, locale);
      this.compiled.set(cacheKey, formatter);
    }
    return formatter.format(values as any);
  }

  private resolveMessage(locale: string, key: string): string {
    const message =
      this.catalogs[locale]?.[key] ?? this.catalogs[this.config.fallbackLocale]?.[key];
    if (message !== undefined) return message;
    if (this.config.strict) {
      throw new Error(`Missing Farm i18n message "${key}" for locale "${locale}".`);
    }
    const warningKey = `${locale}:${key}`;
    if (!this.warnedMissing.has(warningKey)) {
      this.warnedMissing.add(warningKey);
      console.warn(`[Farm.js] Missing i18n message "${key}" for locale "${locale}".`);
    }
    return key;
  }
}

export function createFarmI18nRuntime(
  config: ResolvedFarmI18nConfig,
  catalogs?: FarmI18nCatalogs,
): FarmI18nRuntime {
  return new FarmI18nRuntime(config, catalogs);
}
