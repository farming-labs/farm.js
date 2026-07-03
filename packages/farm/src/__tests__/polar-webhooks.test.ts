// @vitest-environment node

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { polar } from "../../../farm-integrations/src/polar/index";

const standardWebhooksModulePath =
  "../../../../node_modules/.pnpm/node_modules/standardwebhooks/dist/index.js";

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
    input: {},
    data: {},
    integration: {
      category: "payment",
      slot: "payment",
      type: "polar",
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

function createProductWebhookPayload() {
  const productId = randomUUID();
  return {
    type: "product.created",
    timestamp: new Date().toISOString(),
    data: {
      id: productId,
      created_at: new Date().toISOString(),
      modified_at: null,
      trial_interval: null,
      trial_interval_count: null,
      name: "Product",
      description: null,
      visibility: "public",
      recurring_interval: null,
      recurring_interval_count: null,
      is_recurring: false,
      is_archived: false,
      organization_id: randomUUID(),
      metadata: {},
      prices: [
        {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          modified_at: null,
          source: "catalog",
          amount_type: "fixed",
          price_currency: "usd",
          tax_behavior: null,
          is_archived: false,
          product_id: productId,
          price_amount: 1000,
        },
      ],
      benefits: [],
      medias: [],
      attached_custom_fields: [],
    },
  };
}

async function signPolarWebhook(body: string, webhookId = "wh_123") {
  const { Webhook } = await import(standardWebhooksModulePath);
  const timestamp = new Date();
  const secret = "polar_webhook_secret";
  const signature = new Webhook(Buffer.from(secret, "utf-8").toString("base64")).sign(
    webhookId,
    timestamp,
    body,
  );

  return {
    secret,
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "webhook-signature": signature,
    },
  };
}

describe("polar webhooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies and dispatches Polar webhook events through webhooks.onEvent", async () => {
    const seen: Array<{ id: string; type: string; provider: string }> = [];
    const body = JSON.stringify(createProductWebhookPayload());
    const signed = await signPolarWebhook(body);

    const integration = polar({
      accessToken: "polar_test_token",
      webhooks: {
        path: "/billing/webhook",
        secret: signed.secret,
        async onEvent(event) {
          seen.push({
            id: event.id,
            type: event.type,
            provider: event.provider,
          });
        },
      },
      billing: {
        resolveOwner() {
          return null;
        },
      },
    });

    const route = integration.routes.find(
      (candidate) => candidate.path === "/billing/webhook" && candidate.method === "POST",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signed.headers,
      },
      body,
    });
    const response = await route!.handler(
      request,
      createContext(request, "POST", "/billing/webhook", integration.instance),
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      received: true,
      provider: "polar",
      webhook: "default",
      eventId: "wh_123",
      type: "product.created",
    });
    expect(seen).toEqual([
      {
        id: "wh_123",
        type: "product.created",
        provider: "polar",
      },
    ]);
  });

  it("returns a 403 response for Polar signature verification failures", async () => {
    const body = JSON.stringify(createProductWebhookPayload());
    const signed = await signPolarWebhook(body);

    const integration = polar({
      accessToken: "polar_test_token",
      webhooks: {
        path: "/billing/webhook",
        secret: "wrong_secret",
      },
      billing: {
        resolveOwner() {
          return null;
        },
      },
    });

    const route = integration.routes.find(
      (candidate) => candidate.path === "/billing/webhook" && candidate.method === "POST",
    );
    expect(route).toBeTruthy();

    const request = new Request("http://example.com/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signed.headers,
      },
      body,
    });
    const response = await route!.handler(
      request,
      createContext(request, "POST", "/billing/webhook", integration.instance),
    );

    expect(response.status).toBe(403);
    expect(JSON.parse(await response.text()).error).toMatch(/signature/i);
  });
});
