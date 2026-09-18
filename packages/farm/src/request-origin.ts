/**
 * Shared request-origin primitives.
 *
 * Server actions and integration auth routes both need to decide whether a
 * state-changing request actually came from the app's own origin. The matching
 * rules (Origin/Referer resolution, Host fallback, wildcard subdomain patterns)
 * are security-sensitive and must not drift between the two, so they live here
 * and are consumed by both rather than reimplemented.
 *
 * These helpers never throw for untrusted input: callers map the failure
 * reasons onto their own error shapes.
 */

export type RequestOriginFailureReason = "opaque-origin" | "invalid-origin";

export type RequestSourceOriginResult =
  /** `origin` is null when the request carried no Origin or Referer header. */
  { ok: true; origin: string | null } | { ok: false; reason: RequestOriginFailureReason };

/** Resolve the origin a request claims to come from, preferring Origin over Referer. */
export function getRequestSourceOrigin(request: Request): RequestSourceOriginResult {
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    return parseSourceOrigin(origin);
  }

  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    return parseSourceOrigin(referer);
  }

  return { ok: true, origin: null };
}

function parseSourceOrigin(value: string): RequestSourceOriginResult {
  if (value === "null") {
    return { ok: false, reason: "opaque-origin" };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid-origin" };
    }
    return { ok: true, origin: parsed.origin };
  } catch {
    return { ok: false, reason: "invalid-origin" };
  }
}

/**
 * Accept a source origin whose host matches the `Host` header *and* whose
 * scheme matches the rebuilt `request.url` scheme. The scheme check blocks
 * browser-driven protocol-downgrade CSRF and also rejects proxy-rebuilt
 * `request.url` values whose scheme differs from the browser origin. For
 * TLS-terminating proxies that leave `request.url` as `http:`, enable
 * `trustProxy` with a proxy-emitted `X-Forwarded-Proto: https`, or add the
 * browser origin to `serverActions.allowedOrigins`.
 */
export function matchesHostHeader(sourceOrigin: string, request: Request): boolean {
  const host = request.headers.get("host")?.trim().toLowerCase();
  if (!host) return false;

  try {
    const source = new URL(sourceOrigin);
    const target = new URL(request.url);
    return source.protocol === target.protocol && source.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function matchesAllowedOrigin(sourceOrigin: string, pattern: string): boolean {
  const source = new URL(sourceOrigin);
  if (!pattern.includes("*")) {
    return pattern.includes("://") ? source.origin === pattern : source.host === pattern;
  }

  const schemeEnd = pattern.indexOf("://");
  const scheme = schemeEnd === -1 ? null : pattern.slice(0, schemeEnd + 1);
  const hostPattern = pattern.slice(schemeEnd === -1 ? 0 : schemeEnd + 3);
  const [wildcardHost, port] = splitHostAndPort(hostPattern);
  const baseHost = wildcardHost.slice(2);

  if (scheme && source.protocol !== scheme) return false;
  if (port && getEffectivePort(source) !== port) return false;
  if (!port && source.port) return false;

  return source.hostname.endsWith(`.${baseHost}`) && source.hostname !== baseHost;
}

/**
 * Validate and canonicalize a configured origin pattern. `label` names the
 * configuration field so the thrown message points at the user's own setting.
 */
export function normalizeAllowedOriginPattern(value: string, label: string): string {
  const pattern = value.trim().toLowerCase();
  if (!pattern) {
    throw new TypeError(`${label} cannot contain empty values`);
  }

  if (pattern.includes("*")) {
    if (!/^(?:https?:\/\/)?\*\.[a-z0-9.-]+(?::\d+)?$/.test(pattern)) {
      throw new TypeError(`Invalid ${label} pattern: ${JSON.stringify(value)}`);
    }
    return pattern;
  }

  if (pattern.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(pattern);
    } catch {
      throw new TypeError(`Invalid ${label} value: ${JSON.stringify(value)}`);
    }

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError(`${label} must contain origins without paths: ${JSON.stringify(value)}`);
    }
    return parsed.origin;
  }

  if (/[/@?#]/.test(pattern)) {
    throw new TypeError(`${label} must contain origins or hosts: ${JSON.stringify(value)}`);
  }

  try {
    return new URL(`http://${pattern}`).host;
  } catch {
    throw new TypeError(`Invalid ${label} value: ${JSON.stringify(value)}`);
  }
}

function splitHostAndPort(value: string): [string, string | null] {
  const separator = value.lastIndexOf(":");
  if (separator === -1) return [value, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function getEffectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "https:") return "443";
  if (url.protocol === "http:") return "80";
  return "";
}
