// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

function createContext(request: Request, method: string, path: string, instance: unknown) {
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

function snapshotFor(owner: StripeBillingOwner, customerId: string): StripeBillingSnapshot {
  return {
    owner,
    planId: "pro",
    productId: "proMonthly",
    status: "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId: `sub_${owner.id}`,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialUsedAt: null,
    seatQuantity: 1,
    seatAllowanceOverride: null,
    metadata: {},
  } as unknown as StripeBillingSnapshot;
}

function createIntegration() {
  const owners: Record<string, StripeBillingOwner> = {
    a: { kind: "user", id: "user_a" },
    b: { kind: "user", id: "user_b" },
  };
  const snapshots = new Map<string, StripeBillingSnapshot>([
    ["user_a", snapshotFor(owners.a!, "cus_a")],
    ["user_b", snapshotFor(owners.b!, "cus_b")],
  ]);
  const reportedIdentifiers: string[] = [];
  const checkouts: string[] = [];
  let signedIn = owners.a!;

  const integration = stripe({
    instance: {
      async createCheckoutSession(input: { lineItems: Array<{ product: { id: string } }> }) {
        checkouts.push(input.lineItems[0]!.product.id);
        return { id: "cs_new", url: "https://example.com/checkout/cs_new" };
      },
      async createPortalSession() {
        throw new Error("not needed");
      },
      async retrieveCheckoutSession() {
        throw new Error("not needed");
      },
      async constructWebhookEvent(input: { payload: string }) {
        return JSON.parse(input.payload);
      },
      async reportUsage(input) {
        reportedIdentifiers.push(input.idempotencyKey);
        return {
          customerId: input.customerId,
          eventName: input.meter.eventName,
          identifier: input.idempotencyKey,
          occurredAt: input.occurredAt,
        };
      },
    },
    billing: {
      resolveOwner: () => signedIn,
      plans: { free: { features: { pro: false } }, pro: { features: { pro: true } } },
      products: {
        proMonthly: { kind: "subscription", planId: "pro", priceId: "price_pro" },
        legacyPro: { public: false, kind: "subscription", planId: "pro", priceId: "price_old" },
        partnerPro: {
          public: false,
          purchasable: true,
          kind: "subscription",
          planId: "pro",
          priceId: "price_partner",
        },
      },
      meters: { api: { aggregation: "sum", ingestion: "raw", eventName: "api_calls" } },
      hooks: {
        getBillingAccount: async (owner: StripeBillingOwner) => snapshots.get(owner.id) ?? null,
        async getBillingAccountByStripeCustomerId(customerId: string) {
          for (const snapshot of snapshots.values()) {
            if (snapshot.stripeCustomerId === customerId) return snapshot;
          }
          return null;
        },
        ensureCustomer: async () => ({ customerId: "cus_a" }),
        async saveBillingSnapshot(snapshot: StripeBillingSnapshot) {
          snapshots.set(snapshot.owner.id, snapshot);
        },
      },
    },
  });

  async function call(path: string, method: string, body?: unknown, headers = {}) {
    const route = integration.routes.find(
      (entry) => entry.path === path && String(entry.method).toUpperCase() === method,
    );
    if (!route) throw new Error(`Route not found: ${method} ${path}`);
    const request = new Request(`http://example.com${path}`, {
      method,
      headers: { "content-type": "application/json", "x-farm-integration-client": "1", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await route.handler(
      request,
      createContext(request, method, path, integration.instance),
    );
    return { status: response.status, json: JSON.parse(await response.text()) };
  }

  return {
    call,
    snapshots,
    reportedIdentifiers,
    checkouts,
    signIn(key: "a" | "b") {
      signedIn = owners[key]!;
    },
  };
}

describe("stripe billing scoping", () => {
  it("keeps a usage idempotency key to the customer reporting it", async () => {
    const { call, reportedIdentifiers, signIn } = createIntegration();
    // Stripe dedupes meter event identifiers account-wide, so B reusing A's
    // key must not make Stripe drop either customer's usage.
    for (const owner of ["a", "b"] as const) {
      signIn(owner);
      const result = await call("/billing/report-usage", "POST", {
        key: "api",
        quantity: 1,
        idempotencyKey: "evt_1",
      });
      expect(result.status).toBe(200);
      expect(result.json.stripeEventIdentifier).toBe(`cus_${owner}:evt_1`);
    }
    expect(reportedIdentifiers).toEqual(["cus_a:evt_1", "cus_b:evt_1"]);
  });

  it("does not sell a hidden product unless it is marked purchasable", async () => {
    const { call, checkouts } = createIntegration();

    const hidden = await call("/billing/checkout", "POST", { productId: "legacyPro" });
    expect(hidden.status).toBeGreaterThanOrEqual(400);
    expect(checkouts).toEqual([]);

    const partner = await call("/billing/checkout", "POST", { productId: "partnerPro" });
    expect(partner.status).toBe(200);
    const listed = await call("/billing/checkout", "POST", { productId: "proMonthly" });
    expect(listed.status).toBe(200);
    expect(checkouts).toEqual(["partnerPro", "proMonthly"]);
  });

  it.each([
    ["paused", "incomplete"],
    ["incomplete_expired", "canceled"],
  ])("takes the plan away when a subscription becomes %s", async (stripeStatus, status) => {
    const { call, snapshots } = createIntegration();
    const result = await call(
      "/billing/webhook",
      "POST",
      {
        id: `evt_${stripeStatus}`,
        type: "customer.subscription.updated",
        data: {
          id: "sub_user_a",
          customer: "cus_a",
          status: stripeStatus,
          items: { data: [{ quantity: 1, price: { id: "price_pro" } }] },
        },
      },
      { "stripe-signature": "test" },
    );
    expect(result.status).toBe(200);
    expect(snapshots.get("user_a")!.status).toBe(status);

    const features = await call("/billing/features", "GET");
    expect(features.json).toMatchObject({ planId: "free", features: { pro: false } });
  });
});
