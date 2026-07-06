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
import { polar } from "@farmjs/integrations/polar";

export const integrations = {
  billing: polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
  }),
};
```

## Usage

**Checkout**

```ts
const checkout = await api.billing.checkout.post({
  body: {
    productId: "pro",
    customerEmail: user.email,
    successUrl: "/dashboard",
  },
});
```

## Storage-aware billing

Polar callbacks can read and write through ctx.args.db, so webhook snapshots, subscription state, and customer entitlement checks share the same storage-agnostic integration layer.
