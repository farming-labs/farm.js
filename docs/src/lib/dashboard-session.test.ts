// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  createDashboardSession,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  isValidDashboardSession,
  safeSecretEqual,
} from "./dashboard-session";

const TOKEN = "s3cret-dashboard-token";

describe("telemetry dashboard session", () => {
  it("accepts a freshly issued session", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(isValidDashboardSession(createDashboardSession(TOKEN, now), TOKEN, now)).toBe(true);
  });

  it("expires a session once its window has passed", () => {
    const issued = Date.UTC(2026, 0, 1, 12, 0, 0);
    const session = createDashboardSession(TOKEN, issued);
    const justInside = issued + (DASHBOARD_SESSION_MAX_AGE_SECONDS - 60) * 1000;
    const wellPast = issued + (DASHBOARD_SESSION_MAX_AGE_SECONDS + 60) * 1000;

    expect(isValidDashboardSession(session, TOKEN, justInside)).toBe(true);
    // The previous value was a constant with no issue time: replaying it a year
    // later still authenticated.
    expect(isValidDashboardSession(session, TOKEN, wellPast)).toBe(false);
  });

  it("rejects a session signed with a different token", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const session = createDashboardSession("another-token", now);
    expect(isValidDashboardSession(session, TOKEN, now)).toBe(false);
  });

  it("rejects tampered issue times and malformed values", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const session = createDashboardSession(TOKEN, now);
    const signature = session.slice(session.lastIndexOf(".") + 1);
    const laterIssuedAt = Math.floor(now / 1000) + 10_000;

    // Re-dating a session must not survive, since the time is signed.
    expect(isValidDashboardSession(`${laterIssuedAt}.${signature}`, TOKEN, now)).toBe(false);
    for (const value of ["", "abc", "abc.def", ".", `${Math.floor(now / 1000)}.`]) {
      expect(isValidDashboardSession(value, TOKEN, now)).toBe(false);
    }
  });

  it("compares secrets of differing length without short-circuiting", () => {
    expect(safeSecretEqual("short", "a-much-longer-secret")).toBe(false);
    expect(safeSecretEqual(undefined, TOKEN)).toBe(false);
    expect(safeSecretEqual(TOKEN, TOKEN)).toBe(true);
  });
});
