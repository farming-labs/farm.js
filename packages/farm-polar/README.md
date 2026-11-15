# @farm.js/polar

Polar billing for Farm.js applications. The integration mounts typed routes for the product
catalog, Polar checkout, the customer portal, and billing status, entitlement, and usage checks.
Billing state is read from Polar for each owner, so the integration keeps no local billing tables.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/polar
```

`@polar-sh/sdk` is a dependency and installs with the package. To scaffold the registry entry and a
pricing page at `/integrations/polar` in an existing app, run `farm add integration polar --ui`.

## Configure

`billing` is required, and its `resolveOwner` decides who the signed-in caller bills as.

```ts
// src/lib/integrations.ts
import { polar } from "@farm.js/polar";
import { getUser } from "./session";

export const appIntegrations = {
  billing: polar({
    billing: {
      async resolveOwner(ctx) {
        const user = await getUser(ctx.request);
        return user ? { kind: "user", id: user.id, email: user.email } : null;
      },
      plans: {
        pro: { features: { analytics: true }, limits: { tokensMonthly: 1_000_000 } },
      },
      products: {
        proMonthly: {
          kind: "subscription",
          planId: "pro",
          polar: { productId: process.env.POLAR_PRO_MONTHLY_PRODUCT_ID },
        },
      },
    },
  }),
} as const;
```

| Variable               | Purpose                                                                      |
| ---------------------- | ---------------------------------------------------------------------------- |
| `POLAR_ACCESS_TOKEN`   | Builds the Polar client. Required unless `instance` or `accessToken` is set. |
| `POLAR_SERVER`         | `sandbox` or `production`. Defaults to `sandbox`.                            |
| `POLAR_WEBHOOK_SECRET` | Default secret for the webhook route.                                        |
| `APP_BASE_URL`         | Origin for checkout and portal return URLs. Defaults to the request origin.  |

`accessToken`, `server`, and `appBaseUrl` override the environment. Pass an app-owned `Polar` client
as `instance` to keep SDK construction in application code.

## Customers

Each owner is a `"user"` or an `"organization"` and maps to one Polar customer by external id. The
id is `<kind>:<id>`, such as `user:42`, unless `billing.resolveExternalCustomerId` returns another.

## Routes

Routes mount under `/billing`: `products`, `status`, `current-charges`, `features`, `limits`,
`usage`, `meter-usage`, `report-usage`, `check`, `checkout`, and `portal`. Each has a matching
option, such as `checkoutPath`, to move it. Call them through `createIntegrations`:

```ts
const checkout = await apiClient.billing.checkout({
  body: { productId: "proMonthly", successPath: "/billing/success" },
});
```

The routes act for the caller from its cookies, so requests from other origins are refused unless
listed in `allowedOrigins`.

A meter needs an `eventName` and a `polar.meterId`. `polar()` throws at startup when either is
missing. Reported usage is sent to Polar as events, and `hooks.onUsageReported` runs after each one.

## Webhooks

The webhook route mounts only when `webhooks` is set:

```ts
polar({
  webhooks: {
    async onEvent(event) {
      console.log(event.type, event.id);
    },
  },
  billing,
});
```

- The path defaults to `/billing/webhook` and the secret to `POLAR_WEBHOOK_SECRET`.
- The object needs at least one of `path`, `secret`, `onEvent`, or `onError`. An empty `{}` mounts
  nothing.
- For several endpoints, pass named definitions, each with its own `path`.
- The route verifies the signature and calls `onEvent`. It changes no billing state itself, since
  status is always read from Polar. A bad signature gets `403`, and `onError` can return a response
  of its own.

## Client entry

`@farm.js/polar/client` exports `polarClient`, `createPolarClientApi`, and the request and response
types without loading the Polar SDK, so browser code can import it.

## Documentation

- [Polar integration](https://farmjs.dev/docs/integrations/polar)
- [`examples/polar-integration`](https://github.com/farming-labs/farm.js/tree/main/examples/polar-integration)
  bills Better Auth organizations, with metered usage and webhooks

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
