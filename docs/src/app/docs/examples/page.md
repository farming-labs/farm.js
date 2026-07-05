---
title: "Examples"
description: "Use the examples folder as executable docs for routing, RSC, docs, markdown, auth, billing, email, jobs, and API keys."
section: "Reference"
---

# Examples

Use the examples folder as executable docs for routing, RSC, docs, markdown, auth, billing, email, jobs, and API keys.

## Example apps

| Example | Shows |
| --- | --- |
| examples/basic | Core routing, layouts, deployment config, markdown mirrors, PPR. |
| examples/ssr-ssg-demo | SSR, SSG, ISR, API routes, middleware. |
| examples/docs-integration | Docs runtime and /api/docs machine routes. |
| examples/stripe-integration | Stripe checkout, portal, session, webhooks. |
| examples/stripe-integrations/* | Stripe with Prisma, Drizzle, SQLite, org billing. |
| examples/better-auth-integration | Better Auth routes with local SQLite. |
| examples/jobs-trigger | Trigger.dev jobs runtime. |
| examples/jobs-inngest | Inngest jobs runtime. |

## Run one example

**Terminal**

```bash
pnpm --filter @farmjs/core build
pnpm --dir examples/basic install
pnpm --dir examples/basic dev
```
