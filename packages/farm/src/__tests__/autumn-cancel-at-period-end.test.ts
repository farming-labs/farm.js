// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isAutumnCancelAtPeriodEnd, normalizeAutumnStatus } from "../../../farm-autumn/src/index";

const HOUR = 60 * 60 * 1000;

// Minimal subscription shape; only the fields these helpers read matter.
function subscription(overrides: Record<string, unknown> = {}): any {
  return {
    id: "sub_1",
    planId: "pro",
    pastDue: false,
    canceledAt: null,
    expiresAt: null,
    trialEndsAt: null,
    status: "active",
    startedAt: Date.now() - HOUR,
    ...overrides,
  };
}

function customer(): any {
  return { id: "cus_1", subscriptions: [], purchases: [] };
}

describe("normalizeAutumnStatus", () => {
  it("keeps a scheduled cancel-at-period-end subscription active", () => {
    // canceledAt in the past, still usable until a future expiresAt.
    const sub = subscription({ canceledAt: Date.now() - HOUR, expiresAt: Date.now() + HOUR });
    expect(normalizeAutumnStatus(customer(), sub)).toBe("active");
  });

  it("reports canceled once access has ended", () => {
    expect(
      normalizeAutumnStatus(
        customer(),
        subscription({ canceledAt: Date.now() - HOUR, expiresAt: Date.now() - 1 }),
      ),
    ).toBe("canceled");
    // canceledAt with no remaining access window is an immediate cancel.
    expect(
      normalizeAutumnStatus(
        customer(),
        subscription({ canceledAt: Date.now() - HOUR, expiresAt: null }),
      ),
    ).toBe("canceled");
  });

  it("still reports active, trialing, and past_due correctly", () => {
    expect(normalizeAutumnStatus(customer(), subscription())).toBe("active");
    expect(
      normalizeAutumnStatus(customer(), subscription({ trialEndsAt: Date.now() + HOUR })),
    ).toBe("trialing");
    expect(normalizeAutumnStatus(customer(), subscription({ pastDue: true }))).toBe("past_due");
  });
});

describe("isAutumnCancelAtPeriodEnd", () => {
  it("is true only for a scheduled-but-not-yet-ended cancellation", () => {
    expect(
      isAutumnCancelAtPeriodEnd(
        subscription({ canceledAt: Date.now() - HOUR, expiresAt: Date.now() + HOUR }),
      ),
    ).toBe(true);
  });

  it("is false when nothing is scheduled, or the subscription already ended", () => {
    expect(isAutumnCancelAtPeriodEnd(subscription())).toBe(false);
    expect(isAutumnCancelAtPeriodEnd(subscription({ expiresAt: Date.now() + HOUR }))).toBe(false);
    expect(
      isAutumnCancelAtPeriodEnd(
        subscription({ canceledAt: Date.now() - HOUR, expiresAt: Date.now() - 1 }),
      ),
    ).toBe(false);
    expect(isAutumnCancelAtPeriodEnd(null)).toBe(false);
  });
});
