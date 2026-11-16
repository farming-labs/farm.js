import type { RouteOpenAPIConfig } from "./types";

/**
 * Reads an API route file's `openapi` export. A misspelled option must fail
 * loudly: silently ignoring `{ hide: true }` would publish the route.
 */
export function resolveRouteOpenAPIConfig(
  value: unknown,
  label: string,
): RouteOpenAPIConfig | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(
      `${label} exports "openapi", which must be an object such as { hidden: true }.`,
    );
  }
  for (const key of Object.keys(value)) {
    if (key !== "hidden") {
      throw new TypeError(
        `${label} exports "openapi" with an unknown option "${key}". The supported option is "hidden".`,
      );
    }
  }
  const { hidden } = value as { hidden?: unknown };
  if (hidden !== undefined && typeof hidden !== "boolean") {
    throw new TypeError(`${label} exports "openapi.hidden", which must be a boolean.`);
  }
  return hidden === undefined ? {} : { hidden };
}
