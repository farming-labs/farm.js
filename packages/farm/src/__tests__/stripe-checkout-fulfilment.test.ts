// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

/**
 * Checkout stamps the plan into the session's metadata as soon as checkout
 * starts, and the success page looks the session up by id. Syncing a session
 * that was never paid granted the plan, so only a complete session whose
 * payment cleared (or needed none) may reach the billing snapshot.
 */

const owner: StripeBillingOwner = { kind: "user", id: "user_a", email: "a@example.com" };

type Session = {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  mode: "payment" | "subscription";
  customerId: string;
  customerEmail: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  amountSubtotal: number;
  amountTotal: number;
  currency: string;
  metadata: Record<string, string>;
  lineItems: never[];
};

function session(overrides: Partial<Session>): Session {
  return {
    id: "cs_test_checkout",
    status: "complete",
    paymentStatus: "paid",
    mode: "subscription",
    customerId: "cus_a",
    customerEmail: owner.email ?? null,
    subscriptionId: "sub_a",
    subscriptionStatus: "active",
    currentPeriodEnd: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    amountSubtotal: 1000,
    amountTotal: 1000,
    currency: "usd",
    metadata: { planId: "pro", productId: "proMonthly", ownerId: owner.id, ownerKind: owner.kind },
    lineItems: [],
    ...overrides,
  };
}

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

function createContext(request: Request, method: string, path: string, instance: unknown) {
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
    integration: { category: "payment", slot: "payment", type: "stripe", instance },
    route: { kind: "route", path, methods: [method] },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  } as FarmIntegrationHandlerContext;
}

function createIntegration(initial: Session) {
  let current = initial;
  const saved: StripeBillingSnapshot[] = [];
  const completed: string[] = [];

  const integration = stripe({
    instance: {
      async createCheckoutSession() {
        return { id: current.id, url: `https://example.com/checkout/${current.id}` };
      },
      async createPortalSession() {
        return { url: "https://example.com/portal" };
      },
      async retrieveCheckoutSession() {
        return current;
      },
      async constructWebhookEvent(input: { payload: string }) {
        return JSON.parse(input.payload);
      },
    },
    webhooks: { path: "/billing/webhook", secret: "whsec_fulfilment" },
    billing: {
      async resolveOwner() {
        return owner;
      },
      plans: { free: { public: true }, pro: { public: true } },
      products: {
        proMonthly: {
          public: true,
          kind: "subscription",
          planId: "pro",
          name: "Pro Monthly",
          currency: "usd",
          unitAmount: 1000,
          interval: "month",
        },
      },
      hooks: {
        async getBillingAccount() {
          return saved.at(-1) ?? null;
        },
        async getBillingAccountByStripeCustomerId() {
          return saved.at(-1) ?? null;
        },
        async ensureCustomer() {
          return { customerId: "cus_a" };
        },
        async saveBillingSnapshot(snapshot: StripeBillingSnapshot) {
          saved.push(snapshot);
        },
        async clearBillingSnapshot() {},
        async onCheckoutCompleted(snapshot: StripeBillingSnapshot) {
          completed.push(snapshot.planId);
        },
      },
    },
  });

  async function call(pathWithQuery: string, method: string, body?: string) {
    const path = pathWithQuery.split("?")[0]!;
    const route = integration.routes.find(
      (entry: { path: string; method: unknown }) =>
        entry.path === path && String(entry.method).toUpperCase() === method,
    );
    if (!route) throw new Error(`Route not found: ${method} ${path}`);
    const request = new Request(`http://example.com${pathWithQuery}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-farm-integration-client": "1",
        "stripe-signature": "test",
      },
      body,
    });
    const response = await route.handler(
      request,
      createContext(request, method, path, integration.instance),
    );
    return response.status;
  }

  return {
    call,
    saved,
    completed,
    setSession(next: Session) {
      current = next;
    },
  };
}

function webhook(type: string, sessionId = "cs_test_checkout") {
  return JSON.stringify({ id: `evt_${type}`, type, data: { id: sessionId } });
}

describe("stripe checkout fulfilment", () => {
  it("does not grant a plan for a checkout that was started but never paid", async () => {
    // Stripe's shape for an open subscription checkout: no subscription yet.
    const billing = createIntegration(
      session({
        status: "open",
        paymentStatus: "unpaid",
        subscriptionId: null,
        subscriptionStatus: null,
      }),
    );

    expect(await billing.call("/billing/session?sessionId=cs_test_checkout", "GET")).toBe(200);
    expect(billing.saved).toEqual([]);
    expect(billing.completed).toEqual([]);
  });

  it("does not grant a plan for an expired checkout", async () => {
    const billing = createIntegration(
      session({ status: "expired", paymentStatus: "unpaid", subscriptionId: null }),
    );

    await billing.call("/billing/session?sessionId=cs_test_checkout", "GET");
    expect(billing.saved).toEqual([]);
  });

  it("waits for a delayed payment to clear, then fulfils on async_payment_succeeded", async () => {
    // A bank debit completes the session before the money arrives.
    const billing = createIntegration(
      session({ mode: "payment", paymentStatus: "unpaid", subscriptionId: null }),
    );

    expect(
      await billing.call("/billing/webhook", "POST", webhook("checkout.session.completed")),
    ).toBe(200);
    expect(billing.saved).toEqual([]);

    billing.setSession(session({ mode: "payment", paymentStatus: "paid", subscriptionId: null }));
    expect(
      await billing.call(
        "/billing/webhook",
        "POST",
        webhook("checkout.session.async_payment_succeeded"),
      ),
    ).toBe(200);
    expect(billing.saved.map((snapshot) => snapshot.planId)).toEqual(["pro"]);
    expect(billing.completed).toEqual(["pro"]);
  });

  it("fulfils a completed, paid checkout from the success page", async () => {
    const billing = createIntegration(session({}));

    await billing.call("/billing/session?sessionId=cs_test_checkout", "GET");
    expect(billing.saved.map((snapshot) => [snapshot.planId, snapshot.status])).toEqual([
      ["pro", "active"],
    ]);
    expect(billing.completed).toEqual(["pro"]);
  });

  it("fulfils a trial checkout that needed no payment", async () => {
    const billing = createIntegration(
      session({ paymentStatus: "no_payment_required", subscriptionStatus: "trialing" }),
    );

    await billing.call("/billing/session?sessionId=cs_test_checkout", "GET");
    expect(billing.saved.map((snapshot) => snapshot.status)).toEqual(["trialing"]);
  });
});
