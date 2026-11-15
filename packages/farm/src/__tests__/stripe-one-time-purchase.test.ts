// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

function createContext(request: Request, path: string, instance: unknown) {
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
  } as FarmIntegrationHandlerContext;
}

const owner: StripeBillingOwner = { kind: "user", id: "user_credits" };

function createBilling(initial: StripeBillingSnapshot | null) {
  let snapshot = initial;
  const hooks = {
    onCheckoutCompleted: vi.fn(),
    onPaymentFailed: vi.fn(),
    onPaymentSucceeded: vi.fn(),
  };
  const integration = stripe({
    instance: {
      async createCheckoutSession() {
        throw new Error("not needed");
      },
      async createPortalSession() {
        throw new Error("not needed");
      },
      async retrieveCheckoutSession(id: string) {
        return {
          id,
          status: "complete",
          paymentStatus: "paid",
          mode: "payment" as const,
          customerId: "cus_credits",
          customerEmail: null,
          subscriptionId: null,
          subscriptionStatus: null,
          currentPeriodEnd: null,
          trialEndsAt: null,
          cancelAtPeriodEnd: false,
          amountSubtotal: 100,
          amountTotal: 100,
          currency: "usd",
          // Checkout stamps the plan the owner already had: credits sell no plan of their own.
          metadata: {
            productId: "credits",
            planId: snapshot?.planId ?? "free",
            ownerId: owner.id,
            ownerKind: owner.kind,
          },
          lineItems: [
            {
              description: "Credits",
              quantity: 1,
              amountSubtotal: 100,
              amountTotal: 100,
              currency: "usd",
              priceId: "price_credits",
              productId: "credits",
            },
          ],
        };
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
      resolveOwner: () => null,
      plans: { free: { features: { pro: false } }, pro: { features: { pro: true } } },
      products: {
        pro: { kind: "subscription", planId: "pro", priceId: "price_pro" },
        credits: { kind: "one_time", priceId: "price_credits" },
      },
      hooks: {
        getBillingAccount: async () => snapshot,
        getBillingAccountByStripeCustomerId: async () => snapshot,
        async saveBillingSnapshot(next) {
          snapshot = next;
        },
        async claimCheckoutSession() {
          return true;
        },
        ...hooks,
      },
    },
  });
  const webhook = async (type: string, data: Record<string, unknown>) => {
    const route = integration.routes.find((entry) => entry.path === "/billing/webhook")!;
    const request = new Request("http://example.com/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "test" },
      body: JSON.stringify({ id: `evt_${type}`, type, data }),
    });
    const response = await route.handler(
      request,
      createContext(request, "/billing/webhook", integration.instance),
    );
    expect(response.status).toBe(200);
  };
  return { snapshot: () => snapshot, hooks, webhook };
}

describe("stripe one-time purchases without a plan", () => {
  it("keep a past_due subscription past_due and attached", async () => {
    const billing = createBilling({
      owner,
      planId: "pro",
      productId: "pro",
      status: "active",
      stripeCustomerId: "cus_credits",
      stripeSubscriptionId: "sub_pro",
      currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: null,
      seatQuantity: null,
      seatAllowanceOverride: null,
      metadata: {},
    });
    await billing.webhook("invoice.payment_failed", {
      customer: "cus_credits",
      subscription: "sub_pro",
    });
    expect(billing.snapshot()?.status).toBe("past_due");
    billing.hooks.onPaymentFailed.mockClear();

    await billing.webhook("checkout.session.completed", { id: "cs_credits" });

    expect(billing.snapshot()).toMatchObject({
      planId: "pro",
      productId: "pro",
      status: "past_due",
      stripeSubscriptionId: "sub_pro",
      currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
    });
    expect(billing.hooks.onCheckoutCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "cs_credits",
        purchasedProductId: "credits",
        status: "past_due",
      }),
      expect.anything(),
    );
    expect(billing.hooks.onPaymentFailed).not.toHaveBeenCalled();
    expect(billing.hooks.onPaymentSucceeded).not.toHaveBeenCalled();
  });

  it("link a new customer without granting a plan or an active status", async () => {
    const billing = createBilling({
      owner,
      planId: "free",
      productId: null,
      status: "free",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: null,
      seatQuantity: null,
      seatAllowanceOverride: null,
      metadata: {},
    });
    await billing.webhook("checkout.session.completed", { id: "cs_credits" });
    expect(billing.snapshot()).toMatchObject({
      planId: "free",
      status: "free",
      productId: null,
      stripeCustomerId: "cus_credits",
    });
  });
});
