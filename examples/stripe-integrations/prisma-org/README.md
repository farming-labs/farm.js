# Stripe + Better Auth + Prisma Organization Example

This example shows the org-owned billing variant:

- Better Auth still owns sign-up, sign-in, sessions, organizations, members, and invitations
- Stripe billing belongs to the active Better Auth organization instead of the signed-in user
- Farm exposes provider-neutral billing plan data through:
  - `plans.features`
  - `plans.limits`
  - `billing.usage.resolve(...)`
  - `/billing/features`
  - `/billing/limits`
  - `/billing/usage`
  - `/billing/check`
- Farm seat billing is configured as `subscription_quantity`, so `seatQuantity` is expected to come from real Stripe checkout or subscription sync instead of local demo writes

What you can test here:

1. Sign up with Better Auth
2. Create an organization
3. Set that organization active
4. Invite another user
5. Subscribe the active org to Pro or Business from the pricing cards
6. Watch billing status, features, limits, seat source, and usage update on the dashboard
7. When the org runs out of seats, use the dashboard seat upgrade prompt to change the real Stripe subscription quantity
8. Use the manual seat override control on the dashboard only when you want an explicit app-owned demo/admin override
9. Use the metered token and API-call buttons on the dashboard to send direct Stripe meter events
10. Refresh the dashboard meter totals to confirm current-period Stripe usage, soft-limit warnings, and hard-cap behavior

## Client Preflight Pattern

For custom org actions that consume a limited resource, this demo currently uses a
client-first preflight flow:

1. Call `/billing/check`
2. If `allowed` is `false`, show the relevant upgrade or limit message
3. If `allowed` is `true`, call the real mutation

For seats, that means checking before creating an invite:

```ts
const seatCheck = await apiClient.billing.check({
  body: {
    key: "seats",
    amount: 1,
  },
});

if (!seatCheck.data?.allowed) {
  // show upgrade prompt or limit message
  return;
}

await fetch("/api/auth/organization/invite-member", {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    email: "teammate@example.com",
    role: "member",
  }),
});
```

The same pattern applies to other limited actions:

- check `projects` before creating a project
- check `tokensMonthly` before recording more token usage
- check `seats` before sending an invitation

This keeps the billing logic generic:

- `/billing/check` answers "can this owner consume more?"
- your mutation performs the actual state change if the preflight passes

For the dashboard demo, this is the intended contract for invite flows right now.

## Run it

```bash
pnpm --dir examples/stripe-integrations/prisma-org generate
pnpm --dir examples/stripe-integrations/prisma-org dev
```

Then open [http://localhost:3001](http://localhost:3001).

Add `.env.local` first:

```bash
APP_BASE_URL=http://localhost:3001
BETTER_AUTH_URL=http://localhost:3001
BETTER_AUTH_SECRET=farm-example-better-auth-secret-for-local-dev-only
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
# Optional extra-seat add-on prices for real bundled seat upgrades:
# STRIPE_PRO_EXTRA_SEAT_MONTHLY_PRICE_ID=price_...
# STRIPE_PRO_EXTRA_SEAT_YEARLY_PRICE_ID=price_...
# STRIPE_BUSINESS_EXTRA_SEAT_MONTHLY_PRICE_ID=price_...
# STRIPE_BUSINESS_EXTRA_SEAT_YEARLY_PRICE_ID=price_...

# Optional monthly metered overage prices for hybrid pricing:
# STRIPE_PRO_TOKENS_METER_MONTHLY_PRICE_ID=price_...
# STRIPE_PRO_API_CALLS_METER_MONTHLY_PRICE_ID=price_...
# STRIPE_BUSINESS_TOKENS_METER_MONTHLY_PRICE_ID=price_...
# STRIPE_BUSINESS_API_CALLS_METER_MONTHLY_PRICE_ID=price_...
```

## Notes

- Better Auth organization data lives in `better-auth.sqlite` for this demo.
- The Stripe billing snapshot still uses the Prisma storage adapter.
- Demo project counts and demo token usage are written into the example Prisma SQLite database so the billing usage routes have something concrete to measure.
- The pricing page keeps the public checkout flow simple and uses the plan product defaults.
- Seat-specific upgrade guidance now appears on the dashboard only when the active org is out of seats.
- The demo no longer includes a local seat quantity simulator. Purchased seats are expected to come from Stripe-backed flows.
- On startup, the example clears legacy fake-paid snapshots that were created by older local seat simulators. That prevents a brand-new org from incorrectly showing `pro` before a real subscription exists.

## Seat Billing Model

This example uses:

```ts
billing: {
  seats: {
    mode: "subscription_quantity",
  },
}
```

and the paid products are configured as bundled seat plans:

```ts
products: {
  proMonthly: {
    planId: "pro",
    seatBilling: "included_plus_add_on",
    seatPriceId: process.env.STRIPE_PRO_EXTRA_SEAT_MONTHLY_PRICE_ID,
  },
}
```

That changes how the effective seat limit is resolved:

1. `seatAllowanceOverride` if one exists
2. `seatQuantity` from the billing snapshot when the plan is using subscription quantity seats
3. `plans[planId].limits.seats` as the fallback

So in this example:

- `free` still falls back to `plans.free.limits.seats = 4`
- paid orgs are expected to sync a purchased seat count from real Stripe checkout or subscription events
- a manual override can temporarily replace that purchased count
- `plans[planId].limits.seats` defines the seats included in the base bundled plan
- optional `seatPriceId` values are where real Stripe-backed extra seat pricing would plug in
- if those optional add-on price ids are not configured, checkout still gives the bundled included seats, but the dashboard upgrade button stays disabled for paid seat add-ons

## Meter Billing v1

This example now includes the first Stripe meter-reporting slice without adding any new local
meter tables.

```ts
billing: {
  usage: {
    async resolve(owner, key) {
      // local app-side usage for /billing/usage and /billing/check
    },
  },
  meters: {
    tokensMonthly: {
      aggregation: "sum",
      ingestion: "raw",
      eventName: "ai_tokens",
      unit: "tokens",
    },
    apiCalls: {
      aggregation: "count",
      ingestion: "raw",
      eventName: "api_calls",
      unit: "requests",
    },
  },
}
```

That means:

- `usage.resolve(owner, "tokensMonthly")` is still the local app-side usage source
- `billing.reportUsage({ key: "tokensMonthly", ... })` sends a direct Stripe meter event
- `billing.reportUsage({ key: "apiCalls", ... })` sends a separate direct Stripe meter event
- v1 does not add local meter event tables or delivery tables yet
- `occurredAt` is optional; if you omit it, the Stripe integration uses the server's current time

### Event Name vs Meter ID

Farm's v1 `reportUsage()` path does **not** read a Stripe meter ID from `.env.local`.

Instead, the Stripe integration:

- reads the Farm meter config by `key`
- pulls the configured `eventName`
- sends a Stripe meter event with that `event_name`

Example:

```ts
meters: {
  tokensMonthly: {
    eventName: "ai_tokens",
  },
}
```

```ts
await apiClient.billing.reportUsage({
  body: {
    key: "tokensMonthly",
    quantity: 25_000,
    idempotencyKey: "demo-token-meter:123",
  },
});
```

That causes Farm to send Stripe a meter event with:

```json
{
  "event_name": "ai_tokens",
  "payload": {
    "stripe_customer_id": "cus_...",
    "value": "25000"
  }
}
```

Stripe matches that `event_name` to the meter you created in the Stripe Dashboard.

The **meter ID** matters later when you create a Stripe **metered price** and attach that price to
a subscription. Farm's v1 event-reporting path does not need that meter ID directly.

### Current Example Meters

The current org example now includes these Stripe meter examples:

- `tokensMonthly`
  - `eventName: "ai_tokens"`
  - `aggregation: "sum"`
  - `ingestion: "raw"`
  - used by the `Report 25k Stripe Metered Tokens` button
- `apiCalls`
  - `eventName: "api_calls"`
  - `aggregation: "count"`
  - `ingestion: "raw"`
  - used by the `Report 1 Stripe Metered API Call` button

The current dashboard demonstrates both paths separately:

- `Add 25k Local Demo Tokens`
  - writes local demo usage so `/billing/usage` and `/billing/check` change
- `Report 25k Stripe Metered Tokens`
  - sends a direct Stripe meter event using the configured `tokensMonthly` meter key
  - uses the default server timestamp by omitting `occurredAt`
- `Report 1 Stripe Metered API Call`
  - sends a direct Stripe meter event using the configured `apiCalls` meter key
  - demonstrates a `count` meter, so each click records one event

Example:

```ts
await apiClient.billing.reportUsage({
  body: {
    key: "tokensMonthly",
    quantity: 25_000,
    idempotencyKey: `demo-token-meter:${orgId}:${Date.now()}`,
  },
});
```

```ts
await apiClient.billing.reportUsage({
  body: {
    key: "apiCalls",
    quantity: 1,
    idempotencyKey: `demo-api-call-meter:${orgId}:${Date.now()}`,
  },
});
```

If you need to backfill or report a historical event, pass `occurredAt` explicitly:

```ts
await apiClient.billing.reportUsage({
  body: {
    key: "tokensMonthly",
    quantity: 25_000,
    idempotencyKey: `backfill:${orgId}:2026-04-01`,
    occurredAt: "2026-04-01T12:00:00.000Z",
  },
});
```

Important:

- to make the Stripe meter button succeed, create a Stripe meter with the event name
  `ai_tokens`
- to make the API-call meter button succeed, create a Stripe meter with the event name
  `api_calls`
- meter reporting by itself does not change the demo's local token usage counter
- the `apiCalls` example uses Stripe `count` aggregation, so it counts events rather than summing
  the `quantity` value
- invoice impact depends on how your Stripe account wires meters into prices and subscriptions

## Hybrid Pricing In This Demo

The current org example now demonstrates a practical hybrid SaaS model on the **monthly** paid
products:

- fixed base subscription price for the plan
- bundled included seats from the plan
- recurring extra-seat add-on price when the org goes above the included seats
- metered token and API-call overage prices attached to the same Stripe subscription

So the monthly invoice shape becomes:

```txt
base plan
+ extra seat add-ons
+ metered token overage
+ metered API-call overage
```

For the example products:

- `proMonthly`
  - base recurring price
  - optional extra-seat price via `STRIPE_PRO_EXTRA_SEAT_MONTHLY_PRICE_ID`
  - optional token metered price via `STRIPE_PRO_TOKENS_METER_MONTHLY_PRICE_ID`
  - optional API-call metered price via `STRIPE_PRO_API_CALLS_METER_MONTHLY_PRICE_ID`
- `businessMonthly`
  - base recurring price
  - optional extra-seat price via `STRIPE_BUSINESS_EXTRA_SEAT_MONTHLY_PRICE_ID`
  - optional token metered price via `STRIPE_BUSINESS_TOKENS_METER_MONTHLY_PRICE_ID`
  - optional API-call metered price via `STRIPE_BUSINESS_API_CALLS_METER_MONTHLY_PRICE_ID`

Important:

- the hybrid attachment is currently configured on the **monthly** products only
- yearly products still show the fixed subscription and bundled seats, but do not automatically
  attach metered overage prices in this example
- the pricing page now shows the monthly plan details with attached seat and usage overage pricing
  when those monthly meter prices are configured

## Meter Attachment + Guardrails

The example now does more than just report Stripe meter events.

For the monthly paid products:

- Farm automatically attaches configured metered price items to new subscriptions at checkout
- Farm also repairs older subscriptions that are missing those meter price items when the dashboard
  loads billing status or meter usage
- the dashboard meter totals come from Stripe's current-period summaries, not from the local demo
  usage resolver

The current guard configuration in
[integrations.ts](./src/lib/integrations.ts)
is:

- `tokensMonthly`
  - soft warning at the included plan limit
  - hard cap at included limit + `250,000` for `pro`
  - hard cap at included limit + `2,500,000` for `business`
  - blocked entirely when the Stripe subscription is `past_due` or `unpaid`
- `apiCalls`
  - soft warning at the included plan limit
  - hard cap at included limit + `10,000` for `pro`
  - hard cap at included limit + `100,000` for `business`
  - blocked entirely when the Stripe subscription is `past_due` or `unpaid`

In practice that means:

- `pro`
  - tokens warn at `1,000,000`, block after `1,250,000`
  - API calls warn at `50,000`, block after `60,000`
- `business`
  - tokens warn at `10,000,000`, block after `12,500,000`
  - API calls warn at `500,000`, block after `600,000`

`/billing/report-usage` now returns the current meter state along with the accepted event, so the
dashboard can immediately show:

- current period usage
- projected usage after the event
- soft-limit warnings
- hard-cap blocks
- past-due blocks

## How To Test Metered Billing

1. Subscribe an active organization to a **monthly** `Pro` or `Business` plan.
2. Open the dashboard once after subscription so Farm can load billing status and ensure the
   configured metered price items are attached to the Stripe subscription.
3. In Stripe test mode, open the subscription and confirm it includes:
   - the base plan price
   - the seat add-on price when applicable
   - the metered token/API-call prices when configured
4. Back on the dashboard, use `Refresh Meter Totals`.
5. Confirm the `Stripe Metered Tokens` and `Stripe Metered API Calls` rows now show current-period
   totals instead of `Unavailable`.
6. Use:
   - `Report 25k Metered Tokens` for a smoke test
   - the larger token button to push usage across the included monthly threshold
   - `Report 1 Metered API Call` to test the count-based meter
7. Refresh meter totals again and inspect:
   - current-period totals
   - state (`ok`, `soft limit reached`, etc.)
   - warnings returned by the guard
8. For invoice impact, inspect the Stripe subscription's upcoming invoice after crossing the
   included amount.

Note:

- the dashboard's local `Monthly Tokens` counter still comes from the example database and is
  separate from Stripe meter totals
- the Stripe-backed totals live under the dedicated meter rows and the `Last Stripe meter event`
  box on the dashboard

## Stored Billing Fields

The billing snapshot now stores two seat-specific nullable fields:

- `seat_quantity`
- `seat_allowance_override`

In Prisma they map to:

- [seatQuantity](./prisma/schema.prisma#L25)
- [seatAllowanceOverride](./prisma/schema.prisma#L26)

These sit alongside the existing plan, product, status, and trial fields in the `billing_account` snapshot table.

## What the Routes Return

The core Stripe routes now expose the effective seat state for the active org:

- `/billing/status`
  - `seatMode`
  - `seatQuantity`
  - `seatAllowanceOverride`
  - `seatLimitSource`
- `/billing/limits`
  - returns the effective seat limit, not just the plan default
- `/billing/check`
  - compares app-owned usage against that effective limit
  - intended as the preflight call before usage-consuming mutations such as invites
- `/billing/upgrade`
  - updates the real Stripe subscription quantity for the active owner
  - for bundled plans, it keeps the base plan item at quantity `1` and only adjusts the extra-seat add-on quantity
  - it updates the existing subscription in place, so it does not create a new Checkout redirect
  - any proration or renewal impact should be reviewed in Stripe on the subscription or upcoming invoice
- `/billing/report-usage`
  - sends a direct Stripe meter event for the configured meter key
  - requires the active billing owner to already have a `stripeCustomerId`
  - defaults `occurredAt` to the current server time when it is omitted
  - blocks when the subscription is `past_due` or `unpaid` and the meter guard requires it
  - blocks when the report would exceed the configured hard cap for the current billing period
  - returns the current and projected current-period Stripe usage for the meter when available
  - v1 does not store local meter event history
- `/billing/meter-usage`
  - returns the current-period Stripe total for a configured meter key
  - returns soft-limit and hard-limit values derived from the active plan and meter guard
  - returns the current meter state and any warning message for dashboard display
- `/billing/upcoming-invoice`
  - returns the next Stripe invoice preview for the active billing owner
  - groups totals into recurring charges, prorations, metered overage, and other
  - makes it easier to verify invoice impact in-app without opening the Stripe portal
- `/billing/status`
  - now performs a best-effort repair for older monthly subscriptions that are missing configured
    metered price items, so existing test subscriptions can be brought onto the hybrid path

## Demo-Only Helpers

The org demo adds one helper route for the explicit app-owned override path:

- `/organization/demo/billing/seats/override`
  - applies or clears `seatAllowanceOverride`

This is a demo helper only. It is not part of the Stripe integration API itself.

## Pricing UI Behavior

The pricing page intentionally does not expose a seat quantity input anymore.

- pricing cards are standard plan cards for `free`, `pro`, and `business`
- paid plan checkout uses the configured product defaults
- when the active org runs out of seats, the dashboard shows a seat upgrade prompt with the relevant pricing for that org
- if the extra-seat Stripe price is configured, that prompt updates the existing Stripe subscription directly instead of redirecting through Checkout
- Stripe will reflect the billing impact on the subscription itself and on the upcoming invoice preview
- there is no local purchased-seat simulator on the dashboard anymore

That keeps the main pricing UI simple while still demonstrating how seat upgrades fit into an org-based billing flow.
