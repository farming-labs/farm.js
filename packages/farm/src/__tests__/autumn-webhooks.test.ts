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
      type: "autumn",
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

/**
 * Sign the way Svix does for Autumn: a `whsec_`-prefixed secret handed straight
 * to the library, which strips the prefix and base64-decodes the key. The helper
 * above signs with the same conversion the verifier uses, so it cannot detect a
 * mismatch with the secrets Autumn actually issues.
 */
async function signSvixWebhook(body: string, webhookId = "msg_svix_123") {
  const { Webhook } = await import(standardWebhooksModulePath);
  const timestamp = new Date();
  const secret = `whsec_${Buffer.from(randomUUID() + randomUUID()).toString("base64")}`;
  const signature = new Webhook(secret).sign(webhookId, timestamp, body);

  return {
    secret,
    headers: {
      "svix-id": webhookId,
      "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "svix-signature": signature,
    },
  };
}

async function postToAutumnWebhook(secret: string, body: string, headers: Record<string, string>) {
  const integration = autumn({
    secretKey: "autumn_test_secret",
    webhooks: { path: "/billing/webhook", secret },
    billing: {
      resolveOwner() {
        return null;
      },
    },
  });
  const route = integration.routes.find(
    (candidate) => candidate.path === "/billing/webhook" && candidate.method === "POST",
  );
  const request = new Request("http://example.com/billing/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return route!.handler(
    request,
    createContext(request, "POST", "/billing/webhook", integration.instance),
  );
}

describe("autumn webhooks signed with Svix secrets", () => {
  it("accepts an event signed with the whsec_ secret Autumn issues", async () => {
    // Regression: the verifier base64-encoded every secret, which is right for
    // Polar's raw secrets but turns a Svix whsec_ secret into the wrong HMAC key,
    // so every genuine Autumn event was rejected with a 403.
    const body = JSON.stringify(createAutumnWebhookPayload());
    const signed = await signSvixWebhook(body);

    const response = await postToAutumnWebhook(signed.secret, body, signed.headers);

    expect(response.status).toBe(200);
    expect(JSON.parse(await response.text())).toMatchObject({
      received: true,
      eventId: "msg_svix_123",
    });
  });

  it("still rejects a whsec_ secret that does not match the signature", async () => {
    const body = JSON.stringify(createAutumnWebhookPayload());
    const signed = await signSvixWebhook(body);
    const otherSecret = `whsec_${Buffer.from(randomUUID() + randomUUID()).toString("base64")}`;

    const response = await postToAutumnWebhook(otherSecret, body, signed.headers);

    expect(response.status).toBe(403);
  });

  it("rejects a tampered body even when the whsec_ secret is right", async () => {
    const body = JSON.stringify(createAutumnWebhookPayload());
    const signed = await signSvixWebhook(body);

    const response = await postToAutumnWebhook(
      signed.secret,
      body.replace("customer.products.updated", "customer.deleted"),
      signed.headers,
    );

    expect(response.status).toBe(403);
  });
});

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
