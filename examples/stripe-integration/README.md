# Stripe Integration Example

Config-first Stripe setup through `@farm.js/stripe`.

This example is wired for a real Stripe test account and uses hosted Stripe Checkout plus
the Stripe Billing Portal.

It supports both:

- inline Stripe price data defined in the app catalog
- existing Stripe Price objects through `priceId`

The config stays small:

```ts
import Stripe from "stripe";

stripe({
  instance: new Stripe(process.env.STRIPE_SECRET_KEY!),
  products: stripeCatalog,
})
```

The integration owns:

- `/billing/checkout`
- `/billing/portal`
- `/billing/session`
- `/billing/webhook`

The shared callers are exposed in [api.ts](/Users/mac/oss/farm.js/examples/stripe-integration/src/lib/api.ts):

- `api` for server-side calls that dispatch directly to the integration handler
- `apiClient` for browser calls that go through the integration-owned routes

Typical usage:

- home page: `apiClient.billing.checkout(...)`
- success page: `apiClient.billing.session(...)`
- success client controls: `apiClient.billing.portal(...)`

To use Stripe:

1. Add `.env.local` with `STRIPE_SECRET_KEY`
2. Optionally add `STRIPE_PRO_YEARLY_PRICE_ID` and `STRIPE_SUPPORTER_PACK_PRICE_ID` to use existing Stripe Price objects
3. Optionally add `STRIPE_WEBHOOK_SECRET` for signed webhook verification
4. Run `pnpm dev`

For a real webhook listener, point Stripe or the Stripe CLI at:

- `http://localhost:3000/billing/webhook`
