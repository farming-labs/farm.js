---
title: "Stripe Integration"
description: "Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and storage-backed billing snapshots."
section: "Integrations"
---

# Stripe Integration

Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and storage-backed billing snapshots.

## Install from the CLI

**Terminal**

```bash
farm add integration stripe --ui
```

## Config-first setup

**src/lib/integrations.ts**

```ts
import { stripe } from "@farmjs/integrations/stripe";

export const integrations = {
  billing: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    products: [
      {
        id: "pro",
        name: "Pro",
        prices: [{ interval: "month", amount: 2900, currency: "usd" }],
      },
    ],
  }),
};
```

## Usage

**Client checkout**

```ts
const checkout = await apiClient.billing.checkout.post({
  body: {
    productId: "pro",
    successUrl: "/success",
    cancelUrl: "/pricing",
  },
});

if (checkout.data?.url) {
  window.location.href = checkout.data.url;
}
```

## Storage-aware billing

The Stripe integration can use Farm's integration ORM layer through ctx.args.db, so billing snapshot reads and writes can work across Prisma, Drizzle, SQLite SQL, and other farming-labs/orm compatible clients.
