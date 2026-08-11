---
title: "Examples"
description: "Use the examples folder as executable docs for routing, RSC, agents, docs, markdown, auth, billing, email, jobs, and API keys."
section: "Reference"
---

# Examples

Use the examples folder as executable docs for routing, RSC, agents, docs, markdown, auth, billing, email, jobs, and API keys.

## Example apps

| Example                         | Shows                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| examples/basic                  | Core routing, layouts, deployment config, markdown mirrors, PPR, and framework Cron.            |
| examples/deployment-presets     | Vercel, Cloudflare Pages, Netlify, self-hosted Node, and direct Nitro preset deployment output. |
| examples/ssr-ssg-demo           | SSR, SSG, ISR, API routes, middleware.                                                          |
| examples/preact-renderer        | Preact TSX routes, streaming SSR, hydration, hooks, and a typed FARMJS server call.             |
| examples/solid-renderer         | Solid TSX routes, SSR, hydration, signals, and a typed FARMJS server call.                      |
| examples/vue-renderer           | Vue SFC routes, SSR, hydration, refs, and a typed FARMJS server call.                           |
| examples/svelte-renderer        | Svelte 5 routes, SSR, hydration, runes, and a typed FARMJS server call.                         |
| examples/i18n                   | Typed ICU messages, locale routing, detection, client switching, API context, and RTL.          |
| examples/docs-integration       | Docs runtime and /api/docs machine routes.                                                      |
| examples/stripe-integration     | Stripe checkout, portal, session, webhooks.                                                     |
| examples/stripe-integrations/\* | Stripe with Prisma, Drizzle, SQLite, org billing.                                               |
| examples/farm-auth              | Built-in Farm Auth config, client APIs, sessions, and local SQLite.                             |
| examples/jobs-trigger           | Trigger.dev jobs runtime.                                                                       |
| examples/jobs-inngest           | Inngest jobs runtime.                                                                           |
| examples/eve-agent              | Eve instructions, same-origin chat UI, managed development, and Vercel composition.             |
| examples/cf-agent               | Cloudflare Agent state, callable RPC, Wrangler development, and combined Worker deployment.     |

## Run one example

**Terminal**

```bash
pnpm --filter @farm.js/core build
pnpm --dir examples/basic install
pnpm --dir examples/basic dev
```

## What to verify

| Example type         | Things to click/test                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Basic routing        | Navigation, route params, layouts, and route config exports.                                                   |
| Renderer adapters    | Server HTML, hydration, native client state, and the typed greeting server call.                               |
| API routes           | Typed callers, validation errors, success responses, and generated types.                                      |
| Docs integration     | `/docs`, markdown mirrors, docs API routes, page actions, and search.                                          |
| Stripe               | Products, checkout redirect, portal redirect, session/status reads, and webhook handling.                      |
| Farm Auth            | Sign-up, sign-in, session read, logout, and authenticated server requests.                                     |
| Jobs                 | Trigger, batch trigger, schedule, status, and cancel calls.                                                    |
| Eve agent            | Farm page rendering, `/eve/v1/health`, streaming messages, and Vercel output.                                  |
| Cloudflare agent     | Farm page rendering, WebSocket connection, synchronized state, callable RPC, and Wrangler dry-run deployment.  |
| Cron                 | A schedule in `farm.config.ts` mapped to a protected API route.                                                |
| Internationalization | Locale URLs, browser and cookie detection, translated server/client content, RTL, and generated message types. |
| Markdown             | `.md` mirrors for public pages and cache headers.                                                              |

## Example-driven development

When adding a new framework feature, add or update an example that proves the whole flow works:

1. Config in `farm.config.ts`.
2. Route/page files under `src/app`.
3. Client interaction when the feature has UI.
4. Build or dev-server validation.
5. Docs content that explains the same shape.

Examples should be small but complete enough that a user can copy the pattern into a real app.
