# @farm.js/autumn

Autumn billing for Farm.js applications. The integration mounts typed routes for the plan catalog,
checkout, the customer portal, invoices, and billing status, entitlement, and usage checks. Autumn
keeps the billing state, and Farm reads it for each owner.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/autumn
```

`autumn-js` and `standardwebhooks` are dependencies and install with the package. To scaffold the
registry entry and a pricing page at `/integrations/autumn` in an existing app, run
`farm add integration autumn --ui`.

## Configure

`billing` is required, and its `resolveOwner` decides who the signed-in caller bills as.

```ts
// src/lib/integrations.ts
import { autumn } from "@farm.js/autumn";
import { getUser } from "./session";

export const appIntegrations = {
  billing: autumn({
    billing: {
      async resolveOwner(ctx) {
        const user = await getUser(ctx.request);
        return user ? { kind: "user", id: user.id, email: user.email } : null;
      },
      plans: { pro: { features: { analytics: true }, limits: { tokensMonthly: 1_000_000 } } },
      products: {
        proMonthly: { kind: "subscription", planId: "pro", autumn: { planId: "pro_monthly" } },
      },
      meters: {
        tokensMonthly: { aggregation: "sum", eventName: "ai_usage", featureId: "tokens" },
      },
    },
  }),
} as const;
```

| Variable                | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `AUTUMN_SECRET_KEY`     | Builds the Autumn client. Required unless `instance` or `secretKey` is set. |
| `AUTUMN_WEBHOOK_SECRET` | Default secret for the webhook route.                                       |
| `APP_BASE_URL`          | Origin for checkout and portal return URLs. Defaults to the request origin. |

`serverURL` points the client at another Autumn API. It is an option only, with no environment
variable. Pass an app-owned Autumn SDK client as `instance` to keep construction in app code.

## Catalog rules

`autumn()` throws at startup when the catalog is incomplete:

- every product needs the Autumn plan it sells, as `autumn.planId` or `autumnPlanId`;
- every meter needs the Autumn feature it reports to, as `featureId`.

A product's `autumn` block can also set `featureQuantities` and `items` to customize the attached
plan.

## Customers

Each owner is a `"user"` or an `"organization"` and maps to one Autumn customer. Its `name`,
`fingerprint`, and `metadata` are passed to Autumn when the customer is created. The customer id is
`<kind>_<id>`, such as `user_42`. An id with other characters, such as an email, is encoded as
`<kind>_-<base64url>` so two owners never share a customer. `billing.resolveExternalCustomerId`
replaces the scheme.

Customers created before this encoding used a lossy form of the id. Return
`legacyAutumnExternalCustomerId(owner)` from `resolveExternalCustomerId` only while migrating them.

## Routes

Routes mount under `/billing`: `products`, `status`, `current-charges`, `invoices`, `features`,
`limits`, `usage`, `meter-usage`, `report-usage`, `check`, `checkout`, and `portal`. Each has a
matching option, such as `invoicesPath`, to move it. Call them through `createIntegrations`:

```ts
const checkout = await apiClient.billing.checkout({
  body: { productId: "proMonthly", successPath: "/billing/success" },
});
```

The routes act for the caller from its cookies, so requests from other origins are refused unless
listed in `allowedOrigins`. `hooks.onUsageReported` runs after each usage report.

## Webhooks

The webhook route mounts only when `webhooks` is set, at `/billing/webhook` unless it sets a `path`:

```ts
autumn({
  webhooks: {
    async onEvent(event) {
      console.log(event.type, event.id);
    },
  },
  billing,
});
```

The route verifies the Standard Webhooks signature with `AUTUMN_WEBHOOK_SECRET` or `secret`, then
calls `onEvent`. A bad signature gets `403`, and `onError` can return a response of its own.

## Client entry

`@farm.js/autumn/client` exports `autumnClient`, `createAutumnClientApi`, and the request and
response types without loading the Autumn SDK, so browser code can import it.

## Documentation

- [Autumn integration](https://farmjs.dev/docs/integrations/autumn)
- [`examples/autumn-integration`](https://github.com/farming-labs/farm.js/tree/main/examples/autumn-integration)
  bills Better Auth organizations, with seat and token meters

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
