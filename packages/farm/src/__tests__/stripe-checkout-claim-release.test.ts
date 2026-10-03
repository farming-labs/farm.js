// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";
import type {
  StripeBillingOwner,
  StripeBillingSnapshot,
} from "../../../farm-integrations/src/stripe/storage";

/**
 * A checkout session is claimed before its snapshot is saved and its hooks run,
 * so a duplicate delivery skips them. When the save or a hook fails, the claim
 * has to be released: Stripe retries the webhook, and a retry that finds the
 * session already claimed does nothing, leaving a paying customer without the
 * plan they bought.
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

function createIntegration(initial: Session, options: { release?: boolean } = {}) {
  const current = initial;
  const saved: StripeBillingSnapshot[] = [];
  const completed: string[] = [];
  const claims = new Set<string>();
  let failNextSave = false;

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
          if (failNextSave) {
            failNextSave = false;
            throw new Error("database unavailable");
          }
          saved.push(snapshot);
        },
        async claimCheckoutSession(claim: { sessionId: string }) {
          if (claims.has(claim.sessionId)) return false;
          claims.add(claim.sessionId);
          return true;
        },
        ...(options.release === false
          ? {}
          : {
              async releaseCheckoutSession(sessionId: string) {
                claims.delete(sessionId);
              },
            }),
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
    claims,
    failNextSave() {
      failNextSave = true;
    },
  };
}

function webhook(type: string, sessionId = "cs_test_checkout") {
  return JSON.stringify({ id: `evt_${type}`, type, data: { id: sessionId } });
}

describe("stripe checkout claim", () => {
  it("lets Stripe's retry fulfil a checkout whose first save failed", async () => {
    const billing = createIntegration(session({}));
    billing.failNextSave();

    // The failure reaches Stripe as a non-2xx, so Stripe redelivers.
    expect(
      await billing.call("/billing/webhook", "POST", webhook("checkout.session.completed")),
    ).not.toBe(200);
    expect(billing.saved).toEqual([]);
    expect(billing.claims.has("cs_test_checkout")).toBe(false);

    expect(
      await billing.call("/billing/webhook", "POST", webhook("checkout.session.completed")),
    ).toBe(200);
    expect(billing.saved.map((snapshot) => snapshot.planId)).toEqual(["pro"]);
    expect(billing.completed).toEqual(["pro"]);
  });

  it("still skips a duplicate delivery of a checkout that succeeded", async () => {
    const billing = createIntegration(session({}));

    await billing.call("/billing/webhook", "POST", webhook("checkout.session.completed"));
    await billing.call("/billing/webhook", "POST", webhook("checkout.session.completed"));
    await billing.call("/billing/session?sessionId=cs_test_checkout", "GET");

    expect(billing.saved).toHaveLength(1);
    expect(billing.completed).toEqual(["pro"]);
  });
});
