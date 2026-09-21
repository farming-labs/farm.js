// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

const ownerA: StripeBillingOwner = { kind: "user", id: "user_a", email: "a@example.com" };
const ownerB: StripeBillingOwner = { kind: "user", id: "user_b", email: "b@example.com" };

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
    integration: { category: "payment", slot: "payment", type: "stripe", instance },
    route: { kind: "route", path, methods: [method] },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  } as FarmIntegrationHandlerContext;
}

function sessionFor(owner: StripeBillingOwner | null, customerId: string, id = "cs_test_session") {
  return {
    id,
    status: "complete",
    paymentStatus: "paid",
    mode: "subscription" as const,
    customerId,
    customerEmail: owner?.email ?? null,
    subscriptionId: "sub_test",
    subscriptionStatus: "active",
    currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z").toISOString(),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    amountSubtotal: 1000,
    amountTotal: 1000,
    currency: "usd",
    metadata: {
      planId: "pro",
      productId: "proMonthly",
      ...(owner ? { ownerId: owner.id, ownerKind: owner.kind } : {}),
    },
    lineItems: [],
  };
}

/**
 * Build the integration with a controllable signed-in owner and a store that
 * already holds a snapshot for each seeded owner.
 */
function createIntegration(options: {
  signedInOwner: StripeBillingOwner | null;
  seeded?: Array<{ owner: StripeBillingOwner; customerId: string }>;
  session?: ReturnType<typeof sessionFor>;
}) {
  const snapshots = new Map<string, StripeBillingSnapshot>();
  const saved: StripeBillingSnapshot[] = [];
  const checkoutCompleted: string[] = [];

  for (const seed of options.seeded ?? []) {
    snapshots.set(`${seed.owner.kind}:${seed.owner.id}`, {
      owner: seed.owner,
      planId: "pro",
      productId: "proMonthly",
      status: "active",
      stripeCustomerId: seed.customerId,
      stripeSubscriptionId: "sub_seed",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      trialUsedAt: null,
      seatMode: "subscription_quantity",
      seatQuantity: 1,
      seatAllowanceOverride: null,
      metadata: {},
    } as unknown as StripeBillingSnapshot);
  }

  const integration = stripe({
    instance: {
      async createCheckoutSession() {
        return { id: "cs_new", url: "https://example.com/checkout/cs_new" };
      },
      async createPortalSession(args: { customerId: string }) {
        return { url: `https://example.com/portal/${args.customerId}` };
      },
      async retrieveCheckoutSession() {
        return options.session ?? sessionFor(ownerA, "cus_a");
      },
      async constructWebhookEvent(input: { payload: string }) {
        return JSON.parse(input.payload);
      },
    },
    billing: {
      async resolveOwner() {
        return options.signedInOwner;
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
        async getBillingAccount(owner: StripeBillingOwner) {
          return snapshots.get(`${owner.kind}:${owner.id}`) ?? null;
        },
        async getBillingAccountByStripeCustomerId(customerId: string) {
          for (const snapshot of snapshots.values()) {
            if (snapshot.stripeCustomerId === customerId) return snapshot;
          }
          return null;
        },
        async ensureCustomer() {
          return { customerId: "cus_ensured" };
        },
        async saveBillingSnapshot(snapshot: StripeBillingSnapshot) {
          saved.push(snapshot);
          snapshots.set(`${snapshot.owner.kind}:${snapshot.owner.id}`, snapshot);
        },
        async clearBillingSnapshot() {},
        async onCheckoutCompleted(snapshot: StripeBillingSnapshot) {
          checkoutCompleted.push(`${snapshot.owner.kind}:${snapshot.owner.id}`);
        },
      },
    },
  });

  async function call(pathWithQuery: string, method: string, body?: unknown) {
    const path = pathWithQuery.split("?")[0]!;
    const route = integration.routes.find(
      (entry: { path: string; method: unknown }) =>
        entry.path === path && String(entry.method).toUpperCase() === method,
    );
    if (!route) throw new Error(`Route not found: ${method} ${path}`);

    const request = new Request(`http://example.com${pathWithQuery}`, {
      method,
      headers: { "content-type": "application/json", "x-farm-integration-client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
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

  return { call, saved, checkoutCompleted };
}

describe("stripe billing portal authorization", () => {
  it("refuses an unauthenticated caller that supplies a customerId", async () => {
    const { call } = createIntegration({ signedInOwner: null });

    const result = await call("/billing/portal", "POST", { customerId: "cus_victim" });

    expect(result.status).toBe(401);
    expect(JSON.stringify(result.json)).not.toContain("cus_victim");
  });

  it("refuses a customerId that does not belong to the signed-in owner", async () => {
    const { call } = createIntegration({
      signedInOwner: ownerB,
      seeded: [
        { owner: ownerA, customerId: "cus_a" },
        { owner: ownerB, customerId: "cus_b" },
      ],
    });

    const result = await call("/billing/portal", "POST", { customerId: "cus_a" });

    expect(result.status).toBe(403);
    expect(JSON.stringify(result.json)).not.toContain("cus_a");
  });

  it("refuses a sessionId belonging to another owner", async () => {
    const { call } = createIntegration({
      signedInOwner: ownerB,
      seeded: [{ owner: ownerB, customerId: "cus_b" }],
      session: sessionFor(ownerA, "cus_a"),
    });

    const result = await call("/billing/portal", "POST", { sessionId: "cs_test_session" });

    expect(result.status).toBe(403);
  });

  it("opens the portal for the signed-in owner's own customer", async () => {
    const { call } = createIntegration({
      signedInOwner: ownerA,
      seeded: [{ owner: ownerA, customerId: "cus_a" }],
    });

    const result = await call("/billing/portal", "POST", {});

    expect(result.status).toBe(200);
    expect(result.json.redirectTo).toBe("https://example.com/portal/cus_a");
  });

  it("accepts the owner's own session before its snapshot is persisted", async () => {
    // Just-completed checkout: no stored snapshot yet, but the session carries
    // the owner stamp from checkout.
    const { call } = createIntegration({
      signedInOwner: ownerA,
      session: sessionFor(ownerA, "cus_a"),
    });

    const result = await call("/billing/portal", "POST", { sessionId: "cs_test_session" });

    expect(result.status).toBe(200);
    expect(result.json.redirectTo).toBe("https://example.com/portal/cus_a");
  });
});

describe("stripe billing session lookup authorization", () => {
  it("does not bind another owner's checkout to the signed-in caller", async () => {
    const { call, saved, checkoutCompleted } = createIntegration({
      signedInOwner: ownerB,
      seeded: [{ owner: ownerA, customerId: "cus_a" }],
      session: sessionFor(ownerA, "cus_a"),
    });

    await call("/billing/session?sessionId=cs_test_session", "GET");

    expect(saved.map((snapshot) => snapshot.owner.id)).not.toContain(ownerB.id);
    expect(checkoutCompleted).not.toContain(`${ownerB.kind}:${ownerB.id}`);
  });

  it("still persists the caller's own checkout", async () => {
    const { call, saved } = createIntegration({
      signedInOwner: ownerA,
      session: sessionFor(ownerA, "cus_a"),
    });

    await call("/billing/session?sessionId=cs_test_session", "GET");

    expect(saved.map((snapshot) => snapshot.owner.id)).toContain(ownerA.id);
  });
});
