// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

function createContext(
  request: Request,
  path: string,
  instance: unknown,
): FarmIntegrationHandlerContext {
  const req = {
    get: () => undefined,
    set() {},
    has: () => false,
    delete: () => false,
    clear() {},
    snapshot: () => new Map<string, unknown>(),
  };
  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method: request.method,
    params: {},
    input: {},
    data: {},
    integration: { category: "payment", slot: "payment", type: "stripe", instance },
    route: { kind: "route", path, methods: [request.method] },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

const owner: StripeBillingOwner = { kind: "user", id: "user_end" };

function createBilling(initial: Partial<StripeBillingSnapshot> = {}) {
  let snapshot: StripeBillingSnapshot = {
    owner,
    planId: "pro",
    productId: "pro",
    status: "active",
    stripeCustomerId: "cus_end",
    stripeSubscriptionId: "sub_end",
    currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
    cancelAtPeriodEnd: true,
    trialEndsAt: null,
    trialUsedAt: null,
    seatQuantity: 5,
    seatAllowanceOverride: null,
    metadata: {},
    ...initial,
  };
  const integration = stripe({
    instance: {
      async createCheckoutSession() {
        throw new Error("not needed");
      },
      async createPortalSession() {
        throw new Error("not needed");
      },
      async retrieveCheckoutSession() {
        throw new Error("not needed");
      },
      async constructWebhookEvent(input: { payload: string }) {
        return JSON.parse(input.payload) as {
          id: string;
          type: string;
          data: Record<string, unknown>;
        };
      },
    },
    billing: {
      resolveOwner: () => owner,
      plans: {
        free: { features: { pro: false }, limits: { projects: 1 } },
        pro: { features: { pro: true }, limits: { projects: 50 } },
      },
      products: { pro: { kind: "subscription", planId: "pro", priceId: "price_pro" } },
      hooks: {
        getBillingAccount: async () => snapshot,
        getBillingAccountByStripeCustomerId: async () => snapshot,
        async saveBillingSnapshot(next) {
          snapshot = next;
        },
      },
    },
  });
  const route = (path: string, method: string) => {
    const found = integration.routes.find(
      (entry) => entry.path === path && String(entry.method).toUpperCase() === method,
    );
    if (!found) throw new Error(`Route not found: ${method} ${path}`);
    return found;
  };

  return {
    snapshot: () => snapshot,
    async webhook(type: string, data: Record<string, unknown>) {
      const request = new Request("http://example.com/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "test" },
        body: JSON.stringify({ id: `evt_${type}`, type, data: { customer: "cus_end", ...data } }),
      });
      const response = await route("/billing/webhook", "POST").handler(
        request,
        createContext(request, "/billing/webhook", integration.instance),
      );
      expect(response.status).toBe(200);
    },
    async get(path: string) {
      const request = new Request(`http://example.com${path}`);
      const response = await route(path, "GET").handler(
        request,
        createContext(request, path, integration.instance),
      );
      return JSON.parse(await response.text()) as Record<string, unknown>;
    },
  };
}

describe("stripe subscription end", () => {
  it("drops the plan when customer.subscription.deleted arrives", async () => {
    const billing = createBilling();
    await billing.webhook("customer.subscription.deleted", { id: "sub_end", status: "canceled" });

    expect(billing.snapshot()).toMatchObject({
      planId: "free",
      productId: null,
      status: "canceled",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      seatQuantity: null,
    });
    await expect(billing.get("/billing/features")).resolves.toMatchObject({
      planId: "free",
      features: { pro: false },
    });
  });

  it("ignores the deletion of a subscription the owner no longer has", async () => {
    const billing = createBilling();
    await billing.webhook("customer.subscription.deleted", { id: "sub_old", status: "canceled" });
    expect(billing.snapshot()).toMatchObject({ planId: "pro", status: "active" });
  });

  it("does not revive a canceled subscription for a one-off invoice", async () => {
    const billing = createBilling({ status: "canceled" });
    await billing.webhook("invoice.paid", { id: "in_one_off", subscription: null });
    await billing.webhook("invoice.payment_failed", { id: "in_one_off_failed" });
    expect(billing.snapshot().status).toBe("canceled");

    // The subscription's own invoice still moves its status, in either API shape.
    await billing.webhook("invoice.payment_failed", {
      id: "in_sub",
      parent: { subscription_details: { subscription: "sub_end" } },
    });
    expect(billing.snapshot().status).toBe("past_due");
    await billing.webhook("invoice.paid", { id: "in_sub", subscription: "sub_end" });
    expect(billing.snapshot().status).toBe("active");
  });

  it("grants paid features only while the subscription is in good standing", async () => {
    for (const [status, pro] of [
      ["active", true],
      ["trialing", true],
      ["past_due", true],
      ["canceled", false],
      ["unpaid", false],
      ["incomplete", false],
    ] as const) {
      const billing = createBilling({ status });
      await expect(billing.get("/billing/features"), status).resolves.toMatchObject({
        features: { pro },
      });
      await expect(billing.get("/billing/limits"), status).resolves.toMatchObject({
        limits: { projects: pro ? 50 : 1 },
      });
      await expect(billing.get("/billing/status"), status).resolves.toMatchObject({
        status,
        features: { pro },
      });
    }
  });
});
