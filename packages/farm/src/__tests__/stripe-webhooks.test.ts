// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe } from "../../../farm-integrations/src/stripe/index";

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
  return {
    request,
    requestId: "req_test",
    url: new URL(request.url),
    pathname: new URL(request.url).pathname,
    method,
    params: {},
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
    requestContext: createRequestContextStore(),
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: true,
    isProd: false,
  };
}

describe("stripe webhooks", () => {
  it("supports multiple named webhook endpoints through webhooks.onEvent", async () => {
    const secrets: Array<string | undefined> = [];
    const seen: string[] = [];

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
          return {
            id: "cs_test_123",
            status: "complete",
            paymentStatus: "paid",
            mode: "subscription" as const,
            customerId: "cus_test_123",
            customerEmail: "owner@example.com",
            subscriptionId: "sub_test_123",
            subscriptionStatus: "active",
            currentPeriodEnd: null,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
            amountSubtotal: 1200,
            amountTotal: 1200,
            currency: "usd",
            metadata: {},
            lineItems: [],
          };
        },
        async constructWebhookEvent(input: { payload: string; secret?: string }) {
          secrets.push(input.secret);
          return {
            ...(JSON.parse(input.payload) as {
              id: string;
              type: string;
              data: Record<string, unknown>;
            }),
            raw: input.payload,
          };
        },
      },
      webhooks: {
        billing: {
          path: "/billing/webhook",
          secret: "whsec_billing",
          async onEvent(event) {
            seen.push(`billing:${event.type}:${event.provider}`);
          },
        },
        connect: {
          path: "/billing/connect-webhook",
          secret: "whsec_connect",
          async onEvent(event) {
            seen.push(`connect:${event.type}:${event.provider}`);
          },
        },
      },
    });

    const routes = integration.routes.filter(
      (route) => route.path.startsWith("/billing") && route.path.includes("webhook"),
    );
    expect(routes).toHaveLength(2);

    async function call(path: string, type: string) {
      const route = integration.routes.find(
        (candidate) => candidate.path === path && candidate.method === "POST",
      );
      expect(route).toBeTruthy();
      const request = new Request(`http://example.com${path}`, {
        method: "POST",
        headers: {
          "stripe-signature": "signature",
        },
        body: JSON.stringify({
          id: `evt_${type}`,
          type,
          data: {},
        }),
      });
      const response = await route!.handler(
        request,
        createContext(request, "POST", path, integration.instance),
      );

      return {
        status: response.status,
        json: JSON.parse(await response.text()) as Record<string, unknown>,
      };
    }

    const billing = await call("/billing/webhook", "checkout.session.completed");
    const connect = await call("/billing/connect-webhook", "account.updated");

    expect(billing.status).toBe(200);
    expect(billing.json).toMatchObject({
      received: true,
      provider: "stripe",
      webhook: "billing",
      type: "checkout.session.completed",
    });
    expect(connect.status).toBe(200);
    expect(connect.json).toMatchObject({
      received: true,
      provider: "stripe",
      webhook: "connect",
      type: "account.updated",
    });
    expect(secrets).toEqual(["whsec_billing", "whsec_connect"]);
    expect(seen).toEqual([
      "billing:checkout.session.completed:stripe",
      "connect:account.updated:stripe",
    ]);
  });
});
