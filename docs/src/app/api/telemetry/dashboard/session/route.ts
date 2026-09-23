import {
  createDashboardSession,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS as SESSION_MAX_AGE_SECONDS,
  safeSecretEqual,
} from "../../../../../lib/dashboard-session";

const MAX_FORM_BYTES = 4 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 20;

let attempts = 0;
let attemptsStartedAt = 0;

function isRateLimited(now = Date.now()): boolean {
  if (now - attemptsStartedAt >= RATE_LIMIT_WINDOW_MS) {
    attemptsStartedAt = now;
    attempts = 0;
  }
  attempts += 1;
  return attempts > RATE_LIMIT_ATTEMPTS;
}

function sessionCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DASHBOARD_SESSION_COOKIE}=${value}; Path=/telemetry; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

import { readTextWithLimit } from "../../../../../lib/request-body";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return new Response("Unsupported content type", { status: 415 });
  }
  const read = await readTextWithLimit(request, MAX_FORM_BYTES);
  if (!read.ok) {
    return new Response("Payload too large", { status: 413 });
  }
  const fields = new URLSearchParams(read.text);
  if (fields.get("action") === "logout") {
    // The session cookie is scoped `Path=/telemetry`, but this route lives at
    // `/api/telemetry/dashboard/session` — which does not path-match it (RFC
    // 6265 §5.1.4) — so the browser never sends the cookie on this POST. A
    // presence-of-cookie guard is therefore structurally always-false and the
    // deletion becomes unreachable. Emit it unconditionally: a `Set-Cookie` is
    // applied to the store by its own `Path`/`Domain`, not by the request path.
    // Cross-site cookie-clearing is already bounded by `SameSite=Strict`.
    return redirect("/telemetry", sessionCookie("", 0));
  }

  const expected = process.env.FARM_TELEMETRY_DASHBOARD_TOKEN?.trim();
  // Check the credential before consulting the limiter. The counter is a single
  // process-global, so counting correct submissions let anyone lock the operator
  // out by burning the window with anonymous requests.
  if (expected && safeSecretEqual(fields.get("token")?.trim(), expected)) {
    return redirect(
      "/telemetry",
      sessionCookie(createDashboardSession(expected), SESSION_MAX_AGE_SECONDS),
    );
  }

  if (isRateLimited()) return redirect("/telemetry?error=rate-limited");
  return redirect("/telemetry?error=invalid");
}
