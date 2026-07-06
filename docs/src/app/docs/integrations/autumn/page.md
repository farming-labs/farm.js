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
    secretKey: process.env.AUTUMN_SECRET_KEY,
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
    successPath: "/dashboard",
  },
});
```

## Storage-aware billing

The integration can persist customer, plan, entitlement, and usage snapshots through ctx.args.db, so the app keeps the same Farm integration surface even when the backing storage client changes.

## What Autumn adds

| Area | Details |
| --- | --- |
| Products | Public products for pricing pages. |
| Status | Current plan, subscription, trial, features, limits, and entitlements. |
| Checkout | Attach an Autumn product and redirect users when payment or confirmation is required. |
| Portal | Open the customer portal from a typed caller. |
| Usage | Meter usage, report usage, check balance, and read current charges. |
| Webhooks | Verify Autumn events and keep local billing state in sync. |

## Common callers

```ts
const products = await api.billing.products.get();
const status = await api.billing.status.get();

const allowed = await api.billing.check.post({
  body: {
    key: "ai-generations",
    amount: 1,
  },
});
```

## Checkout flow

```ts
const checkout = await api.billing.checkout.post({
  body: {
    productId: "pro",
    successPath: "/dashboard",
    metadata: {
      source: "pricing",
    },
  },
});

if (checkout.data?.redirectTo) {
  window.location.href = checkout.data.redirectTo;
}
```

## Owner and entitlements

Autumn needs a billing owner when it checks or attaches customer state. Use the owner resolver to connect Farm auth/session data with Autumn customers.

```ts
autumn({
  secretKey: process.env.AUTUMN_SECRET_KEY,
  billing: {
    async resolveOwner(ctx) {
      const organizationId = ctx.requestContext.get<string>("organization.id");

      return organizationId
        ? {
            id: organizationId,
            kind: "organization",
            email: ctx.requestContext.get<string>("user.email") ?? null,
          }
        : null;
    },
  },
});
```

## Production notes

- Set `AUTUMN_SECRET_KEY`, `AUTUMN_WEBHOOK_SECRET`, and `APP_BASE_URL`.
- Keep Farm product IDs separate from provider IDs when you want a stable app contract.
- Use `check` before expensive operations and `reportUsage` after successful work.
- Treat webhooks as the source of truth for subscription state.
- Test free-plan reads, checkout redirects, portal redirects, usage limits, and webhook sync.
