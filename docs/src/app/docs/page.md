---
title: "Farm.js Documentation"
description: "The complete Farm.js framework guide, powered by @farming-labs/docs."
---

# Farm.js Documentation

Farm.js docs are served from the Farm docs runtime. The same markdown files power human pages, markdown routes, llms.txt, sitemap output, search, and agent discovery through `/api/docs`.

## Sections

### Start

Create an app and learn the files that matter.

- [Getting Started](/docs/getting-started): Create a Farm.js app, understand the files that matter, and run the development server.
- [Project Structure](/docs/project-structure): The compact file layout Farm expects, plus the optional files you add only when the app needs them.
- [Configuration](/docs/configuration): Use farm.config.ts as the single project control plane for source paths, integrations, docs, storage, deployment, and framework behavior.

### Core

Routes, rendering, layouts, and request flow.

- [Routing](/docs/routing): Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation.
- [Layouts and Route Boundaries](/docs/layouts): Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX.
- [Rendering Model](/docs/server-rendering): Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.
- [Middleware](/docs/middleware): Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.
- [Environment Functions](/docs/environment-functions): Remove server-only or client-only implementations from the opposite bundle while preserving one typed interface.

### Data and APIs

Typed params, API routes, API callers, and storage.

- [Query and Params](/docs/query): Parse search params and route params with typed helpers on the server and synchronized state on the client.
- [API Routes](/docs/api-routes): Expose HTTP handlers from src/app/api and validate input with schemas before handler code runs.
- [API Client](/docs/api-client): Call app API routes with api.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates.
- [Server Queries](/docs/server-queries): Define typed server reads once, deduplicate requests, prefetch browser data, use SWR, and share invalidation keys with routes and APIs.
- [Storage](/docs/storage): Use Farm storage clients for key-value data and pass storage clients to framework features and integrations.

### Integrations

Provider integrations and custom integration contracts.

- [Integrations](/docs/integrations): Register services once, get owned routes, typed callers, providers, middleware, storage access, lifecycle hooks, and validation.
- [Stripe Integration](/docs/integrations/stripe): Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and storage-backed billing snapshots.
- [Autumn Integration](/docs/integrations/autumn): Add subscription, entitlement, and usage billing while keeping Farm's integration API and storage layer.
- [Polar Integration](/docs/integrations/polar): Use Polar for products, checkout, customer portals, subscriptions, webhooks, and entitlement-aware app flows.
- [Auth Integrations](/docs/integrations/auth): Use Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase without hand-rolling every auth route.
- [Email Integration](/docs/integrations/email): Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks.
- [Jobs Integration](/docs/integrations/jobs): Define typed tasks once and run them through Trigger.dev or Inngest with trigger, schedule, batch, status, and cancel APIs.
- [Unkey Integration](/docs/integrations/unkey): Create, verify, revoke, update, and delete API keys, plus protect routes with key verification and rate-limit checks.
- [UI Registry](/docs/integrations/ui-registry): Opt into shadcn-style UI scaffolds for built-in integrations when you want working screens with the integration setup.
- [ORM Storage for Integrations](/docs/integrations/orm-storage): Pass one storage client through farm.config.ts and let integrations use ctx.args.db through the unified farming-labs/orm-style API.

### Runtime

Cache, PPR, observability, instant preview, and deployment output.

- [Post-response Work](/docs/after): Schedule short server work with after() without delaying the response.
- [Cache and PPR](/docs/cache-ppr): Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages.
- [Observability](/docs/observability): Listen to Farm runtime events for server lifecycle, route matching, rendering, API routes, integrations, storage, cache, PPR, builds, plugins, and errors.
- [Cron](/docs/cron): Map portable UTC schedules to ordinary API routes, run them locally, and compile them to deployment-native triggers.
- [Instant Preview](/docs/preview): Expose the current local app through a public URL for sharing, webhooks, OAuth callbacks, and external testing.
- [Deployment](/docs/deployment): Build deployable output with Farm's deploy config and Nitro presets, from first-class targets to custom Nitro output.

### Content

Docs runtime, markdown mirrors, and OpenAPI.

- [Docs Engine](/docs/docs-engine): Serve a @farming-labs/docs-inspired docs runtime from Farm config, including human pages and agent-readable API routes.
- [Markdown Mirrors](/docs/markdown): Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.
- [OpenAPI Reference](/docs/openapi): Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation.

### Extending

Plugin system and lifecycle hooks.

- [Plugin Ecosystem](/docs/plugins): Use server plugins to extend config, request handling, routing, rendering, bundling, HMR, and lifecycle hooks.
- [Create a Plugin](/docs/plugins/create-plugin): Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks.

### Reference

CLI, migrations, examples, and package map.

- [Migrations](/docs/migrations): Move Next.js and TanStack Router apps with dry-run codemods, then run schema/provider commands.
- [CLI](/docs/cli): Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations.
- [Examples](/docs/examples): Use the examples folder as executable docs for routing, RSC, docs, markdown, auth, billing, email, jobs, and API keys.
- [Reference](/docs/reference): A compact map of the main package exports and where to learn more.
