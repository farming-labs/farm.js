// @vitest-environment node

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FarmIntegrationHandlerContext } from "../integrations";
import { autumn } from "../../../farm-integrations/src/autumn/index";

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
    integration: {
      category: "payment",
      slot: "payment",
      type: "autumn",
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

function createAutumnWebhookPayload() {
  return {
    type: "customer.products.updated",
    data: {
      customer_id: `cus_${randomUUID()}`,
      products: [
        {
          id: "pro_monthly",
          scenario: "new",
        },
      ],
    },
  };
}

async function signAutumnWebhook(body: string, webhookId = "msg_autumn_123") {
  const { Webhook } = await import(standardWebhooksModulePath);
  const timestamp = new Date();
  const secret = "autumn_webhook_secret";
  const signature = new Webhook(Buffer.from(secret, "utf-8").toString("base64")).sign(
    webhookId,
    timestamp,
    body,
  );

  return {
    secret,
    headers: {
      "svix-id": webhookId,
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "svix-signature": signature,
    },
  };
}

describe("autumn webhooks", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies and dispatches Autumn webhook events through webhooks.onEvent", async () => {
    const seen: Array<{ id: string; type: string; provider: string }> = [];
    const body = JSON.stringify(createAutumnWebhookPayload());
    const signed = await signAutumnWebhook(body);

    const integration = autumn({
      secretKey: "autumn_test_secret",
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
      provider: "autumn",
      webhook: "default",
      eventId: "msg_autumn_123",
      type: "customer.products.updated",
    });
    expect(seen).toEqual([
      {
        id: "msg_autumn_123",
        type: "customer.products.updated",
        provider: "autumn",
      },
    ]);
  });

  it("returns a 403 response for Autumn signature verification failures", async () => {
    const body = JSON.stringify(createAutumnWebhookPayload());
    const signed = await signAutumnWebhook(body);

    const integration = autumn({
      secretKey: "autumn_test_secret",
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
    expect(JSON.parse(await response.text())).toMatchObject({
      error: "No matching signature found",
    });
  });
});
