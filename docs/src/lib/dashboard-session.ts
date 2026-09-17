import { createHmac, timingSafeEqual } from "node:crypto";

export const DASHBOARD_SESSION_COOKIE = "farm_telemetry_dashboard";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Compare two secrets without leaking their contents or their length.
 *
 * Comparing the raw bytes short-circuits when the lengths differ, which makes
 * the expected length measurable; digesting both sides first gives a
 * fixed-width comparison.
 */
export function safeSecretEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedDigest = createHmac("sha256", "farm.telemetry.compare").update(received).digest();
  const expectedDigest = createHmac("sha256", "farm.telemetry.compare").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

function signSession(token: string, issuedAt: number): string {
  return createHmac("sha256", token)
    .update(`farm.telemetry.dashboard.v2:${issuedAt}`)
    .digest("hex");
}

/**
 * Issue a session value that carries its own issue time.
 *
 * The previous value was `HMAC(token, "…v1")` — a constant for the lifetime of
 * the token, with no issue time and no server-side state. Anyone who observed
 * it once could replay it indefinitely, and "log out" only cleared the cookie
 * client-side. Embedding the issue time under the signature lets the server
 * enforce the 12-hour lifetime it already advertises.
 */
export function createDashboardSession(token: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  return `${issuedAt}.${signSession(token, issuedAt)}`;
}

export function isValidDashboardSession(
  value: string | undefined,
  token: string,
  now = Date.now(),
): boolean {
  if (!value) return false;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const issuedAtValue = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return false;

  if (!safeSecretEqual(signature, signSession(token, issuedAt))) return false;

  const ageSeconds = Math.floor(now / 1000) - issuedAt;
  // Reject a future-dated session as well; the clock moving backwards must not
  // extend a session beyond its window.
  return ageSeconds >= 0 && ageSeconds < DASHBOARD_SESSION_MAX_AGE_SECONDS;
}
