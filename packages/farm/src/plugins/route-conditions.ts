import type { FarmRouteCondition } from "../config";

/**
 * `has`/`missing` conditions on config `redirects()` and `rewrites()` entries.
 *
 * This is the single source of truth for condition semantics, shared by the dev
 * plugins (`plugins/config-routes.ts`) and mirrored in the generated Nitro
 * entry (`nitro/universal-build.ts`, `generateConfigRouteConditionsSource()`):
 * a rule applies only when every `has` condition holds and no `missing`
 * condition holds. A path-matching rule whose conditions fail is skipped, so
 * the next rule for the same source is tried.
 *
 * - `cookie`: the named cookie's value, from the request `Cookie` header.
 * - `header`: the named request header (matched case-insensitively).
 * - `query`: a query parameter of the request URL.
 * - `host`: the request URL's hostname.
 *
 * Without `value` a condition is a presence check. With `value` it is an
 * unanchored regular-expression test against the looked-up value, as in
 * Next.js `has` conditions: `value: "^on$"` matches exactly `on`, while
 * `value: "beta"` also matches `beta-2`. Named capture groups in `value` are
 * not interpolated into the destination.
 */

export function matchesFarmRouteConditions(
  has: readonly FarmRouteCondition[] | undefined,
  missing: readonly FarmRouteCondition[] | undefined,
  url: URL,
  headers?: Headers,
): boolean {
  for (const condition of has ?? []) {
    if (!matchesFarmRouteCondition(condition, url, headers)) return false;
  }
  for (const condition of missing ?? []) {
    if (matchesFarmRouteCondition(condition, url, headers)) return false;
  }
  return true;
}

export function matchesFarmRouteCondition(
  condition: FarmRouteCondition,
  url: URL,
  headers?: Headers,
): boolean {
  if (condition.type === "query") {
    // A repeated parameter satisfies the condition when any value does.
    const values = url.searchParams.getAll(condition.key ?? "");
    if (condition.value === undefined) return values.length > 0;
    const pattern = new RegExp(condition.value);
    return values.some((value) => pattern.test(value));
  }
  const actual = readFarmRouteConditionValue(condition, url, headers);
  if (actual === undefined) return false;
  if (condition.value === undefined) return true;
  return new RegExp(condition.value).test(actual);
}

function readFarmRouteConditionValue(
  condition: FarmRouteCondition,
  url: URL,
  headers?: Headers,
): string | undefined {
  switch (condition.type) {
    case "cookie":
      return readFarmCookieValue(headers?.get("cookie") ?? null, condition.key ?? "");
    case "header":
      return headers?.get(condition.key ?? "") ?? undefined;
    case "host":
      return url.hostname.toLowerCase();
    case "query":
      // Handled in matchesFarmRouteCondition so a repeated parameter can match
      // on any of its values; unreachable here.
      return url.searchParams.get(condition.key ?? "") ?? undefined;
  }
}

/** The first cookie with `name`; its value percent-decoded when possible. */
function readFarmCookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    const cookieName = (separator === -1 ? part : part.slice(0, separator)).trim();
    if (cookieName !== name) continue;
    const raw = separator === -1 ? "" : part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/**
 * Fail fast on a malformed condition list, so `farm dev` and `farm build`
 * reject it at config resolution instead of leaving the rule unmatched.
 * `host` needs a `value`: a host is always present, so a presence-only host
 * condition would match every request.
 */
export function validateFarmRouteConditions(
  conditions: readonly FarmRouteCondition[] | undefined,
  field: string,
): void {
  for (const [index, condition] of (conditions ?? []).entries()) {
    const label = `${field}[${index}]`;
    if (!condition || typeof condition !== "object") {
      throw new TypeError(`${label} must be an object with a "type".`);
    }
    if (
      condition.type !== "cookie" &&
      condition.type !== "header" &&
      condition.type !== "query" &&
      condition.type !== "host"
    ) {
      throw new TypeError(`${label}.type must be one of "cookie", "header", "query", or "host".`);
    }
    if (condition.type === "host") {
      if (condition.value === undefined || condition.value === "") {
        throw new TypeError(
          `${label}.value is required for a "host" condition: a host is always present, so a presence-only host condition would match every request.`,
        );
      }
    } else if (typeof condition.key !== "string" || condition.key === "") {
      throw new TypeError(
        `${label}.key must be a non-empty string for a "${condition.type}" condition.`,
      );
    }
    if (condition.value !== undefined) {
      if (typeof condition.value !== "string") {
        throw new TypeError(`${label}.value must be a string regular expression.`);
      }
      try {
        new RegExp(condition.value);
      } catch {
        throw new Error(
          `${label}.value ${JSON.stringify(condition.value)} is not a valid regular expression.`,
        );
      }
    }
  }
}

/**
 * A Node request's headers as a `Headers` object for condition matching.
 * Multi-valued headers are joined as one comma-separated value, as HTTP
 * defines for every header conditions read except `Set-Cookie`, which a
 * request never carries.
 */
export function toFarmRouteConditionHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Headers | undefined {
  if (!headers) return undefined;
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return result;
}
