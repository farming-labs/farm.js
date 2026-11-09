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
  // Route matching skips empty segments, so "//host/" matches a root dynamic route. Collapse the
  // leading slashes (browsers read a backslash as "/") so the canonical path never reads "//host".
  const canonical = pathname.replace(/^[/\\]+/, "/");
  if (canonical === "/") return canonical;
  if (enabled) return canonical.endsWith("/") ? canonical : `${canonical}/`;
  return canonical.replace(/\/+$/, "") || "/";
}

export function resolveFarmTrailingSlashRedirect(url: URL, enabled: boolean): string | null {
  const pathname = normalizeFarmTrailingSlashPathname(url.pathname, enabled);
  if (pathname === url.pathname) return null;
  // A relative Location starting with two slashes (or a slash and a backslash) leaves the origin.
  if (/^\/[/\\]/.test(pathname)) return null;
  return `${pathname}${url.search}`;
}
