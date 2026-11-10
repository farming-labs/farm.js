import { decodeCookieName } from "../request-cookies";
import { getCurrentRequestOrNull } from "../server/request";
import { _setFarmThemeServerSnapshotResolver } from "./bridge";
import { resolveFarmThemeConfig } from "./config";
import type {
  FarmThemeConfig,
  FarmThemePreference,
  FarmThemeSnapshot,
  ResolvedFarmThemeConfig,
} from "./types";

// The app's theme config lives on globalThis, not in a module variable. In development an app
// that links @farm.js/core runs its pages under Vite's SSR runner, which loads its own copy of
// this module; the server configures the other copy. A module-local value left the runner's copy
// on the disabled default, so getTheme() and useTheme() rendered "system".
const FARM_THEME_DEFAULT_CONFIG = Symbol.for("farm.js.theme.default-config");
const DISABLED_THEME_CONFIG = resolveFarmThemeConfig(undefined);

type FarmThemeServerGlobal = typeof globalThis & {
  [FARM_THEME_DEFAULT_CONFIG]?: ResolvedFarmThemeConfig;
};

function getDefaultThemeConfig(): ResolvedFarmThemeConfig {
  return (globalThis as FarmThemeServerGlobal)[FARM_THEME_DEFAULT_CONFIG] ?? DISABLED_THEME_CONFIG;
}

export function _setDefaultFarmThemeConfig(
  config: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
): void {
  (globalThis as FarmThemeServerGlobal)[FARM_THEME_DEFAULT_CONFIG] = resolveFarmThemeConfig(
    config,
    basePath,
  );
}

// The theme preference is cosmetic, so a missing request context must never
// crash a render: without a request to read the cookie from, the configured
// default applies. Runtimes with partial AsyncLocalStorage support (for
// example StackBlitz WebContainers) can lose the store mid-render, and a
// thrown error here would also take down the error page itself.
export function getTheme(request: Request | null = getCurrentRequestOrNull()): FarmThemePreference {
  const config = getDefaultThemeConfig();
  if (!request) return config.default;
  return readFarmThemePreference(request, config);
}

export function getThemeSnapshot(
  request: Request | null = getCurrentRequestOrNull(),
): FarmThemeSnapshot {
  const config = getDefaultThemeConfig();
  const theme = request ? readFarmThemePreference(request, config) : config.default;
  return {
    theme,
    resolvedTheme: theme === "system" ? undefined : theme,
    mounted: false,
  };
}

export function readFarmThemePreference(
  request: Request,
  config: ResolvedFarmThemeConfig,
): FarmThemePreference {
  if (!config.enabled) return config.default;
  const stored = readCookie(request.headers.get("cookie"), config.storageKey);
  return isFarmThemePreference(stored) ? stored : config.default;
}

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const key = decodeCookieName(entry.slice(0, separator).trim());
    if (key !== name) continue;
    return decodeCookieValue(entry.slice(separator + 1).trim());
  }
  return undefined;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isFarmThemePreference(value: unknown): value is FarmThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

_setFarmThemeServerSnapshotResolver(() => {
  try {
    return getThemeSnapshot();
  } catch {
    const theme = getDefaultThemeConfig().default;
    return {
      theme,
      resolvedTheme: theme === "system" ? undefined : theme,
      mounted: false,
    };
  }
});
