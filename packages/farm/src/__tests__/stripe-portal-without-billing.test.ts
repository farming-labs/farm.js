// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { stripe, type StripeIntegrationInput } from "../../../farm-stripe/src/index";

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
    pathname: path,
    method: request.method,
    params: {},
    input: {},
    data: {},
    integration: { category: "payment", slot: "payment", type: "stripe", instance },
    route: { kind: "route", path, methods: [request.method] },
    req,
    requestContext: req,
    config: {} as FarmIntegrationHandlerContext["config"],
    isDev: false,
    isProd: true,
  } as unknown as FarmIntegrationHandlerContext;
}

function createIntegration(resolveCustomer?: StripeIntegrationInput["resolveCustomer"]) {
  const portals: string[] = [];
  const integration = stripe({
    appBaseUrl: "https://app.example.com",
    products: [
      {
        id: "pro",
        name: "Pro",
        currency: "usd",
        unitAmount: 2900,
        mode: "subscription",
        interval: "month",
      },
    ],
    ...(resolveCustomer ? { resolveCustomer } : {}),
    instance: {
      async createCheckoutSession() {
        return { id: "cs_new", url: "https://checkout.stripe.test/cs_new" };
      },
      async createPortalSession(args: { customerId: string }) {
        portals.push(args.customerId);
        return { url: `https://billing.stripe.test/${args.customerId}` };
      },
      async retrieveCheckoutSession(id: string) {
        return {
          id,
          status: "complete",
          paymentStatus: "paid",
          mode: "subscription" as const,
          customerId: "cus_victim",
          customerEmail: "victim@example.com",
          subscriptionId: "sub_victim",
          amountSubtotal: 2900,
          amountTotal: 2900,
          currency: "usd",
          metadata: { note: "private" },
          lineItems: [
            {
              description: "Pro",
              quantity: 1,
              amountSubtotal: 2900,
              amountTotal: 2900,
              currency: "usd",
            },
          ],
        };
      },
      async constructWebhookEvent() {
        throw new Error("not used");
      },
    } as unknown as StripeIntegrationInput["instance"],
  });

  async function call(pathWithQuery: string, method: string, body?: unknown) {
    const path = pathWithQuery.split("?")[0]!;
    const route = integration.routes.find(
      (entry: { path: string; method: unknown }) =>
        entry.path === path && String(entry.method).toUpperCase() === method,
    );
    if (!route) throw new Error(`Route not found: ${method} ${path}`);
    const request = new Request(`https://app.example.com${pathWithQuery}`, {
      method,
      headers: { "content-type": "application/json", "x-farm-integration-client": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await route.handler(
      request,
      createContext(request, path, integration.instance),
    );
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) as Record<string, unknown> };
  }

  return { call, portals };
}

describe("stripe portal and session lookup without billing", () => {
  it("refuses to open a portal for a caller-supplied customerId or sessionId", async () => {
    const { call, portals } = createIntegration();

    for (const body of [{ customerId: "cus_victim" }, { sessionId: "cs_leaked" }]) {
      const result = await call("/billing/portal", "POST", body);
      expect(result.status, JSON.stringify(body)).toBe(403);
      expect(result.json.error).toContain("resolveCustomer");
      expect(result.text).not.toContain("cus_victim");
    }
    expect(portals).toEqual([]);
  });

  it("returns only status fields for a session lookup by a stranger", async () => {
    const { call } = createIntegration();

    const result = await call("/billing/session?sessionId=cs_leaked", "GET");

    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      id: "cs_leaked",
      status: "complete",
      paymentStatus: "paid",
      customerId: null,
      customerEmail: null,
      metadata: {},
      lineItems: [],
    });
    expect(result.text).not.toContain("cus_victim");
    expect(result.text).not.toContain("victim@example.com");
    expect(result.text).not.toContain("sub_victim");
  });

  it("opens only the resolved customer's portal and verifies request claims against it", async () => {
    const attacker = createIntegration(() => "cus_attacker");
    expect(
      (await attacker.call("/billing/portal", "POST", { customerId: "cus_victim" })).status,
    ).toBe(403);
    expect(
      (await attacker.call("/billing/portal", "POST", { sessionId: "cs_leaked" })).status,
    ).toBe(403);
    expect(attacker.portals).toEqual([]);

    const anonymous = createIntegration(() => null);
    expect((await anonymous.call("/billing/portal", "POST", {})).status).toBe(401);

    const owner = createIntegration(async () => "cus_victim");
    const opened = await owner.call("/billing/portal", "POST", { sessionId: "cs_leaked" });
    expect(opened.status).toBe(200);
    expect(opened.json.redirectTo).toBe("https://billing.stripe.test/cus_victim");
    const session = await owner.call("/billing/session?sessionId=cs_leaked", "GET");
    expect(session.json.customerEmail).toBe("victim@example.com");
  });
});
