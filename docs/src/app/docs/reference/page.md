---
title: "Reference"
description: "A compact map of the main package exports and where to learn more."
section: "Reference"
---

# Reference

A compact map of the main package exports and where to learn more.

## Core exports

| Export area | What it covers |
| --- | --- |
| @farmjs/core | Config, app types, plugins, integrations, routing, OpenAPI, docs, cache. |
| @farmjs/core/client | Link, router helpers, API client, integration client. |
| @farmjs/core/navigation | Next-compatible redirect, notFound, and client navigation hooks. |
| @farmjs/core/headers | Next-compatible request headers and cookies helpers. |
| @farmjs/core/router | Lightweight route matching, href building, and active-route checks. |
| @farmjs/core/query | Query and route param types. |
| @farmjs/core/storage | Storage clients and mount helpers. |
| @farmjs/core/cache | Data cache, revalidation, cache keys. |
| @farmjs/core/after | Post-response server work with `after()`. |
| @farmjs/integrations | Auth, billing, email, jobs, AI, API keys, provider clients. |

## Recommended reading path

1. Start with Getting Started and Project Structure.
2. Read Routing, Layouts, and Rendering Model.
3. Add API Routes, API Client, and Query.
4. Choose integrations and storage once your product needs them.
5. Finish with Deployment, Observability, and Reference.

## Integration exports

| Package | Exports |
| --- | --- |
| `@farmjs/core` | `defineIntegration`, `integrationRoute`, `defineIntegrationSchema`, `definePlugin`, `defineConfig`. |
| `@farmjs/core/workflows` | `defineCron`, `defineWorkflow`, `defineTask` for lightweight scheduled and manually-triggered server workflows. |
| `@farmjs/core/client` | `createIntegrations`, `createIntegrationClient`, `createIntegrationServerClient`, `endpoint`. |
| `@farmjs/core/navigation` | `redirect`, `permanentRedirect`, `notFound`, `useRouter`, `usePathname`, `useSearchParams`. |
| `@farmjs/core/headers` | `headers`, `cookies`. |
| `@farmjs/core/router` | `createFarmRouter`, `matchFarmRoute`, `buildFarmRoutePath`, `isFarmRouteActive`. |
| `@farmjs/core/storage` | `sqliteStorage`, `postgresStorage`, `redisStorage`, `createStorageClient`, `defineStorageClient`. |
| `@farmjs/core/after` | `after` for short work that starts after the current response finishes. |
| `@farmjs/integrations/stripe` | Stripe billing integration. |
| `@farmjs/integrations/auth` | Better Auth, Auth.js, Clerk, Auth0, WorkOS helpers when using the auth barrel. |
| `@farmjs/integrations/supabase` | Supabase auth integration. |
| `@farmjs/integrations/email` | Resend integration and email template helper. |
| `@farmjs/integrations/jobs` | Jobs integration, `task`, `defineTasks`, Trigger.dev runtime, Inngest runtime. |
| `@farmjs/integrations/unkey` | Unkey API key integration. |

## Mental model

- Pages and layouts are app UI.
- API routes are app-owned HTTP handlers.
- API clients are typed callers for app routes.
- Integrations are provider or feature packages that can own routes, callers, schemas, providers, config, and lifecycle.
- Plugins are framework-level hooks for request, render, build, and runtime behavior.
- Storage is the shared place to pass key/value stores and runtime database clients.
