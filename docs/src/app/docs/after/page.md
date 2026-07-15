---
title: "Post-response Work"
description: "Schedule short server work with after() without delaying the response."
section: "Runtime"
---

# Post-response Work

Use `after()` for short server work that should start once Farm has finished the current response. Typical uses include analytics, audit events, cache warming, notifications, and non-critical cleanup.

Import it from the server-only entry:

```ts
import { after } from "@farmjs/core/after";
```

## Use it in a page

`after()` does not add its callback to the page's response time.

```tsx
import { after } from "@farmjs/core/after";
import { recordPageView } from "@/lib/analytics";

export default async function ProductPage({ params }) {
  const product = await getProduct(params.id);

  after(async () => {
    await recordPageView({ productId: product.id });
  });

  return <ProductDetails product={product} />;
}
```

Farm waits for a streamed response body to finish before starting the callback. Redirect and not-found responses use the same request lifecycle.

## Use it in an API route

Keep work required for correctness in the handler. Schedule only the follow-up work that may happen after the client receives success.

```ts
import { after } from "@farmjs/core/after";
import { createEndpoint } from "@farmjs/core/api";
import { z } from "zod";

export const POST = createEndpoint(
  {
    method: "POST",
    body: z.object({ orderId: z.string() }),
  },
  async ({ body }) => {
    const order = await confirmOrder(body.orderId);

    after(async () => {
      await sendReceipt(order.id);
      await recordOrderAnalytics(order.id);
    });

    return { ok: true, order };
  },
);
```

The same API works in layouts, request middleware, server functions, and form actions because Farm creates one post-response queue for the whole request.

## Behavior

- `after(callback)` returns `void`; Farm owns when the callback starts.
- Callbacks start after the response finishes. For streaming responses, that means after the complete body is sent or the stream closes.
- Callbacks run one at a time in registration order.
- A callback may call `after()` again. The nested callback joins the end of the current queue.
- A callback error is logged, does not change the response, and does not prevent later callbacks from running.
- Request-local async context active at registration is preserved for the callback.
- Calling `after()` outside an active server request throws a clear runtime error.

On serverless adapters, Farm registers the queue with the provider's `waitUntil` lifecycle. On a Node server, Farm uses the response `finish` and `close` events. This keeps supported invocations alive without making the browser wait for the callback.

## Best practices

Capture stable values before scheduling work:

```ts
const userId = session.user.id;
const eventId = crypto.randomUUID();

after(() => analytics.track({ eventId, userId, name: "checkout.completed" }));
```

Do authentication, authorization, validation, and the primary database write before returning the response. The response is already committed when an `after()` callback runs, so the callback cannot safely change its status, headers, or cookies.

Make callbacks idempotent when they call external services. A deployment runtime may stop unexpectedly, and `after()` does not add durable storage, retries, or exactly-once delivery.

Use [Cron and Workflows](/docs/workflows) for critical or long-running work that needs retries, scheduling, visibility, or recovery. Use `after()` for bounded request follow-up work where low latency matters more than durable execution.
