# Stripe Integrations Examples

This folder groups Stripe integration examples by ORM or dialect so each setup can be tested on its own.

Available examples:

- [Prisma](./prisma)
- [Drizzle](./drizzle)
- [SQLite SQL](./sqlite)
- [Prisma Org Billing](./prisma-org)

Each example uses:

- the existing Better Auth integration
- the Stripe integration with the real Stripe SDK
- Better Auth migrations on startup for a working local auth DB

The org billing example also demonstrates the current seat billing model:

- `billing.seats.mode = "subscription_quantity"`
- `limits.seats` as the fallback included seat count
- `seat_quantity` as the Stripe-synced purchased-seat value in the billing snapshot
- `seat_allowance_override` as an explicit app-owned manual override that takes precedence
- bundled plan products can use `seatBilling = "included_plus_add_on"` with optional Stripe add-on seat prices
- `/billing/status`, `/billing/limits`, and `/billing/check` resolving the effective seat limit from those values
- `/billing/upgrade` updating the real Stripe subscription quantity for bundled seat upgrades
- custom usage-consuming flows can call `/billing/check` first, then perform the real mutation if allowed
- `billing.meters` plus `/billing/report-usage` as the v1 direct-to-Stripe meter reporting path
- meter reporting supports optional `occurredAt`; when omitted, the server uses the current time
- the current org example includes `tokensMonthly -> ai_tokens` and `apiCalls -> api_calls`
- the v1 report path uses meter `eventName`, not a meter ID from env; Stripe meter IDs matter when attaching metered prices
- the monthly Pro and Business example products can also auto-attach metered token and API-call prices
  to the same Stripe subscription for a true hybrid billing demo
- older monthly subscriptions are repaired on the fly so missing metered price items can be added
  when billing status or meter usage is loaded
- `/billing/meter-usage` returns Stripe-backed current-period meter totals, warnings, and guard state
- `/billing/upcoming-invoice` returns the next Stripe invoice preview with recurring, proration, and
  metered totals so the dashboard can show the bill directly in-app
- the current org example configures soft warnings, hard caps, and `past_due` blocking for token
  and API-call meters
- the dashboard intentionally separates local demo token usage from Stripe metered usage so it is
  clear which actions affect app-side checks and which ones affect Stripe billing

Run them individually with:

```bash
pnpm --dir examples/stripe-integrations/prisma generate
pnpm --dir examples/stripe-integrations/prisma dev

pnpm --dir examples/stripe-integrations/prisma-org generate
pnpm --dir examples/stripe-integrations/prisma-org dev

pnpm --dir examples/stripe-integrations/drizzle generate
pnpm --dir examples/stripe-integrations/drizzle dev

pnpm --dir examples/stripe-integrations/sqlite generate
pnpm --dir examples/stripe-integrations/sqlite dev
```
