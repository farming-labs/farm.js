# @farm.js/stripe

Stripe billing for Farm.js applications. The integration mounts typed routes for a product
catalog, Checkout, the customer portal, and billing status, and verifies Stripe webhooks. With
`billing` configured it also tracks plans, entitlements, seats, and metered usage per billing owner.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/stripe
```

The Stripe SDK is a dependency and installs with the package. To scaffold the registry entry and a
pricing page at `/integrations/stripe` in an existing app, run `farm add integration stripe --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { stripe } from "@farm.js/stripe";
import { getSession } from "./session";

export const appIntegrations = {
  billing: stripe({
    products: [{ id: "pro", name: "Pro", priceId: "price_123", mode: "subscription" }],
    // The portal opens only for the customer this returns.
    async resolveCustomer(ctx) {
      return (await getSession(ctx.request))?.stripeCustomerId ?? null;
    },
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Register `appIntegrations` as `integrations` in `farm.config.ts`. Credentials come from the
environment unless they are passed as options:

| Variable                | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Builds the Stripe client. Required unless `instance` or `secretKey` is set. |
| `STRIPE_WEBHOOK_SECRET` | Verifies events posted to `/billing/webhook`.                               |
| `APP_BASE_URL`          | Origin for Checkout and portal return URLs. Defaults to the request origin. |

Pass an app-owned `new Stripe(...)` as `instance` to keep SDK construction in application code.

## Call the routes

```ts
// src/lib/api.ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

```ts
const checkout = await apiClient.billing.checkout({
  body: { productId: "pro", successPath: "/success", cancelPath: "/pricing" },
});

if (checkout.data?.redirectTo) window.location.assign(checkout.data.redirectTo);
```

Routes mount under `/billing`: `products`, `status`, `current-charges`, `features`, `limits`,
`usage`, `meter-usage`, `upcoming-invoice`, `report-usage`, `check`, `checkout`, `upgrade`,
`portal`, `session`, and `webhook`. Each has a matching option, such as `checkoutPath`.

- Return paths must be same-origin, root-relative paths.
- Requests from other origins are refused unless listed in `allowedOrigins`.
- The portal answers `403` until `billing.resolveOwner` or `resolveCustomer` identifies the caller.
- The session route returns customer details only to the checkout's owner.

## Billing owners and storage

```ts
import { prismaStorageAdapter, stripe } from "@farm.js/stripe";

stripe({
  billing: {
    async resolveOwner(ctx) {
      const user = await getUser(ctx.request);
      return user ? { kind: "user", id: user.id, email: user.email } : null;
    },
    plans: { pro: { features: { analytics: true }, limits: { projects: 10 } } },
    products: { proMonthly: { kind: "subscription", planId: "pro", priceId: "price_123" } },
    storage: prismaStorageAdapter({ prisma }),
  },
});
```

An owner is a `"user"` or an `"organization"`. With `billing` set, `resolveOwner` decides who is
billed and `resolveCustomer` is ignored.

Each billing read and write uses the matching `hooks` entry, such as `saveBillingSnapshot`, when
there is one, and `storage` otherwise. The adapters are `prismaStorageAdapter`,
`drizzleStorageAdapter`, `sqliteStorageAdapter`, and `ormStorageAdapter`. Without `storage`, Farm
uses its integration ORM, but only if the app config sets `storage.client`.

The tables are `billing_account` and `billing_checkout_session`, exported as `stripeSchema`.
`farm stripe migrate` prints the statements and `farm stripe migrate --apply` runs them. With
`billing` set, verified checkout, subscription, and invoice events update the stored snapshot, and
`onWebhook` receives every verified event either way.

`@farm.js/stripe/client` exports `stripeClient`, `createStripeClientApi`, and the request types
without loading the Stripe SDK, so browser code can import it. `@farm.js/stripe/storage` exports
the adapters and billing types.

## Documentation

- [Stripe integration](https://farmjs.dev/docs/integrations/stripe)
- [`examples/stripe-integration`](https://github.com/farming-labs/farm.js/tree/main/examples/stripe-integration)
  for Checkout and the portal without stored billing
- [`examples/stripe-integrations`](https://github.com/farming-labs/farm.js/tree/main/examples/stripe-integrations)
  for billing with SQLite, Prisma, Prisma organizations, and Drizzle

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
