const FARM_BASE_PATH = Symbol.for("farm.basePath");

function getFarmGlobalState(): Record<PropertyKey, unknown> {
  return globalThis as unknown as Record<PropertyKey, unknown>;
}

/** @internal Configure the app-wide base path for framework link rendering. */
export function setFarmBasePath(basePath: string | undefined): void {
  getFarmGlobalState()[FARM_BASE_PATH] = normalizeFarmBasePath(basePath);
}

/** @internal Read the app-wide base path used by framework links. */
export function getFarmBasePath(): string {
  return (getFarmGlobalState()[FARM_BASE_PATH] as string | undefined) ?? "";
}

export function applyFarmBasePath(href: string, basePath = getFarmBasePath()): string {
  const normalizedBasePath = normalizeFarmBasePath(basePath);
  if (!normalizedBasePath || !href.startsWith("/") || href.startsWith("//")) return href;
  if (
    href === normalizedBasePath ||
    href.startsWith(`${normalizedBasePath}/`) ||
    href.startsWith(`${normalizedBasePath}?`) ||
    href.startsWith(`${normalizedBasePath}#`)
  ) {
    return href;
  }
  return `${normalizedBasePath}${href}`;
}

export function stripFarmBasePath(pathname: string, basePath = getFarmBasePath()): string {
  const normalizedBasePath = normalizeFarmBasePath(basePath);
  if (!normalizedBasePath) return pathname || "/";
  if (pathname === normalizedBasePath) return "/";
  if (!pathname.startsWith(`${normalizedBasePath}/`)) return pathname || "/";
  return pathname.slice(normalizedBasePath.length) || "/";
}

export function normalizeFarmBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "";
  return `/${basePath}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}
