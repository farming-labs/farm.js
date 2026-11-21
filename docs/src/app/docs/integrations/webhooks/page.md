---
title: "Webhooks"
description: "Verify webhooks from any sender and sign the ones you send."
section: "Integrations"
---

# Webhooks

**`@farm.js/webhooks` checks that a webhook really came from its sender, and signs the webhooks you send to your own users.** It speaks [Standard Webhooks](https://www.standardwebhooks.com), which Svix-based senders such as Clerk, Resend and Autumn use, and GitHub's scheme. Any other scheme plugs in as a plain object.

```bash
pnpm add @farm.js/webhooks
```

It uses only Web Crypto and the Fetch API, no Node modules, so the same code works in any runtime that has them. It is tested on Node and Bun.

## Receive a webhook

```ts
// src/app/api/hooks/billing/route.ts
import { verifyWebhook, WebhookVerificationError } from "@farm.js/webhooks";

export async function POST(request: Request) {
  try {
    const event = await verifyWebhook(request, { secret: process.env.BILLING_WEBHOOK_SECRET! });
    await recordEvent(event.id, event.type, event.payload);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    throw error;
  }
}
```

`verifyWebhook` reads the raw body, checks the signature against `secret`, refuses a timestamp more than 5 minutes from now, and parses the JSON body. Nothing reaches your code unverified.

The event has:

| Field       | Meaning                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `id`        | The sender's message id. The same message can arrive twice: dedupe on it  |
| `type`      | The event type, from the scheme's headers or the payload's `type` field   |
| `timestamp` | When the sender signed it, as a `Date`, for schemes that sign a timestamp |
| `payload`   | The parsed body, validated by `schema` when one is given                  |
| `body`      | The raw body, exactly as signed                                           |

When something else already read the request, pass the raw body and headers instead: `verifyWebhook({ body, headers }, options)`. The body must be the exact bytes the sender signed, not JSON you re-serialized.

### Type the payload

Pass any Standard Schema validator, such as Zod, Valibot or ArkType:

```ts
import { z } from "zod";

const InvoicePaid = z.object({
  type: z.literal("invoice.paid"),
  data: z.object({ id: z.string(), amountCents: z.number() }),
});

const event = await verifyWebhook(request, { secret, schema: InvoicePaid });
event.payload.data.amountCents; // number
```

A body that doesn't match fails with `INVALID_PAYLOAD`, and `error.issues` lists why.

### GitHub

```ts
import { github, verifyWebhook } from "@farm.js/webhooks";

const event = await verifyWebhook(request, {
  secret: process.env.GITHUB_WEBHOOK_SECRET!,
  scheme: github(),
});
event.type; // "pull_request", from `x-github-event`
```

GitHub signs no timestamp, so a replayed delivery passes the signature check. Dedupe on `event.id` (`x-github-delivery`). Set the webhook's content type to `application/json`.

### Another sender

A scheme is an object with a `name` and a `verify` function that throws unless the signature is valid:

```ts
import { verifyWebhook, WebhookVerificationError, type WebhookScheme } from "@farm.js/webhooks";

const sharedToken: WebhookScheme = {
  name: "shared-token",
  async verify({ headers, secrets }) {
    if (!secrets.includes(headers.get("x-token") ?? "")) {
      throw new WebhookVerificationError("INVALID_SIGNATURE", "Wrong token.");
    }
    return { id: headers.get("x-request-id") ?? crypto.randomUUID() };
  },
};
```

## Send a webhook

`signWebhook` returns Standard Webhooks headers for a body. Your users verify it with any Standard Webhooks library, or with `verifyWebhook`.

```ts
import { safeFetch } from "@farm.js/core/safe-fetch";
import { signWebhook } from "@farm.js/webhooks";

const body = JSON.stringify({ type: "invoice.paid", data: invoice });
const headers = await signWebhook({ secret: endpoint.secret, body, id: message.id });

await safeFetch(endpoint.url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});
```

- Reuse the message `id` when you retry, so the receiver can drop the repeat.
- Send to user-supplied URLs with [`safeFetch`](/docs/safe-fetch), so an endpoint can't point at your private network.

## Managed receivers

Farm Infra can store incoming JSON events and retry delivery while your app is offline.
Install the managed webhook SDK in the sending and receiving apps.

```bash
pnpm add @farm.js/webhook
```

In the Infra dashboard, open **Webhooks**, choose the project and environment, and create a
**Send key** receiver pointing to your app's HTTPS route.

Copy the receiver URL and send key to the sending backend. It can reuse one sender instance:

```ts
import { createWebhook } from "@farm.js/webhook/sender";

const stock = createWebhook({ url: env.FARM_RECEIVER_URL, sendKey: env.FARM_WEBHOOK_SEND_KEY });
await stock.send({ sku: "blue-shirt", quantity: 12 }, { idempotencyKey: change.id });
```

Copy the delivery signing secret to the receiving app. Mount this integration in the
app's `integrations` configuration:

```ts
import { webhooks } from "@farm.js/webhook";

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

The sender gets a receipt after Infra commits the event. The receiving app verifies the
signature before running `onEvent`. In `applyStockUpdateOnce`, validate the payload and
commit its delivery ID with the inventory update so a retry can safely repeat the call.
For development, start the receiving app and run `farm preview --name stock`. Use the
HTTPS URL printed by the CLI plus `/api/hooks/stock` for a separate development receiver.
For production, use the app's stable HTTPS URL.

For a provider that already signs its events, select **Preserve provider signature** and
keep its existing verification route. For a Standard Webhooks sender with expiring
signatures, **Verify on arrival** checks the source signature before queuing and signs
each attempt for the receiving app.

## Secrets and rotation

A secret that starts with `whsec_` is a Standard Webhooks secret: the rest is the base64 key. Any other string is used as its UTF-8 bytes, as Farm's Polar and Autumn integrations do.

To rotate, pass both secrets. `verifyWebhook` accepts a signature made with either, and `signWebhook` signs with both, so receivers on either secret keep working:

```ts
await verifyWebhook(request, {
  secret: [process.env.WEBHOOK_SECRET!, process.env.OLD_WEBHOOK_SECRET!],
});
```

An empty secret, such as an unset environment variable, fails with `INVALID_SECRET` instead of accepting everything.

## Errors

`WebhookVerificationError` has a stable `code`. Answer with a 4xx status: senders retry a 5xx.

| `code`                   | When                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `INVALID_SECRET`         | `secret` is empty, or a `whsec_` secret isn't valid base64           |
| `MISSING_HEADERS`        | A signature header is missing; the message names each one            |
| `INVALID_TIMESTAMP`      | `webhook-timestamp` isn't Unix seconds                               |
| `TIMESTAMP_OUT_OF_RANGE` | The timestamp is more than `toleranceSeconds` (default 300) from now |
| `INVALID_SIGNATURE`      | No signature matches any secret                                      |
| `INVALID_BODY`           | The signature is valid, but the body isn't JSON                      |
| `INVALID_PAYLOAD`        | The body doesn't match `schema`                                      |
