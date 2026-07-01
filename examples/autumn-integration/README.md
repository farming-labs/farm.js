# Autumn Integration Example

Farm example for the Autumn billing provider with Better Auth organizations.

It demonstrates:

- Better Auth email sign-in and sign-up
- Better Auth organizations as the billing owner
- public pricing page with monthly, yearly, and one-time Autumn plans
- fixed recurring Autumn plans
- one-time Autumn plans
- customer status via Autumn customer state
- customer portal sessions
- usage event ingestion
- customer meter reads
- live metered price summaries from Autumn plans
- signed Autumn webhook handling through `/billing/webhook`

## Setup

1. Copy `.env.example` to `.env.local`
2. Fill in your Autumn values
3. Add `AUTUMN_WEBHOOK_SECRET` if you want local webhook verification enabled
4. Run:

```bash
pnpm --filter @farmjs/integrations build
pnpm --dir examples/autumn-integration install
pnpm --dir examples/autumn-integration generate
pnpm --dir examples/autumn-integration dev
```

Open [http://localhost:3004](http://localhost:3004).

## Test Flow

1. Create a Better Auth account at `/sign-up`
2. Review the pricing page at `/`
3. Open `/dashboard`
4. Create an organization or switch to an existing one
5. Start Autumn checkout from the product list or pricing page
6. Open the Autumn portal
7. Report metered tokens and refresh the meter state
8. Point your Autumn webhook endpoint at `http://localhost:3004/billing/webhook` when testing local delivery
