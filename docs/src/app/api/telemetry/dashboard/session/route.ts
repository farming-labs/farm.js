import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_FORM_BYTES = 4 * 1024;
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
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

function safeEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

function sessionValue(token: string): string {
  return createHmac("sha256", token).update("farm.telemetry.dashboard.v1").digest("hex");
}

function sessionCookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `farm_telemetry_dashboard=${value}; Path=/telemetry; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
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

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return new Response("Unsupported content type", { status: 415 });
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_FORM_BYTES) {
    return new Response("Payload too large", { status: 413 });
  }
  const fields = new URLSearchParams(body);
  if (fields.get("action") === "logout") {
    return redirect("/telemetry", sessionCookie("", 0));
  }
  if (isRateLimited()) return redirect("/telemetry?error=rate-limited");

  const expected = process.env.FARM_TELEMETRY_DASHBOARD_TOKEN?.trim();
  if (!expected || !safeEqual(fields.get("token")?.trim(), expected)) {
    return redirect("/telemetry?error=invalid");
  }
  return redirect("/telemetry", sessionCookie(sessionValue(expected), SESSION_MAX_AGE_SECONDS));
}
