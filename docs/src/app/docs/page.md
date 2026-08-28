---
title: "Farm.js Documentation"
description: "The complete Farm.js framework guide, powered by @farming-labs/docs."
---

# Farm.js Documentation

Farm.js docs are served from the Farm docs runtime. The same markdown files power human pages, markdown routes, llms.txt, sitemap output, search, and agent discovery through `/api/docs`.

### Start

Create an app and learn the files that matter.

- [Getting Started](/docs/getting-started): Create a Farm.js app, understand the files that matter, and run the development server.
- [Project Structure](/docs/project-structure): The compact file layout Farm expects, plus the optional files you add only when the app needs them.
- [Configuration](/docs/configuration): Use farm.config.ts as the single project control plane for source paths, integrations, docs, KV storage, database clients, deployment, and framework behavior.
- [Renderers](/docs/renderers): Choose React, Preact, Solid, Vue, or Svelte and review the cross-renderer feature-support matrix.

### Core

Routes, rendering, layouts, and request flow.

- [Routing](/docs/routing): Farm uses an app directory routing model with static routes, dynamic segments, catch-all routes, and typed navigation.
- [Fonts](/docs/fonts): Compile local or remote fonts into self-hosted, hashed assets with generated CSS and no loader runtime.
- [Themes](/docs/themes): Configure light, dark, and system color modes with a pre-paint selector, Tailwind variants, and typed client and server APIs.
- [Layouts and Route Boundaries](/docs/layouts): Wrap routes with root and nested layouts, then use loading, error, and not-found files for route-level UX.
- [Rendering Model](/docs/server-rendering): Choose dynamic rendering, static rendering, ISR, or PPR with route-level exports and config.
- [React Renderer](/docs/renderers/react): Use the default renderer with the complete FARMJS client API, integrations, and experimental Server Components.
- [Preact Renderer](/docs/renderers/preact): Use Preact hooks, streaming SSR, hydration, and React-compatible FARMJS client APIs.
- [Solid Renderer](/docs/renderers/solid): Use Solid signals, SSR, hydration, and renderer-neutral FARMJS server primitives.
- [Vue Renderer](/docs/renderers/vue): Use Vue SFCs, SSR, hydration, and typed FARMJS server calls.
- [Svelte Renderer](/docs/renderers/svelte): Use Svelte 5 components, runes, SSR, hydration, and typed FARMJS server calls.
- [Built-in Authentication](/docs/auth): Enable email/password auth, sessions, server helpers, and React APIs with the top-level `auth` framework config.
- [Middleware](/docs/middleware): Run request behavior before routes, pass request-scoped data to pages, and short-circuit with redirects or responses.
- [Environment Functions](/docs/environment-functions): Remove server-only or client-only implementations from the opposite bundle while preserving one typed interface.

### Data and APIs

Typed params, API routes, API callers, KV storage, and database access.

- [Query and Params](/docs/query): Parse search params and route params with typed helpers on the server and synchronized state on the client.
- [API Routes](/docs/api-routes): Expose HTTP handlers from src/app/api and validate input with schemas before handler code runs.
- [API Client](/docs/api-client): Call app API routes with api.hello.get style inference, cache policies, invalidation, retries, callbacks, and optimistic updates.
- [Server Queries](/docs/server-queries): Define typed server reads once, deduplicate requests, prefetch browser data, use SWR, and share invalidation keys with routes and APIs.
- [KV Storage](/docs/storage): Use `getStorage()` for caches, settings, counters, idempotency records, and object-backed values.

### Integrations

Provider integrations and custom integration contracts.

- [Integrations](/docs/integrations): Register services once, get owned routes, typed callers, providers, middleware, database models, lifecycle hooks, and validation.
- [Stripe Integration](/docs/integrations/stripe): Add checkout, portal sessions, billing status, webhooks, product catalogs, metering, and database-backed billing snapshots.
- [Autumn Integration](/docs/integrations/autumn): Add subscription, entitlement, and usage billing with schema-backed database records through the integration ORM.
- [Polar Integration](/docs/integrations/polar): Use Polar for products, checkout, customer portals, subscriptions, webhooks, and entitlement-aware app flows.
- [Auth Integrations](/docs/integrations/auth): Choose built-in Farm Auth or an explicit Better Auth, Auth.js, Clerk, Auth0, WorkOS, or Supabase integration.
- [Email Integration](/docs/integrations/email): Render React Email templates, send with Resend, schedule messages, preview templates, and receive webhooks.
- [Jobs Integration](/docs/integrations/jobs): Define typed tasks once and run them through Trigger.dev or Inngest with trigger, schedule, batch, status, and cancel APIs.
- [Unkey Integration](/docs/integrations/unkey): Create, verify, revoke, update, and delete API keys, plus protect routes with key verification and rate-limit checks.
- [UI Registry](/docs/integrations/ui-registry): Opt into shadcn-style UI scaffolds for built-in integrations when you want working screens with the integration setup.
- [Database and ORM Clients](/docs/integrations/orm-storage): Use application-owned ORM models, schema-backed integration databases, and adapter-owned data without confusing them with KV storage.

### Runtime

Cache, PPR, observability, instant preview, and deployment output.

- [Post-response Work](/docs/after): Schedule short server work with after() without delaying the response.
- [Cache and PPR](/docs/cache-ppr): Use shared runtime cache helpers, tag/path invalidation, ISR-style revalidation, and static shell caching for PPR pages.
- [Observability](/docs/observability): Export OpenTelemetry traces and consume correlated Farm runtime events in development and production.
- [DevTools and Doctor](/docs/devtools): Inspect the resolved app runtime in the browser and run the same diagnostics from the terminal or CI.
- [Cron](/docs/cron): Map portable UTC schedules to ordinary API routes, run them locally, and compile them to deployment-native triggers.
- [Instant Preview](/docs/preview): Expose the current local app through a public URL for sharing, webhooks, OAuth callbacks, and external testing.
- [Deployment](/docs/deployment): Build deployable output with Farm's deploy config and Nitro presets, from first-class targets to custom Nitro output.

### Content

Docs runtime, markdown mirrors, and OpenAPI.

- [Docs Engine](/docs/docs-engine): Serve a @farming-labs/docs-inspired docs runtime from Farm config, including human pages and agent-readable API routes.
- [Markdown Mirrors](/docs/markdown): Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.
- [OpenAPI Reference](/docs/openapi): Generate and publish API reference docs from Farm API route metadata, with Scalar-style presentation.

### Plugin ecosystem

Plugin system and lifecycle hooks.

- [Plugin Ecosystem](/docs/plugins): Extend server and browser behavior across config, requests, routing, rendering, hydration, navigation, builds, and HMR.
- [PWA Plugin](/docs/plugins/pwa): Generate a route-aware service worker with offline navigation, update prompts, and concise SWR image caching.
- [Sentry Plugin](/docs/plugins/sentry): Report server errors with route context and trace Farm requests with `@sentry/node`.
- [Create a Plugin](/docs/plugins/create-plugin): Build a plugin with definePlugin when app behavior belongs in reusable framework lifecycle hooks.
- [Client Plugin API](/docs/plugins/client): Attach typed hydration, navigation, error, performance, and cleanup hooks to a plugin through a browser-safe module.

### Migrations

Move an existing framework app to Farm with inspectable, dry-run-first migrations.

- [Migration Overview](/docs/migrations): Choose a source framework, distinguish automated from manual migrations, and follow a safe migration workflow.
- [Migrate from Next.js](/docs/migrations/nextjs): Move App Router files, common Next.js imports, middleware, scripts, and Farm setup.
- [Migrate from SvelteKit](/docs/migrations/sveltekit): Map SvelteKit routes, layouts, load functions, endpoints, hooks, environment variables, and adapters into Farm.
- [Migrate from Nuxt](/docs/migrations/nuxt): Map Nuxt pages, layouts, server routes, data composables, middleware, runtime configuration, and Nitro output into Farm.
- [Migrate from TanStack Start](/docs/migrations/tanstack): Convert TanStack Router file routes, route paths, component exports, scripts, and Farm setup.

### Reference

CLI, testing, examples, and package map.

- [CLI](/docs/cli): Use the Farm CLI to run, build, generate types, migrate apps, deploy output, and add integrations.
- [Examples](/docs/examples): Use the examples folder as executable docs for routing, RSC, docs, markdown, auth, billing, email, jobs, and API keys.
- [Reference](/docs/reference): A compact map of the main package exports and where to learn more.
