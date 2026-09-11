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
  const canonicalHref = canonicalizeAppRelativeHref(href);
  if (
    canonicalHref === normalizedBasePath ||
    canonicalHref.startsWith(`${normalizedBasePath}/`) ||
    canonicalHref.startsWith(`${normalizedBasePath}?`) ||
    canonicalHref.startsWith(`${normalizedBasePath}#`)
  ) {
    return canonicalHref;
  }
  return `${normalizedBasePath}${canonicalHref}`;
}

function canonicalizeAppRelativeHref(href: string): string {
  const origin = "http://farm.local";
  const resolved = new URL(href, origin);
  if (resolved.origin !== origin) {
    throw new Error("Farm app-relative href cannot change the URL origin.");
  }
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
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

  const hasUnstableCharacters = (candidate: string) =>
    candidate.includes("\\") ||
    Array.from(candidate).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    });

  if (hasUnstableCharacters(basePath)) {
    throw new Error("Farm basePath cannot contain backslashes or control characters.");
  }

  const pathname = basePath.trim();
  if (!pathname || pathname === "/") return "";
  if (pathname.includes("?") || pathname.includes("#")) {
    throw new Error("Farm basePath cannot contain a query string or hash.");
  }
  if (pathname.startsWith("//") || /^[a-z][a-z\d+.-]*:\/\//i.test(pathname)) {
    throw new Error('Farm basePath must be a pathname such as "/docs", not a URL.');
  }

  for (const segment of pathname.split("/")) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // Malformed escapes remain literal in URL pathnames and cannot be dot segments.
    }
    if (hasUnstableCharacters(decoded)) {
      throw new Error("Farm basePath cannot contain backslashes or control characters.");
    }
    if (decoded.includes("/")) {
      throw new Error("Farm basePath cannot contain percent-encoded path separators.");
    }
    if (decoded === "." || decoded === "..") {
      throw new Error('Farm basePath cannot contain "." or ".." path segments.');
    }
  }

  return `/${pathname}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
}

/** Normalize a configured application base path while preserving `/` for root. */
export function normalizeFarmConfigBasePath(basePath: string | undefined): string {
  return normalizeFarmBasePath(basePath) || "/";
}
