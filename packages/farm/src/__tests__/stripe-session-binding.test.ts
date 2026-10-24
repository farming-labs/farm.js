// @vitest-environment node

import { describe, expect, it } from "vitest";
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

const attacker: StripeBillingOwner = { kind: "user", id: "user_attacker" };

function snapshotFor(owner: StripeBillingOwner, customerId: string | null): StripeBillingSnapshot {
  return {
    owner,
    planId: "free",
    productId: null,
    status: "free",
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialUsedAt: null,
    seatQuantity: null,
    seatAllowanceOverride: null,
    metadata: {},
  };
}

/** A paid subscription checkout; `metadata` decides whether Farm stamped an owner on it. */
function paidSession(customerId: string | null, metadata: Record<string, string>) {
  return {
    id: "cs_paid",
    status: "complete",
    paymentStatus: "paid",
    mode: "subscription" as const,
    customerId,
    customerEmail: "victim@example.com",
    subscriptionId: "sub_victim",
    subscriptionStatus: "active",
    currentPeriodEnd: "2026-04-30T00:00:00.000Z",
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    amountSubtotal: 2000,
    amountTotal: 2000,
    currency: "usd",
    metadata: { productId: "pro", ...metadata },
    lineItems: [],
  };
}

function createBilling(
  session: ReturnType<typeof paidSession>,
  stored: StripeBillingSnapshot | null,
) {
  const rows = new Map<string, StripeBillingSnapshot>();
  if (stored) rows.set(stored.owner.id, stored);
  const integration = stripe({
    instance: {
      async createCheckoutSession() {
        throw new Error("not needed");
      },
      async createPortalSession() {
        throw new Error("not needed");
      },
      async retrieveCheckoutSession() {
        return session;
      },
      async constructWebhookEvent() {
        throw new Error("not needed");
      },
    },
    billing: {
      resolveOwner: () => attacker,
      plans: { free: {}, pro: { features: { pro: true } } },
      products: { pro: { kind: "subscription", planId: "pro", priceId: "price_pro" } },
      hooks: {
        getBillingAccount: async (owner) => rows.get(owner.id) ?? null,
        getBillingAccountByStripeCustomerId: async (customerId) =>
          [...rows.values()].find((row) => row.stripeCustomerId === customerId) ?? null,
        async saveBillingSnapshot(next) {
          rows.set(next.owner.id, next);
        },
        async claimCheckoutSession() {
          return true;
        },
      },
    },
  });
  return {
    attackerRow: () => rows.get(attacker.id) ?? null,
    async lookup() {
      const route = integration.routes.find((entry) => entry.path === "/billing/session")!;
      const request = new Request("http://example.com/billing/session?sessionId=cs_paid");
      const response = await route.handler(
        request,
        createContext(request, "/billing/session", integration.instance),
      );
      return (await response.json()) as Record<string, unknown>;
    },
  };
}

describe("stripe checkout session binding", () => {
  it("does not bind someone else's unowned session to the caller", async () => {
    // A Payment Link session: no Farm owner metadata, and its customer has no stored account.
    const billing = createBilling(paidSession("cus_victim", {}), snapshotFor(attacker, null));

    const body = await billing.lookup();

    expect(billing.attackerRow()).toMatchObject({
      stripeCustomerId: null,
      planId: "free",
      stripeSubscriptionId: null,
    });
    expect(body.customerEmail).toBeNull();
  });

  it("does not grant a customerless unowned session's plan", async () => {
    const billing = createBilling(paidSession(null, {}), snapshotFor(attacker, null));
    await billing.lookup();
    expect(billing.attackerRow()).toMatchObject({ planId: "free", status: "free" });
  });

  it("still binds an unowned session whose customer is already the caller's", async () => {
    const billing = createBilling(
      paidSession("cus_attacker", {}),
      snapshotFor(attacker, "cus_attacker"),
    );
    await billing.lookup();
    expect(billing.attackerRow()).toMatchObject({
      status: "active",
      stripeSubscriptionId: "sub_victim",
    });
  });

  it("still binds a session Farm created for the caller", async () => {
    const billing = createBilling(
      paidSession("cus_new", { ownerId: attacker.id, ownerKind: attacker.kind, planId: "pro" }),
      snapshotFor(attacker, null),
    );
    const body = await billing.lookup();
    expect(billing.attackerRow()).toMatchObject({
      planId: "pro",
      stripeCustomerId: "cus_new",
      stripeSubscriptionId: "sub_victim",
    });
    expect(body.customerEmail).toBe("victim@example.com");
  });
});
