// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
} from "../../../../../lib/dashboard-session";

const TOKEN = "s3cret-dashboard-token";
const ENDPOINT = "https://farmjs.dev/api/telemetry/dashboard/session";

const originalToken = process.env.FARM_TELEMETRY_DASHBOARD_TOKEN;

function formRequest(fields: Record<string, string>, cookie?: string): Request {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(body.length),
  };
  if (cookie !== undefined) headers.cookie = cookie;
  return new Request(ENDPOINT, { method: "POST", headers, body });
}

function deletionCookie(): string {
  // `sessionCookie("", 0)` — the cookie-store match for a deletion is on the
  // stored cookie's own Path/Domain, not the request path, so the response is
  // the same regardless of which URL the POST targeted.
  return `${DASHBOARD_SESSION_COOKIE}=; Path=/telemetry; HttpOnly; SameSite=Strict; Max-Age=0`;
}

async function route(): Promise<(request: Request) => Promise<Response>> {
  vi.resetModules();
  const mod = await import("./route");
  return mod.POST;
}

beforeEach(() => {
  vi.resetModules();
  if (originalToken === undefined) delete process.env.FARM_TELEMETRY_DASHBOARD_TOKEN;
  else process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = originalToken;
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.FARM_TELEMETRY_DASHBOARD_TOKEN;
  else process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = originalToken;
});

describe("dashboard session logout", () => {
  it("deletes the session cookie even when the browser does not attach it", async () => {
    // The session cookie is scoped Path=/telemetry while the logout form POSTs
    // to /api/telemetry/dashboard/session, which does not path-match it (RFC
    // 6265 §5.1.4), so a real browser never sends the cookie on this request.
    // A presence-of-cookie guard is therefore structurally always-false; the
    // deletion must be emitted unconditionally for logout to work at all.
    process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = TOKEN;
    const POST = await route();

    const response = await POST(formRequest({ action: "logout" }, ""));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/telemetry");
    expect(response.headers.get("set-cookie")).toBe(deletionCookie());
  });

  it("still deletes the session when the request happens to carry the cookie", async () => {
    process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = TOKEN;
    const POST = await route();

    const response = await POST(
      formRequest({ action: "logout" }, `${DASHBOARD_SESSION_COOKIE}=1700000000.deadbeef`),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/telemetry");
    expect(response.headers.get("set-cookie")).toBe(deletionCookie());
  });

  it("logs out even when the dashboard token was unset or rotated", async () => {
    // Logout clears a client-side credential and must not depend on the server
    // secret; an operator whose token has just been rotated must still be able
    // to end the session from the browser.
    delete process.env.FARM_TELEMETRY_DASHBOARD_TOKEN;
    const POST = await route();

    const response = await POST(formRequest({ action: "logout" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/telemetry");
    expect(response.headers.get("set-cookie")).toBe(deletionCookie());
  });

  it("deletes the cookie without broadening its scope to Path=/", async () => {
    // The fix keeps the original Path=/telemetry scope rather than broadening to
    // Path=/ so the HttpOnly credential is not attached to every /api/... route
    // and docs page. A deletion Set-Cookie matches the stored cookie by its own
    // Path/Domain, so narrowing the scope does not stop the deletion from taking
    // effect.
    process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = TOKEN;
    const POST = await route();

    const setCookie = (await POST(formRequest({ action: "logout" }))).headers.get("set-cookie");

    expect(setCookie).toContain("Path=/telemetry");
    expect(setCookie).not.toContain("Path=/;");
    expect(setCookie).not.toMatch(/Path=\/(\s|$)/);
  });

  it("preserves HttpOnly, SameSite=Strict, and Max-Age=0 on the deletion cookie", async () => {
    process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = TOKEN;
    const POST = await route();

    const setCookie = (await POST(formRequest({ action: "logout" }))).headers.get("set-cookie");

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=0");
  });
});

describe("dashboard session login", () => {
  it("issues a session cookie scoped to Path=/telemetry with the 12-hour max age", async () => {
    // Guards the root-cause invariant: the session cookie's Path=/telemetry
    // scope, which is what makes the logout POST path-mismatch in the first
    // place. Broadening it here (e.g. to Path=/) would silently reintroduce the
    // conditions that made an inbound-cookie guard seem plausible.
    process.env.FARM_TELEMETRY_DASHBOARD_TOKEN = TOKEN;
    const POST = await route();

    const response = await POST(formRequest({ token: TOKEN }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/telemetry");
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie!.startsWith(`${DASHBOARD_SESSION_COOKIE}=`)).toBe(true);
    expect(setCookie).toContain("; Path=/telemetry; HttpOnly; SameSite=Strict");
    expect(setCookie).toContain(`Max-Age=${DASHBOARD_SESSION_MAX_AGE_SECONDS}`);
  });
});
