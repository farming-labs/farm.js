---
title: "Reference"
description: "A compact map of the main package exports and where to learn more."
section: "Reference"
---

# Reference

A compact map of the main package exports and where to learn more.

## Core exports

| Export area                   | What it covers                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| @farm.js/core                 | Config, app types, plugins, integrations, routing, OpenAPI, docs, cache.             |
| @farm.js/core/client          | Link, router helpers, callable route actions, API client, integration client.        |
| @farm.js/core/plugin/client   | Advanced browser lifecycle manager and client plugin event types.                    |
| @farm.js/core/navigation      | Next-compatible redirect, notFound, and client navigation hooks.                     |
| @farm.js/core/headers         | Next-compatible request headers and cookies helpers.                                 |
| @farm.js/core/router          | Lightweight route matching, href building, and active-route checks.                  |
| @farm.js/core/query           | Query and route param types.                                                         |
| @farm.js/core/storage         | Key/value clients, drivers, mounts, and `getStorage()`.                              |
| @farm.js/core/cache           | Data cache, revalidation, cache keys.                                                |
| @farm.js/cache-redis          | Distributed Redis cache, tag versions, and regeneration leases.                      |
| @farm.js/core/after           | Post-response server work with `after()`.                                            |
| @farm.js/core/cron            | Cron route authorization, schedule types, manifests, and deployment adapter helpers. |
| @farm.js/core/observability   | Farm events, request tracing, custom spans, and active trace context.                |
| @farm.js/core/instrumentation | Startup and shutdown convention types for development and production runtimes.       |
| @farm.js/otel                 | Optional Node OpenTelemetry SDK, OTLP exporter, and auto-instrumentation setup.      |
| @farm.js/preact               | Preact renderer descriptor, streaming SSR, hydration, and Vite integration.          |
| @farm.js/solid                | Solid renderer descriptor, SSR runtime, browser hydration, and Vite integration.     |
| @farm.js/vue                  | Vue renderer descriptor, SFC compilation, SSR runtime, and browser hydration.        |
| @farm.js/svelte               | Svelte renderer descriptor, component compilation, SSR, and browser hydration.       |
| @farm.js/integrations         | Auth, billing, email, jobs, AI, API keys, provider clients.                          |

## Recommended reading path

1. Start with Getting Started and Project Structure.
2. Choose a renderer, then read Routing, Layouts, and Rendering Model.
3. Add API Routes, API Client, and Query.
4. Choose integrations, KV storage, and database ownership once your product needs them.
5. Finish with Deployment, Observability, and Reference.

## Integration exports

| Package                          | Exports                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@farm.js/core`                  | `defineIntegration`, `integrationRoute`, `defineIntegrationSchema`, `definePlugin`, `defineConfig`.        |
| `@farm.js/core/theme/client`     | `useTheme`, `getTheme`, `setTheme`, and `toggleTheme` for browser color-mode state.                        |
| `@farm.js/core/theme/server`     | `getTheme` and `getThemeSnapshot` for cookie-backed server rendering.                                      |
| `@farm.js/core/cron`             | `cronRoute`, cron config types, schedule manifests, and deployment adapter helpers.                        |
| `@farm.js/core/workflows`        | Legacy workflow-module APIs kept for compatibility. New schedules should use `cron` config and API routes. |
| `@farm.js/core/client`           | `useAction`, `createIntegrations`, `createIntegrationClient`, `createIntegrationServerClient`, `endpoint`. |
| `@farm.js/core/plugin/client`    | `createClientPluginManager` and browser lifecycle types for advanced tooling.                              |
| `@farm.js/core/navigation`       | `redirect`, `permanentRedirect`, `notFound`, `useRouter`, `usePathname`, `useSearchParams`.                |
| `@farm.js/core/font`             | Build-time `localFont` and `remoteFont` loaders with generated CSS, hashed assets, and preload hints.      |
| `@farm.js/core/headers`          | `headers`, `cookies`.                                                                                      |
| `@farm.js/core/router`           | `createFarmRouter`, `matchFarmRoute`, `buildFarmRoutePath`, `isFarmRouteActive`.                           |
| `@farm.js/core/storage`          | `sqliteStorage`, `postgresStorage`, `redisStorage`, `createStorageClient`, `defineStorageClient`.          |
| `@farm.js/cache-redis`           | `redisCache` distributed cache adapter.                                                                    |
| `@farm.js/core/after`            | `after` for short work that starts after the current response finishes.                                    |
| `@farm.js/integrations/stripe`   | Stripe billing integration.                                                                                |
| `@farm.js/integrations/auth`     | Better Auth, Auth.js, Clerk, Auth0, WorkOS helpers when using the auth barrel.                             |
| `@farm.js/integrations/supabase` | Supabase auth integration.                                                                                 |
| `@farm.js/integrations/email`    | Resend integration and email template helper.                                                              |
| `@farm.js/integrations/jobs`     | Jobs integration, `task`, `defineTasks`, Trigger.dev runtime, Inngest runtime.                             |
| `@farm.js/integrations/unkey`    | Unkey API key integration.                                                                                 |

## Mental model

- Pages and layouts are app UI.
- API routes are app-owned HTTP handlers.
- API clients are typed callers for app routes.
- Integrations are provider or feature packages that can own routes, callers, schemas, providers, config, and lifecycle.
- Plugins are framework-level hooks for server requests, rendering, builds, browser hydration, navigation, and runtime behavior.
- KV storage uses `getStorage()` for values addressed by string keys.
- Application models use an application-owned ORM; schema-backed integrations use `ctx.args.db`.
- The current beta `storage.client` config name also accepts a raw integration database client, but that client is not a KV mount.
- Cron maps a UTC schedule to an app-owned GET API route; it does not add durable workflow state.
