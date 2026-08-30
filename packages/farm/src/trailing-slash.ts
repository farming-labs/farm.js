const FARM_TRAILING_SLASH_PREFERENCE = Symbol.for("farm.trailingSlashPreference");

function getFarmGlobalState(): Record<PropertyKey, unknown> {
  return globalThis as unknown as Record<PropertyKey, unknown>;
}

/** @internal Configure the app-wide URL preference for framework link rendering. */
export function setFarmTrailingSlashPreference(enabled: boolean | undefined): void {
  getFarmGlobalState()[FARM_TRAILING_SLASH_PREFERENCE] = enabled === true;
}

/** @internal Read the app-wide URL preference used by framework links. */
export function getFarmTrailingSlashPreference(): boolean {
  return getFarmGlobalState()[FARM_TRAILING_SLASH_PREFERENCE] === true;
}

export function normalizeFarmTrailingSlashPathname(pathname: string, enabled: boolean): string {
  if (pathname === "/") return pathname;
  if (enabled) return pathname.endsWith("/") ? pathname : `${pathname}/`;
  return pathname.replace(/\/+$/, "") || "/";
}

export function resolveFarmTrailingSlashRedirect(url: URL, enabled: boolean): string | null {
  const pathname = normalizeFarmTrailingSlashPathname(url.pathname, enabled);
  return pathname === url.pathname ? null : `${pathname}${url.search}`;
}
