import { getCurrentRequestOrNull } from "../server/request";
import { _setFarmThemeServerSnapshotResolver } from "./bridge";
import { resolveFarmThemeConfig } from "./config";
import type {
  FarmThemeConfig,
  FarmThemePreference,
  FarmThemeSnapshot,
  ResolvedFarmThemeConfig,
} from "./types";

let defaultThemeConfig = resolveFarmThemeConfig(undefined);

export function _setDefaultFarmThemeConfig(
  config: FarmThemeConfig | ResolvedFarmThemeConfig | false | undefined,
  basePath = "/",
): void {
  defaultThemeConfig = resolveFarmThemeConfig(config, basePath);
}

// The theme preference is cosmetic, so a missing request context must never
// crash a render: without a request to read the cookie from, the configured
// default applies. Runtimes with partial AsyncLocalStorage support (for
// example StackBlitz WebContainers) can lose the store mid-render, and a
// thrown error here would also take down the error page itself.
export function getTheme(request: Request | null = getCurrentRequestOrNull()): FarmThemePreference {
  if (!request) return defaultThemeConfig.default;
  return readFarmThemePreference(request, defaultThemeConfig);
}

export function getThemeSnapshot(
  request: Request | null = getCurrentRequestOrNull(),
): FarmThemeSnapshot {
  const theme = request
    ? readFarmThemePreference(request, defaultThemeConfig)
    : defaultThemeConfig.default;
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
    const key = decodeCookieValue(entry.slice(0, separator).trim());
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
    const theme = defaultThemeConfig.default;
    return {
      theme,
      resolvedTheme: theme === "system" ? undefined : theme,
      mounted: false,
    };
  }
});
