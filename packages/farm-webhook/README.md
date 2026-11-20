# @farmjs/webhook

**Receive Farm Infra deliveries in a Farm integration and send JSON events to a project receiver.**

Create a receiver from **Webhooks** in the Farm Infra dashboard. Choose its project,
environment, and destination. Give the signing secret to the receiving application. For a
bearer receiver, give the receiver URL and write-only send key to the sending service.

```ts
import { createWebhook } from "@farmjs/webhook/sender";

const warehouse = createWebhook({
  url: env.FARM_RECEIVER_URL,
  sendKey: env.FARM_WEBHOOK_SEND_KEY,
});
await warehouse.send({ sku: "blue-shirt", quantity: 12 }, { idempotencyKey: "stock-change-123" });
```

A trusted sending backend can also create the instance with a project API key authorized for
both `webhooks:manage` and `webhooks:send`. Construction is synchronous and local. The first
send finds or creates the named receiver and acquires its receiver-scoped token. Restarts use
the same configuration. Use a distinct signing secret and project key for each destination origin.

```ts
const warehouse = createWebhook({
  apiKey: env.FARM_API_KEY,
  project: env.FARM_PROJECT_ID,
  environment: "production",
  name: "warehouse",
  destination: "https://shop.example/api/hooks/stock",
  verification: { mode: "bearer", deliverySecret: env.STOCK_SIGNING_SECRET },
});
await warehouse.send({ sku: "blue-shirt", quantity: 12 }, { idempotencyKey: "stock-change-123" });
```

Deployment tools can call `await registerWebhook(config)` explicitly to provision a
receiver before sending, including provider-signed receivers. Registration with a matching
API-key configuration is idempotent. Newly created bearer receivers return their send key
once. Store it in the sender's secret manager.

The SDK exchanges the send key for a 15-minute receiver token and shares it across requests.
Set `auth: "direct"` to send the key on each request. Tools with custom header support can POST
UTF-8 JSON directly using `Authorization: Bearer <send key>`. Use a stable idempotency key
when retrying a send whose response was lost.

```ts
// src/lib/integrations.ts
import { webhooks } from "@farmjs/webhook";

export const appIntegrations = {
  webhooks: webhooks({
    stock: {
      path: "/api/hooks/stock",
      secret: process.env.STOCK_SIGNING_SECRET,
      async onEvent({ id, data }) {
        await applyStockUpdateOnce(id, data);
      },
    },
  }),
};
```

Pass `appIntegrations` to `defineConfig({ integrations: appIntegrations })`. Generate a
separate Standard Webhooks signing secret for each receiver (`whsec_` followed by 32 random
bytes in base64). Supply it to Infra and to the server integration. The application callback
validates its payload and commits the delivery ID with its own write. Handler failures cause a
retry. An HTTP 202 from intake confirms durable receipt; a later 2xx from the integration
acknowledges processing.

Use a separate development receiver when testing. Start your managed Farm Preview before provisioning. Infra binds its destination to the account's live grant and checks it before forwarding. A new grant requires a new receiver. Use a stable destination for production.

Existing provider routes can use `verification: { mode: "preserve", signatureHeaders:
["x-hub-signature-256", "x-github-event", "x-github-delivery"] }`. The app verifies the
original JSON bytes and its provider's signature. For Standard Webhooks senders with expiring
signatures, use `{ mode: "standard", sourceSecret, deliverySecret }` to verify before storing
and sign each attempt afresh. Preserve-mode receivers rely on application verification.
