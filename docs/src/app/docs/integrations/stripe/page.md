---
title: "Stripe Integration"
description: "Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and database-backed billing snapshots."
section: "Integrations"
---

# Stripe Integration

Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and database-backed billing snapshots.

## Install from the CLI

**Terminal**

```bash
farm add integration stripe --ui
```

## Config-first setup

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    billing: {
      provider: "stripe",
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      products: [
        {
          id: "pro",
          name: "Pro",
          prices: [{ interval: "month", amount: 2900, currency: "usd" }],
        },
      ],
    },
  },
});
```

## Choose SDK ownership

### Let Farm construct Stripe

The config-first example is the default path. When `instance` is omitted, Farm loads the installed
`@farm.js/stripe` adapter and creates the Stripe SDK from `secretKey`, supplied directly or through
`STRIPE_SECRET_KEY`. Application code does not import the adapter factory.

### Provide an application-owned instance

```ts
import { defineConfig } from "@farm.js/core";
import Stripe from "stripe";

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  maxNetworkRetries: 2,
});

export default defineConfig({
  integrations: {
    billing: {
      provider: "stripe",
      instance: stripeClient,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    },
  },
});
```

Use this path when the application needs to own retries, telemetry, API-version settings, or a
compatible test adapter. The instance wins if a secret key is also supplied. Webhook, product,
billing, route, and storage settings remain integration options in either mode.

For typed callers without a runtime adapter import, define the namespace with
`import type { StripeIntegration } from "@farm.js/stripe"` and pass it to `createIntegrations`.

## Usage

**Client checkout**

```ts
const checkout = await apiClient.billing.checkout.post({
  body: {
    productId: "pro",
    successPath: "/success",
    cancelPath: "/pricing",
  },
});

if (checkout.data?.redirectTo) {
  window.location.href = checkout.data.redirectTo;
}
```

## Database-backed billing

The Stripe integration can use Farm's integration ORM layer through `ctx.args.db`, so relational billing snapshot reads and writes can work across supported database clients. This is database access, not Farm KV storage.

## What Stripe adds

| Area            | Details                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| Catalog         | Public product and price metadata for pricing pages.                                        |
| Checkout        | A typed checkout route that can return JSON for callers or redirect for browser navigation. |
| Customer portal | A typed route for opening Stripe's billing portal.                                          |
| Billing status  | Subscription, trial, seats, cancellation, and plan state.                                   |
| Entitlements    | Feature, limit, usage, meter, and billing checks.                                           |
| Webhooks        | Event verification and snapshot updates for checkout and subscription events.               |
| Database        | Schema-backed billing account snapshots through `ctx.args.db`.                              |

## Common callers

**Load pricing**

```ts
const products = await api.billing.products.get();
```

**Read current billing state**

```ts
const status = await api.billing.status.get();

if (status.data?.status === "active") {
  console.log(status.data.planId);
}
```

**Open the portal**

```ts
const portal = await api.billing.portal.post({
  body: {
    returnTo: "/settings/billing",
  },
});

if (portal.data?.redirectTo) {
  window.location.href = portal.data.redirectTo;
}
```

## Billing owner

Production billing usually needs an owner resolver. That resolver decides whether the billing account belongs to a user, organization, workspace, or team.

```ts
stripe({
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  billing: {
    async resolveOwner(ctx) {
      const userId = ctx.req.get<string>("user.id");

      if (!userId) {
        return null;
      }

      return {
        id: userId,
        kind: "user",
        email: ctx.req.get<string>("user.email") ?? null,
      };
    },
  },
});
```

The same `ctx` includes `ctx.args.db`, `ctx.data`, request params, the raw request, and request-scoped context values from middleware or auth integrations.

## Production notes

- Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `APP_BASE_URL`.
- Keep product IDs stable because they become the app-facing contract.
- Verify webhook signatures before mutating billing state.
- Store billing snapshots through the integration schema when the app needs fast entitlement reads.
- Use server callers for admin-only operations and browser callers for checkout/portal redirects.
- Test checkout success, cancel, webhook replay, portal return, subscription update, and trial edge cases.
