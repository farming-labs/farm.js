import type { FarmThemeConfig, ResolvedFarmThemeConfig } from "./types";

export const DEFAULT_FARM_THEME_STORAGE_KEY = "farm-theme";

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function resolveFarmThemeConfig(
  config: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
): ResolvedFarmThemeConfig {
  if (config && "enabled" in config) {
    return config;
  }

  if (!config) {
    return {
      enabled: false,
      default: "system",
      storageKey: DEFAULT_FARM_THEME_STORAGE_KEY,
      cookiePath: normalizeCookiePath(basePath),
    };
  }

  const storageKey = config.storageKey?.trim() || DEFAULT_FARM_THEME_STORAGE_KEY;
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new Error(
      "theme.storageKey may only contain letters, numbers, dots, underscores, and hyphens.",
    );
  }

  const defaultTheme = config.default ?? "system";
  if (defaultTheme !== "light" && defaultTheme !== "dark" && defaultTheme !== "system") {
    throw new Error('theme.default must be "light", "dark", or "system".');
  }

  return {
    enabled: true,
    default: defaultTheme,
    storageKey,
    cookiePath: normalizeCookiePath(basePath),
  };
}

function normalizeCookiePath(basePath: string): string {
  const normalized = `/${basePath}`.replace(/\/{2,}/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/$/, "");
}
