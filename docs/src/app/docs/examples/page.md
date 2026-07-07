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
| examples/deployment-presets | Vercel, Cloudflare Pages, and Netlify deployment target presets. |
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

## What to verify

| Example type | Things to click/test |
| --- | --- |
| Basic routing | Navigation, route params, layouts, and route config exports. |
| API routes | Typed callers, validation errors, success responses, and generated types. |
| Docs integration | `/docs`, markdown mirrors, docs API routes, page actions, and search. |
| Stripe | Products, checkout redirect, portal redirect, session/status reads, and webhook handling. |
| Better Auth | Sign-up, sign-in, session read, logout, and protected routes. |
| Jobs | Trigger, batch trigger, schedule, status, and cancel calls. |
| Markdown | `.md` mirrors for public pages and cache headers. |

## Example-driven development

When adding a new framework feature, add or update an example that proves the whole flow works:

1. Config in `farm.config.ts`.
2. Route/page files under `src/app`.
3. Client interaction when the feature has UI.
4. Build or dev-server validation.
5. Docs content that explains the same shape.

Examples should be small but complete enough that a user can copy the pattern into a real app.
