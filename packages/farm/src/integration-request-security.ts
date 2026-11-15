import {
  getRequestSourceOrigin,
  matchesAllowedOrigin,
  matchesHostHeader,
  normalizeAllowedOriginPattern,
} from "./request-origin";

/**
 * Integration auth routes accept ordinary form posts, which browsers send
 * cross-site without a CORS preflight. Without an origin check, a third-party
 * page can submit credentials to an app's own sign-in route and plant an
 * attacker-controlled session in the victim's browser (login CSRF), or drive a
 * forced sign-out. This mirrors the server-action origin contract so both
 * entry points reject the same requests.
 */

export type IntegrationOriginRejection =
  | "missing-origin"
  | "opaque-origin"
  | "invalid-origin"
  | "cross-site";

export type IntegrationOriginResult =
  | { ok: true }
  | { ok: false; reason: IntegrationOriginRejection };

export interface IntegrationOriginPolicy {
  /** Extra trusted origins, using the `serverActions.allowedOrigins` pattern syntax. */
  allowedOrigins?: readonly string[];
  /**
   * Whether a request carrying no origin metadata at all must be rejected.
   *
   * Form posts always carry an Origin header in supported browsers, so
   * state-changing POSTs default to rejecting (`true`). Top-level GET
   * navigations legitimately arrive with no Origin and no Referer — a typed
   * URL or a bookmark — so GET callers pass `false` to avoid breaking them.
   */
  requireOriginMetadata?: boolean;
}

/**
 * Resolve configured origin patterns once, at integration construction, so an
 * invalid pattern fails loudly at startup instead of per request.
 */
export function resolveIntegrationAllowedOrigins(
  values: readonly string[] | undefined,
  label: string,
): readonly string[] {
  return Object.freeze((values ?? []).map((value) => normalizeAllowedOriginPattern(value, label)));
}

export function validateIntegrationRequestOrigin(
  request: Request,
  policy: IntegrationOriginPolicy = {},
): IntegrationOriginResult {
  const allowedOrigins = policy.allowedOrigins ?? [];
  const requireOriginMetadata = policy.requireOriginMetadata ?? true;
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  const source = getRequestSourceOrigin(request);

  if (!source.ok) {
    return { ok: false, reason: source.reason };
  }

  if (source.origin === null) {
    // No Origin and no Referer. `sec-fetch-site: same-origin` still proves the
    // request is first-party.
    if (fetchSite === "same-origin") {
      return { ok: true };
    }

    // Strict mode (state-changing POSTs) has nothing left to verify against.
    if (requireOriginMetadata) {
      return { ok: false, reason: fetchSite === "cross-site" ? "cross-site" : "missing-origin" };
    }

    // Lenient mode still rejects a request the browser labelled cross-site.
    // Everything else here is a direct navigation (`none`), a same-site
    // navigation, or a client too old to send Sec-Fetch-Site at all.
    return fetchSite === "cross-site" ? { ok: false, reason: "cross-site" } : { ok: true };
  }

  const requestUrl = new URL(request.url);
  const matchesConfiguredOrigin = allowedOrigins.some((pattern) =>
    matchesAllowedOrigin(source.origin as string, pattern),
  );
  const matchesRequest =
    source.origin === requestUrl.origin || matchesHostHeader(source.origin, request);

  if (!matchesRequest && !matchesConfiguredOrigin) {
    return { ok: false, reason: "cross-site" };
  }

  if (fetchSite === "cross-site" && !matchesConfiguredOrigin) {
    return { ok: false, reason: "cross-site" };
  }

  return { ok: true };
}

/**
 * Refuse a cross-site request whose declared body type is not JSON, for a route whose body schema
 * reads JSON.
 *
 * `application/json` is not a CORS-safelisted type, so a page on another site can send a JSON body
 * only after a CORS preflight the app allows. `text/plain`,
 * `application/x-www-form-urlencoded`, and `multipart/form-data` skip that preflight and still
 * carry the visitor's cookies, so a body declared as one of them, or as any other non-JSON type,
 * is refused before the route reads it. Same-origin requests and callers that send no origin
 * metadata at all (servers, webhooks) keep every content type they had.
 */
export function rejectCrossSiteNonJSONBody(request: Request, message: string): Response | null {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || contentType === "application/json" || contentType.endsWith("+json")) {
    return null;
  }
  if (validateIntegrationRequestOrigin(request, { requireOriginMetadata: false }).ok) {
    return null;
  }
  return Response.json({ error: "Unsupported Media Type", message }, { status: 415 });
}

export function describeIntegrationOriginRejection(reason: IntegrationOriginRejection): string {
  switch (reason) {
    case "missing-origin":
      return "Request is missing same-origin metadata.";
    case "opaque-origin":
      return "Opaque origins are not allowed.";
    case "invalid-origin":
      return "Invalid request origin.";
    case "cross-site":
      return "Cross-site request was rejected.";
  }
}
