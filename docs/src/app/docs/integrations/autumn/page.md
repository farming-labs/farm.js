---
title: "Autumn Integration"
description: "Add subscription and usage billing with Autumn while keeping Farm's integration API and storage layer."
section: "Integrations"
---

# Autumn Integration

Autumn fits apps that want product-led billing without building every plan, entitlement, and usage event by hand.

## Install from the CLI

**Terminal**

```bash
farm add integration autumn --ui
```

## Config-first setup

**src/lib/integrations.ts**

```ts
import { autumn } from "@farmjs/integrations/autumn";

export const integrations = {
  billing: autumn({
    apiKey: process.env.AUTUMN_API_KEY,
    webhookSecret: process.env.AUTUMN_WEBHOOK_SECRET,
  }),
};
```

## Usage

**Checkout**

```ts
const checkout = await api.billing.checkout.post({
  body: {
    productId: "pro",
    customerId: user.id,
    successUrl: "/dashboard",
  },
});
```

## Storage-aware billing

The integration can persist customer, plan, entitlement, and usage snapshots through ctx.args.db, so the app keeps the same Farm integration surface even when the backing storage client changes.
