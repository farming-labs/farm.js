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

/**
 * @internal The request for a page at the URL it answers at ('/about/' with `trailingSlash`),
 * so a Markdown mirror or page check that names the page renders it rather than the 308.
 */
export function toFarmTrailingSlashPageRequest(request: Request, enabled: boolean): Request {
  const url = new URL(request.url);
  const pathname = normalizeFarmTrailingSlashPathname(url.pathname, enabled);
  if (pathname === url.pathname) return request;
  url.pathname = pathname;
  return new Request(url, request);
}

export function resolveFarmTrailingSlashRedirect(url: URL, enabled: boolean): string | null {
  const pathname = normalizeFarmTrailingSlashPathname(url.pathname, enabled);
  if (pathname === url.pathname) return null;
  // Route matching skips empty segments, so "//host/" can match a root dynamic route. Collapse
  // leading separators (browsers read a backslash as "/") so the relative Location never reads as
  // the protocol-relative URL "//host". A path whose trailing slash is already canonical is served
  // as it is, as before.
  return `${pathname.replace(/^[/\\]+/, "/")}${url.search}`;
}
