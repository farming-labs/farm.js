# @farm.js/webhooks

**Verify webhooks from any sender, and sign the ones you send.**

```ts
import { verifyWebhook } from "@farm.js/webhooks";

const event = await verifyWebhook(request, { secret: process.env.WEBHOOK_SECRET! });
```

- Standard Webhooks, which Svix-based senders such as Clerk, Resend and Autumn use, and GitHub.
- Any other scheme plugs in as a plain object.
- Typed payloads from any Standard Schema validator.
- `signWebhook` for webhooks you send, verifiable with any Standard Webhooks library.
- Web Crypto and the Fetch API only, no Node modules. Tested on Node and Bun.

It doesn't store endpoints, queue deliveries, retry them or dedupe event ids yet. Dedupe on `event.id` yourself.

Docs: https://farmjs.dev/docs/integrations/webhooks
