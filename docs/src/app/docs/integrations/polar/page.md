---
title: "Polar Integration"
description: "Use Polar for products, checkout, customer portals, subscriptions, webhooks, and entitlement-aware app flows."
section: "Integrations"
---

# Polar Integration

Polar is a good fit for SaaS products, open-source sponsorships, digital products, and entitlement-aware app features.

## Install from the CLI

**Terminal**

```bash
farm add integration polar --ui
```

## Config-first setup

**src/lib/integrations.ts**

```ts
import { polar } from "@farm.js/integrations/polar";

export const integrations = {
  billing: polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    billing: {
      resolveOwner(ctx) {
        const userId = ctx.req.get<string>("user.id");
        return userId ? { id: userId, kind: "user" } : null;
      },
    },
  }),
};
```

`POLAR_WEBHOOK_SECRET` is read from the environment when webhook routes are configured.

## Use an existing Polar instance

```ts
import { Polar } from "@polar-sh/sdk";
import { polar } from "@farm.js/integrations/polar";

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: "sandbox",
});

export const billing = polar({
  instance: polarClient,
  server: "sandbox",
  billing: {
    resolveOwner: () => null,
  },
});
```

Farm uses the supplied SDK directly, so the integration does not require `accessToken`. `server`
still describes the integration environment and defaults from `POLAR_SERVER`.

## Usage

**Checkout**

```ts
const checkout = await api.billing.checkout.post({
  body: {
    productId: "pro",
    customerEmail: user.email,
    successPath: "/dashboard",
  },
});
```

## Storage-aware billing

Polar callbacks can read and write through ctx.args.db, so webhook snapshots, subscription state, and customer entitlement checks share the same storage-agnostic integration layer.

## What Polar adds

| Area           | Details                                                             |
| -------------- | ------------------------------------------------------------------- |
| Products       | Public product metadata for pricing and account screens.            |
| Checkout       | Polar checkout sessions for one-time and subscription products.     |
| Portal         | Customer sessions for billing management.                           |
| Billing status | Current customer, plan, features, limits, and active product state. |
| Usage          | Meter and entitlement helpers for usage-aware products.             |
| Webhooks       | Subscription and order events that update local billing state.      |

## Common callers

```ts
const products = await api.billing.products.get();
const status = await api.billing.status.get();

const checkout = await api.billing.checkout.post({
  body: {
    productId: "pro",
    successPath: "/dashboard",
    cancelPath: "/pricing",
  },
});
```

## Portal flow

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

## When Polar is a good fit

Polar works especially well when the product is developer-facing, open-source, sponsor-backed, or selling digital access. The Farm integration keeps the same caller shape as other billing providers, so moving between Stripe, Autumn, and Polar does not force your app UI to learn a new local API style.

## Production notes

- Set `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_SERVER`, and `APP_BASE_URL`.
- Use sandbox/server config for local testing and production config for live billing.
- Store the external customer ID with the billing owner so portal and status reads stay stable.
- Test checkout return URLs, portal return URLs, webhook signatures, and entitlement checks.
