// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

type HookCall =
  | ["onBillingSync", string]
  | ["onCheckoutCreated", boolean, number | null]
  | ["onCheckoutCompleted", string]
  | ["onTrialStarted", string, number]
  | ["onTrialWillEnd", string]
  | ["onTrialEnded", string]
  | ["onTrialExpired", string]
  | ["onPaymentSucceeded", string]
  | ["onPaymentFailed", string];

function createRequestContextStore() {
  return {
    get() {
      return undefined;
    },
    set() {},
    has() {
      return false;
    },
    delete() {
      return false;
    },
    clear() {},
    snapshot() {
      return new Map<string, unknown>();
    },
  };
}

function createContext(
  request: Request,
  method: string,
  path: string,
  instance: unknown,
): FarmIntegrationHandlerContext {
  const req = createRequestContextStore();

  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method,
    params: {},
    input: {},
    data: {},
    integration: {
      category: "payment",
      slot: "payment",
      type: "stripe",
      instance,
    },
    route: {
      kind: "route",
      path,
      methods: [method],
    },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

describe("stripe trial hooks", () => {
  it("fires checkout and lifecycle hooks across trial transitions", async () => {
    const hookCalls: HookCall[] = [];
    const snapshotByOwner = new Map<string, StripeBillingSnapshot>();
    const customerIdByOwner = new Map<string, string>();
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_123",
      email: "owner@example.com",
    };
    const ownerKey = `${owner.kind}:${owner.id}`;

    const storage = {
      async getBillingAccount(nextOwner: StripeBillingOwner) {
        return snapshotByOwner.get(`${nextOwner.kind}:${nextOwner.id}`) ?? null;
      },
      async getBillingAccountByStripeCustomerId(customerId: string) {
        for (const snapshot of snapshotByOwner.values()) {
          if (snapshot.stripeCustomerId === customerId) {
            return snapshot;
          }
        }

        return null;
      },
      async ensureCustomer(input: { owner: StripeBillingOwner }) {
        const key = `${input.owner.kind}:${input.owner.id}`;
        const existing = customerIdByOwner.get(key);
        if (existing) {
          return { customerId: existing };
        }

        const customerId = "cus_test_123";
        customerIdByOwner.set(key, customerId);
        return { customerId };
      },
      async saveBillingSnapshot(snapshot: StripeBillingSnapshot) {
        snapshotByOwner.set(`${snapshot.owner.kind}:${snapshot.owner.id}`, snapshot);
      },
      async clearBillingSnapshot(nextOwner: StripeBillingOwner) {
        snapshotByOwner.delete(`${nextOwner.kind}:${nextOwner.id}`);
      },
    };

    let retrievedSession = {
      id: "cs_test_123",
      status: "complete",
      paymentStatus: "paid",
      mode: "subscription" as const,
      customerId: "cus_test_123",
      customerEmail: "owner@example.com",
      subscriptionId: "sub_test_123",
      subscriptionStatus: "trialing",
      currentPeriodEnd: new Date("2026-04-07T00:00:00.000Z").toISOString(),
      trialEndsAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
      cancelAtPeriodEnd: false,
      amountSubtotal: 1200,
      amountTotal: 1200,
      currency: "usd",
      metadata: {
        ownerId: owner.id,
        ownerKind: owner.kind,
        planId: "pro",
        productId: "proMonthly",
      },
      lineItems: [
        {
          description: "Pro Monthly",
          quantity: 5,
          amountSubtotal: 1200,
          amountTotal: 1200,
          currency: "usd",
          priceId: null,
          productId: "proMonthly",
        },
      ],
    };

    const integration = stripe({
      instance: {
        async createCheckoutSession() {
          return {
            id: "cs_test_123",
            url: "https://example.com/checkout/cs_test_123",
          };
        },
        async createPortalSession() {
          return {
            url: "https://example.com/portal",
          };
        },
        async retrieveCheckoutSession() {
          return retrievedSession;
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
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
            },
          },
          pro: {
            public: true,
            trial: {
              days: 7,
            },
            limits: {
              seats: 5,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 1200,
            interval: "month",
            quantity: 5,
          },
        },
        seats: {
          mode: "subscription_quantity",
        },
        usage: {
          async resolve(_owner, key) {
            return key === "seats" ? 2 : null;
          },
        },
        hooks: {
          async getBillingAccount(nextOwner) {
            return storage.getBillingAccount(nextOwner);
          },
          async getBillingAccountByStripeCustomerId(customerId) {
            return storage.getBillingAccountByStripeCustomerId(customerId);
          },
          async ensureCustomer(nextOwner) {
            return storage.ensureCustomer({ owner: nextOwner });
          },
          async saveBillingSnapshot(snapshot) {
            await storage.saveBillingSnapshot(snapshot);
          },
          async clearBillingSnapshot(nextOwner) {
            await storage.clearBillingSnapshot(nextOwner);
          },
          async onBillingSync(snapshot) {
            hookCalls.push(["onBillingSync", snapshot.status]);
          },
          async onCheckoutCreated(payload) {
            hookCalls.push(["onCheckoutCreated", payload.trialApplied, payload.trialDays]);
          },
          async onCheckoutCompleted(snapshot) {
            hookCalls.push(["onCheckoutCompleted", snapshot.status]);
          },
          async onTrialStarted(snapshot) {
            hookCalls.push(["onTrialStarted", snapshot.status, snapshot.trialDays]);
          },
          async onTrialWillEnd(snapshot) {
            hookCalls.push(["onTrialWillEnd", snapshot.status]);
          },
          async onTrialEnded(snapshot) {
            hookCalls.push(["onTrialEnded", snapshot.status]);
          },
          async onTrialExpired(snapshot) {
            hookCalls.push(["onTrialExpired", snapshot.status]);
          },
          async onPaymentSucceeded(snapshot) {
            hookCalls.push(["onPaymentSucceeded", snapshot.status]);
          },
          async onPaymentFailed(snapshot) {
            hookCalls.push(["onPaymentFailed", snapshot.status]);
          },
        },
      },
    });

    function findRoute(path: string, method: string) {
      const route = integration.routes.find(
        (entry) => entry.path === path && String(entry.method).toUpperCase() === method,
      );

      if (!route) {
        throw new Error(`Route not found: ${method} ${path}`);
      }

      return route;
    }

    async function callJsonRoute(
      path: string,
      method: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) {
      const route = findRoute(path, method);
      const request = new Request(`http://example.com${path}`, {
        method,
        headers: {
          ...(route.rawBody ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : route.rawBody ? String(body) : JSON.stringify(body),
      });
      const response = await route.handler(
        request,
        createContext(request, method, path, integration.instance),
      );

      return {
        status: response.status,
        json: JSON.parse(await response.text()) as Record<string, unknown>,
      };
    }

    const checkout = await callJsonRoute(
      "/billing/checkout",
      "POST",
      { productId: "proMonthly" },
      { "x-farm-integration-client": "1" },
    );
    expect(checkout.status).toBe(200);
    expect(checkout.json.trialApplied).toBe(true);
    expect(checkout.json.trialDays).toBe(7);

    const completed = await callJsonRoute(
      "/billing/webhook",
      "POST",
      JSON.stringify({
        id: "evt_completed",
        type: "checkout.session.completed",
        data: {
          id: "cs_test_123",
        },
      }),
      { "stripe-signature": "test" },
    );
    expect(completed.status).toBe(200);

    const willEnd = await callJsonRoute(
      "/billing/webhook",
      "POST",
      JSON.stringify({
        id: "evt_trial_will_end",
        type: "customer.subscription.trial_will_end",
        data: {
          customer: "cus_test_123",
          trial_end: Math.floor(new Date("2026-04-07T00:00:00.000Z").getTime() / 1000),
        },
      }),
      { "stripe-signature": "test" },
    );
    expect(willEnd.status).toBe(200);

    const paid = await callJsonRoute(
      "/billing/webhook",
      "POST",
      JSON.stringify({
        id: "evt_paid",
        type: "invoice.paid",
        data: {
          customer: "cus_test_123",
        },
      }),
      { "stripe-signature": "test" },
    );
    expect(paid.status).toBe(200);

    snapshotByOwner.set(ownerKey, {
      owner,
      planId: "pro",
      productId: "proMonthly",
      status: "trialing",
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_123",
      currentPeriodEnd: new Date("2026-04-07T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: new Date("2026-04-07T00:00:00.000Z"),
      trialUsedAt: new Date("2026-03-31T00:00:00.000Z"),
      seatQuantity: 5,
      seatAllowanceOverride: null,
      metadata: {},
    });

    retrievedSession = {
      ...retrievedSession,
      subscriptionStatus: "canceled",
      trialEndsAt: null,
    };

    const expired = await callJsonRoute(
      "/billing/webhook",
      "POST",
      JSON.stringify({
        id: "evt_canceled",
        type: "customer.subscription.updated",
        data: {
          customer: "cus_test_123",
          id: "sub_test_123",
          status: "canceled",
          current_period_end: Math.floor(new Date("2026-04-07T00:00:00.000Z").getTime() / 1000),
          cancel_at_period_end: true,
          items: {
            data: [{ quantity: 5 }],
          },
        },
      }),
      { "stripe-signature": "test" },
    );
    expect(expired.status).toBe(200);

    expect(hookCalls).toEqual([
      ["onCheckoutCreated", true, 7],
      ["onBillingSync", "trialing"],
      ["onTrialStarted", "trialing", 7],
      ["onPaymentSucceeded", "trialing"],
      ["onCheckoutCompleted", "trialing"],
      ["onTrialWillEnd", "trialing"],
      ["onBillingSync", "active"],
      ["onTrialEnded", "active"],
      ["onPaymentSucceeded", "active"],
      ["onBillingSync", "canceled"],
      ["onTrialExpired", "canceled"],
    ]);
  });

  it("supports explicit trial behavior in checkout", async () => {
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_checkout",
      email: "owner@example.com",
    };
    let existingSnapshot: StripeBillingSnapshot | null = null;

    const integration = stripe({
      instance: {
        async createCheckoutSession() {
          return {
            id: "cs_checkout",
            url: "https://example.com/checkout/cs_checkout",
          };
        },
        async createPortalSession() {
          return {
            url: "https://example.com/portal",
          };
        },
        async retrieveCheckoutSession() {
          throw new Error("not needed");
        },
        async constructWebhookEvent() {
          throw new Error("not needed");
        },
      },
      billing: {
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
            },
          },
          pro: {
            public: true,
            trial: {
              days: 7,
            },
            limits: {
              seats: 5,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 1200,
            interval: "month",
            quantity: 5,
          },
        },
        hooks: {
          async getBillingAccount() {
            return existingSnapshot;
          },
          async ensureCustomer() {
            return {
              customerId: "cus_checkout",
            };
          },
        },
      },
    });

    const route = integration.routes.find(
      (entry) =>
        entry.path === "/billing/checkout" && String(entry.method).toUpperCase() === "POST",
    );

    if (!route) {
      throw new Error("Checkout route not found.");
    }

    async function callCheckout(body: Record<string, unknown>) {
      const request = new Request("http://example.com/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-farm-integration-client": "1",
        },
        body: JSON.stringify(body),
      });

      const response = await route.handler(
        request,
        createContext(request, "POST", "/billing/checkout", integration.instance),
      );

      return {
        status: response.status,
        json: JSON.parse(await response.text()) as Record<string, unknown>,
      };
    }

    const noTrialCheckout = await callCheckout({
      productId: "proMonthly",
      trialBehavior: "none",
    });
    expect(noTrialCheckout.status).toBe(200);
    expect(noTrialCheckout.json.trialApplied).toBe(false);
    expect(noTrialCheckout.json.trialDays).toBe(null);

    existingSnapshot = {
      owner,
      planId: "free",
      productId: null,
      status: "free",
      stripeCustomerId: "cus_checkout",
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: new Date("2026-03-01T00:00:00.000Z"),
      seatQuantity: null,
      seatAllowanceOverride: null,
      metadata: {},
    };

    const requiredTrialCheckout = await callCheckout({
      productId: "proMonthly",
      trialBehavior: "require",
    });
    expect(requiredTrialCheckout.status).toBe(400);
    expect(requiredTrialCheckout.json.error).toBe(
      "This billing owner is not eligible for a free trial on the selected product.",
    );
  });

  it("attaches hybrid meter prices to bundled monthly checkout sessions", async () => {
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_hybrid_checkout",
      email: "owner@example.com",
    };
    const capturedLineItems: Array<
      Array<{ productId: string; priceId?: string; quantity?: number }>
    > = [];

    const integration = stripe({
      instance: {
        async createCheckoutSession(input) {
          capturedLineItems.push(
            input.lineItems.map((lineItem) => ({
              productId: lineItem.product.id,
              priceId: lineItem.product.priceId,
              quantity: lineItem.quantity,
            })),
          );

          return {
            id: `cs_hybrid_${capturedLineItems.length}`,
            url: `https://example.com/checkout/cs_hybrid_${capturedLineItems.length}`,
          };
        },
        async createPortalSession() {
          throw new Error("not needed");
        },
        async retrieveCheckoutSession() {
          throw new Error("not needed");
        },
        async constructWebhookEvent() {
          throw new Error("not needed");
        },
      },
      billing: {
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
            },
          },
          pro: {
            public: true,
            limits: {
              seats: 5,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 1200,
            interval: "month",
            quantity: 5,
            seatBilling: "included_plus_add_on",
            seatPriceId: "price_pro_extra",
            meterPriceIds: {
              tokensMonthly: "price_pro_tokens_metered",
              apiCalls: "price_pro_api_metered",
            },
          },
        },
        meters: {
          tokensMonthly: {
            aggregation: "sum",
            ingestion: "raw",
            eventName: "ai_tokens",
            unit: "tokens",
          },
          apiCalls: {
            aggregation: "count",
            ingestion: "raw",
            eventName: "api_calls",
            unit: "requests",
          },
        },
        hooks: {
          async ensureCustomer() {
            return {
              customerId: "cus_hybrid_checkout",
            };
          },
          async getBillingAccount() {
            return null;
          },
        },
      },
    });

    const route = integration.routes.find(
      (entry) =>
        entry.path === "/billing/checkout" && String(entry.method).toUpperCase() === "POST",
    );

    if (!route) {
      throw new Error("Checkout route not found.");
    }

    async function callCheckout(body: Record<string, unknown>) {
      const request = new Request("http://example.com/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-farm-integration-client": "1",
        },
        body: JSON.stringify(body),
      });

      const response = await route.handler(
        request,
        createContext(request, "POST", "/billing/checkout", integration.instance),
      );

      return {
        status: response.status,
        json: JSON.parse(await response.text()) as Record<string, unknown>,
      };
    }

    const includedSeatsCheckout = await callCheckout({
      productId: "proMonthly",
    });
    expect(includedSeatsCheckout.status).toBe(200);

    const extraSeatsCheckout = await callCheckout({
      productId: "proMonthly",
      quantity: 8,
    });
    expect(extraSeatsCheckout.status).toBe(200);

    expect(capturedLineItems).toEqual([
      [
        {
          productId: "proMonthly",
          priceId: undefined,
          quantity: 1,
        },
        {
          productId: "proMonthly:meter:tokensMonthly",
          priceId: "price_pro_tokens_metered",
          quantity: undefined,
        },
        {
          productId: "proMonthly:meter:apiCalls",
          priceId: "price_pro_api_metered",
          quantity: undefined,
        },
      ],
      [
        {
          productId: "proMonthly",
          priceId: undefined,
          quantity: 1,
        },
        {
          productId: "proMonthly:seat-addon",
          priceId: "price_pro_extra",
          quantity: 3,
        },
        {
          productId: "proMonthly:meter:tokensMonthly",
          priceId: "price_pro_tokens_metered",
          quantity: undefined,
        },
        {
          productId: "proMonthly:meter:apiCalls",
          priceId: "price_pro_api_metered",
          quantity: undefined,
        },
      ],
    ]);
  });

  it("surfaces hybrid meter usage through the upcoming invoice preview", async () => {
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_hybrid_invoice_preview",
      email: "owner@example.com",
    };
    let storedSnapshot: StripeBillingSnapshot = {
      owner,
      planId: "pro",
      productId: "proMonthly",
      status: "active",
      stripeCustomerId: "cus_hybrid_invoice",
      stripeSubscriptionId: "sub_hybrid_invoice",
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: null,
      seatQuantity: 8,
      seatAllowanceOverride: null,
      metadata: {},
    };
    const capturedCheckoutLineItems: Array<
      Array<{ productId: string; priceId?: string; quantity?: number }>
    > = [];
    let meteredTokens = 0;

    const integration = stripe({
      instance: {
        async createCheckoutSession(input) {
          capturedCheckoutLineItems.push(
            input.lineItems.map((lineItem) => ({
              productId: lineItem.product.id,
              priceId: lineItem.product.priceId,
              quantity: lineItem.quantity,
            })),
          );

          return {
            id: "cs_hybrid_invoice",
            url: "https://example.com/checkout/cs_hybrid_invoice",
          };
        },
        async createPortalSession() {
          throw new Error("not needed");
        },
        async reportUsage(input) {
          if (input.key === "tokensMonthly") {
            meteredTokens += input.quantity;
          }

          return {
            customerId: input.customerId,
            eventName: input.meter.eventName,
            identifier: input.idempotencyKey,
            occurredAt: input.occurredAt,
          };
        },
        async previewUpcomingInvoice() {
          const billableTokenOverage = Math.max(0, meteredTokens - 1_000_000);
          const meteredAmount = Math.round((billableTokenOverage / 1_000_000) * 500);

          return {
            currency: "usd",
            totals: {
              recurring: 4200,
              prorations: 0,
              metered: meteredAmount,
              other: 0,
              total: 4200 + meteredAmount,
            },
            lines: [
              {
                description: "Pro Monthly",
                kind: "base_subscription",
                quantity: 1,
                amount: 1200,
                currency: "usd",
                periodStart: new Date("2026-05-01T00:00:00.000Z").toISOString(),
                periodEnd: new Date("2026-06-01T00:00:00.000Z").toISOString(),
                priceId: "price_pro_base",
                stripeProductId: "prod_pro_base",
                meterKey: null,
              },
              {
                description: "Pro Extra Seat",
                kind: "seat_add_on",
                quantity: 3,
                amount: 3000,
                currency: "usd",
                periodStart: new Date("2026-05-01T00:00:00.000Z").toISOString(),
                periodEnd: new Date("2026-06-01T00:00:00.000Z").toISOString(),
                priceId: "price_pro_extra",
                stripeProductId: "prod_pro_extra",
                meterKey: null,
              },
              {
                description: "Pro Token Overage",
                kind: "metered",
                quantity: billableTokenOverage,
                amount: meteredAmount,
                currency: "usd",
                periodStart: new Date("2026-04-01T00:00:00.000Z").toISOString(),
                periodEnd: new Date("2026-05-01T00:00:00.000Z").toISOString(),
                priceId: "price_pro_tokens_metered",
                stripeProductId: "prod_pro_tokens",
                meterKey: "tokensMonthly",
              },
            ],
          };
        },
        async retrieveCheckoutSession() {
          throw new Error("not needed");
        },
        async constructWebhookEvent() {
          throw new Error("not needed");
        },
      },
      billing: {
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
              tokensMonthly: 100_000,
            },
          },
          pro: {
            public: true,
            limits: {
              seats: 5,
              tokensMonthly: 1_000_000,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 1200,
            interval: "month",
            quantity: 5,
            seatBilling: "included_plus_add_on",
            seatPriceId: "price_pro_extra",
            meterPriceIds: {
              tokensMonthly: "price_pro_tokens_metered",
              apiCalls: "price_pro_api_metered",
            },
          },
        },
        seats: {
          mode: "subscription_quantity",
        },
        meters: {
          tokensMonthly: {
            aggregation: "sum",
            ingestion: "raw",
            eventName: "ai_tokens",
            unit: "tokens",
            guard: {
              softLimit: "plan_limit",
              hardOverageByPlan: {
                pro: 2_000_000,
              },
            },
          },
          apiCalls: {
            aggregation: "count",
            ingestion: "raw",
            eventName: "api_calls",
            unit: "requests",
          },
        },
        hooks: {
          async ensureCustomer() {
            return {
              customerId: "cus_hybrid_invoice",
            };
          },
          async getBillingAccount() {
            return storedSnapshot;
          },
          async saveBillingSnapshot(snapshot) {
            storedSnapshot = snapshot;
          },
        },
      },
    });

    function findRoute(path: string, method: string) {
      const route = integration.routes.find(
        (entry) => entry.path === path && String(entry.method).toUpperCase() === method,
      );

      if (!route) {
        throw new Error(`Route not found: ${method} ${path}`);
      }

      return route;
    }

    async function callRoute(
      path: string,
      method: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) {
      const route = findRoute(path, method);
      const request = new Request(`http://example.com${path}`, {
        method,
        headers: {
          ...(route.rawBody ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : route.rawBody ? String(body) : JSON.stringify(body),
      });
      const response = await route.handler(
        request,
        createContext(request, method, path, integration.instance),
      );

      return {
        status: response.status,
        json: JSON.parse(await response.text()) as Record<string, unknown>,
      };
    }

    const checkout = await callRoute(
      "/billing/checkout",
      "POST",
      {
        productId: "proMonthly",
        quantity: 8,
      },
      {
        "x-farm-integration-client": "1",
      },
    );
    expect(checkout.status).toBe(200);
    expect(capturedCheckoutLineItems).toEqual([
      [
        {
          productId: "proMonthly",
          priceId: undefined,
          quantity: 1,
        },
        {
          productId: "proMonthly:seat-addon",
          priceId: "price_pro_extra",
          quantity: 3,
        },
        {
          productId: "proMonthly:meter:tokensMonthly",
          priceId: "price_pro_tokens_metered",
          quantity: undefined,
        },
        {
          productId: "proMonthly:meter:apiCalls",
          priceId: "price_pro_api_metered",
          quantity: undefined,
        },
      ],
    ]);

    const reported = await callRoute(
      "/billing/report-usage",
      "POST",
      {
        key: "tokensMonthly",
        quantity: 1_250_000,
        idempotencyKey: "meter_evt_1",
      },
      {
        "x-farm-integration-client": "1",
      },
    );
    expect(reported.status).toBe(200);
    expect(reported.json.stripeEventName).toBe("ai_tokens");

    const upcomingInvoice = await callRoute("/billing/upcoming-invoice", "GET");
    expect(upcomingInvoice.status).toBe(200);
    expect(upcomingInvoice.json.monthlyMeteringActive).toBe(true);
    expect(upcomingInvoice.json.productId).toBe("proMonthly");
    expect(upcomingInvoice.json.totals).toEqual({
      recurring: 4200,
      prorations: 0,
      metered: 125,
      other: 0,
      total: 4325,
    });
    expect(upcomingInvoice.json.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: "Pro Token Overage",
          kind: "metered",
          quantity: 250000,
          amount: 125,
          meterKey: "tokensMonthly",
        }),
      ]),
    );
  });

  it("updates bundled seat subscriptions through the Stripe-backed change route", async () => {
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_change",
      email: "owner@example.com",
    };
    let storedSnapshot: StripeBillingSnapshot = {
      owner,
      planId: "pro",
      productId: "proMonthly",
      status: "active",
      stripeCustomerId: "cus_change",
      stripeSubscriptionId: "sub_change",
      currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: null,
      seatQuantity: 5,
      seatAllowanceOverride: null,
      metadata: {},
    };
    let receivedLineItems: Array<{ productId: string; priceId?: string; quantity: number }> | null =
      null;

    const integration = stripe({
      instance: {
        async createCheckoutSession() {
          throw new Error("not needed");
        },
        async createPortalSession() {
          throw new Error("not needed");
        },
        async updateSubscription(input) {
          receivedLineItems = input.lineItems.map((lineItem) => ({
            productId: lineItem.product.id,
            priceId: lineItem.product.priceId,
            quantity: lineItem.quantity,
          }));

          return {
            customerId: "cus_change",
            subscriptionId: "sub_change",
            subscriptionStatus: "active",
            currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z").toISOString(),
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            lineItems: [
              {
                description: "Pro Monthly",
                quantity: 1,
                amountSubtotal: null,
                amountTotal: null,
                currency: "usd",
                priceId: "price_pro_base",
                productId: "proMonthly",
              },
              {
                description: "Pro Extra Seat",
                quantity: 3,
                amountSubtotal: null,
                amountTotal: null,
                currency: "usd",
                priceId: "price_pro_extra",
                productId: null,
              },
            ],
          };
        },
        async retrieveCheckoutSession() {
          throw new Error("not needed");
        },
        async constructWebhookEvent() {
          throw new Error("not needed");
        },
      },
      billing: {
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
            },
          },
          pro: {
            public: true,
            limits: {
              seats: 5,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 6000,
            interval: "month",
            quantity: 5,
            seatBilling: "included_plus_add_on",
            seatPriceId: "price_pro_extra",
          },
        },
        seats: {
          mode: "subscription_quantity",
        },
        usage: {
          async resolve(_owner, key) {
            return key === "seats" ? 5 : null;
          },
        },
        hooks: {
          async getBillingAccount() {
            return storedSnapshot;
          },
          async saveBillingSnapshot(snapshot) {
            storedSnapshot = snapshot;
          },
        },
      },
    });

    const route = integration.routes.find(
      (entry) => entry.path === "/billing/upgrade" && String(entry.method).toUpperCase() === "POST",
    );

    if (!route) {
      throw new Error("Change route not found.");
    }

    const request = new Request("http://example.com/billing/upgrade", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-farm-integration-client": "1",
      },
      body: JSON.stringify({
        quantity: 8,
      }),
    });

    const response = await route.handler(
      request,
      createContext(request, "POST", "/billing/upgrade", integration.instance),
    );
    const payload = JSON.parse(await response.text()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(receivedLineItems).toEqual([
      {
        productId: "proMonthly",
        priceId: undefined,
        quantity: 1,
      },
      {
        productId: "proMonthly:seat-addon",
        priceId: "price_pro_extra",
        quantity: 3,
      },
    ]);
    expect(payload.seatQuantity).toBe(8);
    expect(storedSnapshot.seatQuantity).toBe(8);
  });

  it("fetches checkout session data directly from Stripe on /billing/session and persists it", async () => {
    const owner: StripeBillingOwner = {
      kind: "organization",
      id: "org_session_lookup",
      email: "owner@example.com",
    };
    let retrievedSessionId: string | null = null;
    let storedSnapshot: StripeBillingSnapshot | null = null;
    const hookCalls: Array<{ status: string; sessionId: string }> = [];

    const integration = stripe({
      instance: {
        async createCheckoutSession() {
          throw new Error("not needed");
        },
        async createPortalSession() {
          throw new Error("not needed");
        },
        async retrieveCheckoutSession(sessionId) {
          retrievedSessionId = sessionId;

          return {
            id: sessionId,
            status: "complete",
            paymentStatus: "paid",
            mode: "subscription",
            customerId: "cus_session_lookup",
            customerEmail: "owner@example.com",
            subscriptionId: "sub_session_lookup",
            subscriptionStatus: "active",
            currentPeriodEnd: new Date("2026-04-30T00:00:00.000Z").toISOString(),
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            amountSubtotal: 6000,
            amountTotal: 6000,
            currency: "usd",
            metadata: {
              ownerId: owner.id,
              ownerKind: owner.kind,
              planId: "pro",
              productId: "proMonthly",
            },
            lineItems: [
              {
                description: "Pro Monthly",
                quantity: 1,
                amountSubtotal: 6000,
                amountTotal: 6000,
                currency: "usd",
                priceId: "price_pro_base",
                productId: "proMonthly",
              },
            ],
          };
        },
        async constructWebhookEvent() {
          throw new Error("not needed");
        },
      },
      billing: {
        async resolveOwner() {
          return owner;
        },
        plans: {
          free: {
            public: true,
            limits: {
              seats: 1,
            },
          },
          pro: {
            public: true,
            limits: {
              seats: 5,
            },
          },
        },
        products: {
          proMonthly: {
            public: true,
            kind: "subscription",
            planId: "pro",
            name: "Pro Monthly",
            currency: "usd",
            unitAmount: 6000,
            interval: "month",
            quantity: 5,
            seatBilling: "included_plus_add_on",
          },
        },
        seats: {
          mode: "subscription_quantity",
        },
        hooks: {
          async saveBillingSnapshot(snapshot) {
            storedSnapshot = snapshot;
          },
          async onCheckoutCompleted(snapshot) {
            hookCalls.push({
              status: snapshot.status,
              sessionId: snapshot.sessionId,
            });
          },
        },
      },
    });

    const route = integration.routes.find(
      (entry) => entry.path === "/billing/session" && String(entry.method).toUpperCase() === "GET",
    );

    if (!route) {
      throw new Error("Session route not found.");
    }

    const request = new Request("http://example.com/billing/session?sessionId=cs_session_lookup", {
      method: "GET",
    });

    const response = await route.handler(
      request,
      createContext(request, "GET", "/billing/session", integration.instance),
    );
    const payload = JSON.parse(await response.text()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(retrievedSessionId).toBe("cs_session_lookup");
    expect(payload.id).toBe("cs_session_lookup");
    expect(payload.subscriptionStatus).toBe("active");
    expect(storedSnapshot?.planId).toBe("pro");
    expect(storedSnapshot?.productId).toBe("proMonthly");
    expect(storedSnapshot?.status).toBe("active");
    expect(storedSnapshot?.seatQuantity).toBe(5);
    expect(hookCalls).toEqual([
      {
        status: "active",
        sessionId: "cs_session_lookup",
      },
    ]);
  });
});
