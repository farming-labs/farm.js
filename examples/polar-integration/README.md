# Polar Integration Example

Farm example for the Polar billing provider with Better Auth organizations.

It demonstrates:

- Better Auth email sign-in and sign-up
- Better Auth organizations as the billing owner
- public pricing page with monthly, yearly, and one-time Polar products
- fixed recurring Polar products
- one-time Polar products
- customer status via Polar customer state
- customer portal sessions
- usage event ingestion
- customer meter reads
- live metered price summaries from Polar products
- signed Polar webhook handling through `/billing/webhook`

## Setup

1. Copy `.env.example` to `.env.local`
2. Fill in your Polar sandbox or production values
3. Add `POLAR_WEBHOOK_SECRET` if you want local webhook verification enabled
4. Run:

```bash
pnpm --filter @farm.js/integrations build
pnpm --dir examples/polar-integration install
pnpm --dir examples/polar-integration generate
pnpm --dir examples/polar-integration dev
```

Open [http://localhost:3002](http://localhost:3002).

## Test Flow

1. Create a Better Auth account at `/sign-up`
2. Review the pricing page at `/`
3. Open `/dashboard`
4. Create an organization or switch to an existing one
5. Start Polar checkout from the product list or pricing page
6. Open the Polar portal
7. Report metered tokens and refresh the meter state
8. Point your Polar webhook endpoint at `http://localhost:3002/billing/webhook` when testing local delivery
