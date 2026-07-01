# Stripe + Better Auth + Prisma Example

This example combines:

- the existing Better Auth integration
- the Stripe integration with the real Stripe SDK
- Farm schema generation targeting Prisma

What you can test here:

1. Better Auth sign-up, sign-in, and dashboard flow
2. Better Auth schema creation on startup through Better Auth migrations
3. Stripe product listing, checkout redirect, success page, and billing portal redirect against a real Stripe test account
4. `farm generate` auto-detecting Prisma from `prisma/schema.prisma`

## Run it

```bash
pnpm --dir examples/stripe-integrations/prisma generate
pnpm --dir examples/stripe-integrations/prisma dev
```

Then open [http://localhost:3000](http://localhost:3000).

Add `.env.local` first with at least:

```bash
APP_BASE_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=farm-example-better-auth-secret-for-local-dev-only
STRIPE_SECRET_KEY=sk_test_your_key_here
```

Add `STRIPE_WEBHOOK_SECRET` as well if you want signed webhook verification.
The example now reads its own `.env.local` from [examples/stripe-integrations/prisma/.env.local](/Users/mac/oss/farm.js/examples/stripe-integrations/prisma/.env.local), even if you start it from the repo root with a workspace filter.

## Generated target

This example is Prisma-first:

- `farm generate` patches [prisma/schema.prisma](/Users/mac/oss/farm.js/examples/stripe-integrations/prisma/prisma/schema.prisma)
- the Stripe integration schema comes from the configured Stripe integration itself
- Better Auth uses a local SQLite file and auto-runs its migrations on startup in this demo app
