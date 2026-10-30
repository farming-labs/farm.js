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

**src/lib/integrations.ts**

```ts
import { stripe } from "@farm.js/stripe";

export const integrations = {
  billing: stripe({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    products: [
      {
        id: "pro",
        name: "Pro",
        mode: "subscription",
        currency: "usd",
        unitAmount: 2900,
        interval: "month",
      },
    ],
    // Without `billing`, the portal opens only for the customer this returns.
    async resolveCustomer(ctx) {
      return ctx.req.get<string>("user.stripeCustomerId") ?? null;
    },
  }),
};
```

## Choose SDK ownership

### Let `@farm.js/stripe` construct the SDK

The config-first example is the adapter-owned path. When `instance` is omitted, the
`@farm.js/stripe` adapter creates a real Stripe SDK client from `secretKey`, supplied directly or
through `STRIPE_SECRET_KEY`.

### Provide an application-owned instance

```ts
import Stripe from "stripe";
import { stripe } from "@farm.js/stripe";

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  maxNetworkRetries: 2,
});

export const integrations = {
  billing: stripe({
    instance: stripeClient,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  }),
};
```

Use this path when the application needs to own retries, telemetry, API-version settings, or a
compatible test adapter. The instance wins if a secret key is also supplied. Webhook, product,
billing, route, and storage settings remain integration options in either mode.

`stripeClient` above is the vendor's `Stripe` SDK object—not another Farm wrapper. The
`stripe(...)` call remains responsible for adapting that SDK to Farm routes, callers, webhooks, and
lifecycle behavior.

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

Checkout and portal return paths must be same-origin, root-relative application paths. Protocol-relative paths such as `//example.com` are rejected.

A portal session exposes invoices, payment methods, and cancellation, so the portal route only acts
for an identified caller: the billing owner from `billing.resolveOwner`, or, without `billing`, the
Stripe customer id returned by `resolveCustomer(ctx)`. A `customerId` or `sessionId` in the request
must belong to that caller. With neither configured, the route answers `403`.

**Read a checkout session**

```ts
const session = await apiClient.billing.session({ query: { sessionId } });
```

Checkout session ids appear in success URLs and browser history, so the session route returns the
customer, email, metadata, subscription, and line items only to the session's owner. Anyone else
gets the `id`, `status`, `paymentStatus`, and `mode` with the identifying fields empty.

A session Farm's checkout route created carries its owner in the metadata. A session created
elsewhere (a Payment Link, the Dashboard) carries none, so Farm applies it only to the owner whose
stored billing account already has that session's Stripe customer; it never links a new customer to
whoever presents the session id.

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
- A checkout grants its plan only once the session is `complete` and its payment is `paid` (or
  needed none). Subscribe the webhook endpoint to `checkout.session.completed` and
  `checkout.session.async_payment_succeeded` so delayed payment methods are fulfilled when the
  money arrives.
- The upgrade route changes seat quantity with the proration set in `billing.seats.prorationBehavior`
  (`"create_prorations"` by default, or `"always_invoice"` / `"none"`). A `prorationBehavior` in
  the request body is ignored, so a caller cannot add seats without being charged for them.
- Subscribe the webhook endpoint to `customer.subscription.updated`: a plan switch made in Stripe
  (customer portal, Dashboard, or API) moves `planId` and `productId` to the configured product
  whose `priceId` or `lookupKey` the subscription now bills. Seat add-on and meter prices never
  count as the plan. A subscription that bills no configured product drops to the `free` plan with
  a warning, so give every subscription product a `priceId` or `lookupKey`.
- Subscribe it to `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed` as
  well. When the subscription ends, the owner moves to the `free` plan with status `canceled`.
  Invoice events change the status only for the owner's current subscription, so a one-off invoice
  never reactivates a canceled one. Features and limits come from the plan only while the status is
  `active`, `trialing`, or `past_due`; `canceled`, `unpaid`, and `incomplete` get the `free` plan's.
  A Stripe `paused` subscription is stored as `incomplete` and `incomplete_expired` as `canceled`.
- Checkout only sells products with `public: false` when they also set `purchasable: true`. A
  hidden product is otherwise refused, so knowing its id is not enough to buy it.
- `report-usage` sends the caller's `idempotencyKey` to Stripe as `<customer id>:<key>`. Stripe
  dedupes meter event identifiers across the account, so one customer's key can never claim, and
  drop, another customer's event. `stripeEventIdentifier` in the response is the scoped value.
- Store billing snapshots through the integration schema when the app needs fast entitlement reads.
- Run `farm stripe migrate --apply` after upgrading so the additive
  `billing_checkout_session` table can persistently deduplicate success-page and webhook delivery.
- A `one_time` product without a `planId` (credits, add-ons) sells no access: its checkout leaves
  the owner's plan, status, and subscription as they were. Record the purchase in
  `hooks.onCheckoutCompleted`, which receives the sold product as `purchasedProductId`.
- Checkout completion, billing sync, and payment hooks are claimed by Stripe session ID before they
  run. Custom persistence should implement `claimCheckoutSession`; without it, Farm falls back to
  comparing the stored billing snapshot, so its billing-account reader must accompany
  `saveBillingSnapshot`. Implement `releaseCheckoutSession` alongside it: when saving the snapshot
  or a checkout hook fails, Farm releases the claim so Stripe's retry can finish the checkout. The
  built-in storage adapters do this already.
- Use server callers for admin-only operations and browser callers for checkout/portal redirects.
- The billing POST routes act for the signed-in caller from its session cookie, so a request a
  browser sends from another origin is refused with `403`: a page on another site cannot report
  usage, start a checkout or open the portal for your visitor. Calls with no `Origin` (your own
  server, a script) are unaffected. If your frontend runs on another origin, list it in
  `allowedOrigins`, using the same syntax as `serverActions.allowedOrigins`.
- Test checkout success, cancel, webhook replay, portal return, subscription update, and trial edge cases.
