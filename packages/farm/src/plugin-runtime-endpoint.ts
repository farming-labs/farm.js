/** @internal Normalize and validate an exact application-relative plugin endpoint path. */
export function normalizeFarmPluginRuntimeEndpointPath(
  pathname: string,
  label = "Farm plugin runtime endpoint",
): string {
  if (typeof pathname !== "string" || pathname.trim() !== pathname || pathname.length === 0) {
    throw new TypeError(`${label} path must be a non-empty pathname without surrounding spaces`);
  }
  if (
    !pathname.startsWith("/") ||
    pathname.startsWith("//") ||
    pathname.includes("?") ||
    pathname.includes("#") ||
    pathname.includes("*")
  ) {
    throw new TypeError(`${label} path must be an exact pathname such as "/status"`);
  }
  if (
    pathname.includes("\\") ||
    Array.from(pathname).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159);
    })
  ) {
    throw new TypeError(`${label} path cannot contain backslashes or control characters`);
  }

  for (const segment of pathname.split("/").slice(1)) {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError(`${label} path contains a malformed percent escape`);
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw new TypeError(`${label} path cannot contain percent-encoded path separators`);
    }
    if (decoded === "." || decoded === "..") {
      throw new TypeError(`${label} path cannot contain dot segments`);
    }
  }

  return normalizeRuntimeEndpointRequestPath(pathname);
}

/** @internal Normalize a URL pathname for exact endpoint matching. */
export function normalizeRuntimeEndpointRequestPath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

/** @internal Whether a server plugin can change how a specific application path is served. */
export function farmPluginMayAffectRuntimePath(plugin: FarmPlugin, pathname: string): boolean {
  const runtime = plugin.runtime;
  const endpoints = runtime?.endpoints;
  const hasUnscopedRequestHooks = Boolean(
    plugin.init ||
    plugin.ready ||
    plugin.shutdown ||
    runtime?.context ||
    runtime?.before ||
    runtime?.after ||
    runtime?.error ||
    plugin.router ||
    plugin.render ||
    plugin.beforeRouteMatch ||
    plugin.afterRouteMatch ||
    plugin.beforeRender ||
    plugin.afterRender ||
    plugin.onError ||
    plugin.transformHTML,
  );
  if (hasUnscopedRequestHooks) return true;

  if (Array.isArray(endpoints) && endpoints.length > 0) {
    const normalizedPathname = normalizeRuntimeEndpointRequestPath(pathname);
    return endpoints.some(
      (endpoint) =>
        normalizeFarmPluginRuntimeEndpointPath(
          endpoint.path,
          `Farm plugin "${plugin.name}" runtime endpoint`,
        ) === normalizedPathname,
    );
  }

  return Boolean(plugin.setup || runtime?.start || runtime?.close);
}
import type { FarmPlugin } from "./plugin";
