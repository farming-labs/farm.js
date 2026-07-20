import path from "node:path";
import type {
  FarmI18nDetectionSignal,
  FarmI18nDirection,
  FarmI18nUserConfig,
  ResolvedFarmI18nConfig,
} from "./types";

export const DEFAULT_FARM_I18N_COOKIE = "farm_locale";
export const DEFAULT_FARM_I18N_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_DETECTION: readonly FarmI18nDetectionSignal[] = ["url", "cookie", "accept-language"];

export function resolveFarmI18nConfig(
  input: FarmI18nUserConfig | false | undefined,
  options: { root?: string; mode?: "development" | "production" } = {},
): ResolvedFarmI18nConfig {
  const root = options.root || process.cwd();
  const strictByDefault = options.mode === "production";

  if (!input) {
    return {
      enabled: false,
      locales: ["en"],
      defaultLocale: "en",
      messages: path.join(root, "src/messages"),
      routing: "none",
      detection: [],
      fallbackLocale: "en",
      strict: strictByDefault,
      cookie: {
        name: DEFAULT_FARM_I18N_COOKIE,
        maxAge: DEFAULT_FARM_I18N_COOKIE_MAX_AGE,
        path: "/",
        sameSite: "lax",
        secure: options.mode === "production",
      },
      direction: {},
    };
  }

  if (!Array.isArray(input.locales) || input.locales.length === 0) {
    throw new Error("i18n.locales must contain at least one locale.");
  }

  const locales = input.locales.map(canonicalizeLocale);
  if (new Set(locales).size !== locales.length) {
    throw new Error("i18n.locales must not contain duplicate locales.");
  }

  const defaultLocale = canonicalizeLocale(input.defaultLocale);
  if (!locales.includes(defaultLocale)) {
    throw new Error(`i18n.defaultLocale "${defaultLocale}" must be included in i18n.locales.`);
  }

  const fallbackLocale = canonicalizeLocale(input.fallbackLocale || defaultLocale);
  if (!locales.includes(fallbackLocale)) {
    throw new Error(`i18n.fallbackLocale "${fallbackLocale}" must be included in i18n.locales.`);
  }

  const detection = resolveDetection(input);
  const direction: Record<string, FarmI18nDirection> = {};
  for (const [rawLocale, value] of Object.entries(input.direction || {})) {
    const locale = canonicalizeLocale(rawLocale);
    if (!locales.includes(locale)) {
      throw new Error(`i18n.direction contains unknown locale "${rawLocale}".`);
    }
    if (value !== "ltr" && value !== "rtl") {
      throw new Error(`i18n.direction.${rawLocale} must be "ltr" or "rtl".`);
    }
    direction[locale] = value;
  }

  return {
    enabled: true,
    locales,
    defaultLocale,
    messages: path.resolve(root, input.messages || "src/messages"),
    routing: input.routing || "prefix-except-default",
    detection,
    fallbackLocale,
    strict: input.strict ?? strictByDefault,
    cookie: {
      name: input.cookie?.name?.trim() || DEFAULT_FARM_I18N_COOKIE,
      maxAge: normalizePositiveInteger(
        input.cookie?.maxAge,
        DEFAULT_FARM_I18N_COOKIE_MAX_AGE,
        "i18n.cookie.maxAge",
      ),
      path: input.cookie?.path || "/",
      sameSite: input.cookie?.sameSite || "lax",
      secure: input.cookie?.secure ?? options.mode === "production",
    },
    direction,
  };
}

export function resolveFarmI18nMessagePath(
  config: Pick<ResolvedFarmI18nConfig, "messages">,
  locale: string,
): string {
  return config.messages.includes("{locale}")
    ? config.messages.split("{locale}").join(locale)
    : path.join(config.messages, `${locale}.json`);
}

export function canonicalizeLocale(locale: string): string {
  if (!locale || typeof locale !== "string") {
    throw new Error("Farm i18n locales must be non-empty strings.");
  }

  try {
    return Intl.getCanonicalLocales(locale)[0]!;
  } catch {
    throw new Error(`Invalid i18n locale "${locale}".`);
  }
}

function resolveDetection(input: FarmI18nUserConfig): readonly FarmI18nDetectionSignal[] {
  if (input.detection === false || input.localeDetection === false) {
    return ["url"];
  }

  const detection = input.detection || DEFAULT_DETECTION;
  const allowed = new Set<FarmI18nDetectionSignal>(["url", "cookie", "accept-language"]);
  const unique: FarmI18nDetectionSignal[] = [];

  for (const signal of detection) {
    if (!allowed.has(signal)) {
      throw new Error(`Unsupported i18n detection signal "${signal}".`);
    }
    if (!unique.includes(signal)) unique.push(signal);
  }

  return unique;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
