---
title: "Migrations"
description: "Compare Farm.js performance, developer tools, agent capabilities, integrations, and migration tradeoffs for Next.js, TanStack Start, SvelteKit, and Nuxt."
section: "Migrations"
---

# Migrations

Move an existing app to Farm with a source-specific guide. This section covers every framework in
the homepage comparison: Next.js, SvelteKit, Nuxt, and TanStack Start.

## What you gain with Farm.js

**Farm.js is agent native at the core: one application serves people and agents.**
`@farm.js/core` connects page rendering, metadata, discovery, and read-only agent access to the
same route tree. Public pages can be read and discovered without installing an agent integration
or writing a separate MCP server.

Keep the component model you know and bring routing, validated APIs, typed callers, service
integrations, and deployment into the same framework contract. The benefit is less application
code connecting those pieces, with tools to inspect what the framework actually resolved.

Each source guide explains the reasons to move before the migration steps. Read its performance
evidence and compatibility limits together: a faster fixture build is useful evidence, but it
does not guarantee a faster application after migration.

### Developer experience

Developer experience (DX) includes the work between writing a component and running it in
production:

- **Types across the application.** Farm generates route, API, environment, and i18n declarations.
  A validated endpoint can supply the browser caller's input and result types; you do not need to
  maintain a second handwritten request contract. See [API Routes](/docs/api-routes),
  [API Client](/docs/api-client), and [Internationalization](/docs/internationalization).
- **A shorter diagnosis loop.** `farm doctor` checks the resolved app, `farm explain /products/42`
  explains one URL, and `farm generate --check` catches stale generated declarations in CI.
  [DevTools](/docs/plugins/devtools) shows routes, APIs, integrations, plugin order, and source
  alongside the JavaScript Vite served. [Hints](/docs/plugins/hints) checks the live page for
  accessibility, performance, and HTML problems.
- **Product services with owned wiring.** An [integration](/docs/integrations) can register its
  endpoints, typed callers, validation, middleware, and startup/shutdown behavior together.
  `farm add integration` adds supported adapters and optional UI. Keep an existing SDK client
  where the adapter supports `instance`.
- **Shared foundations.** [Layers](/docs/layers) reuse routes, layouts, config, plugins, and
  integrations across applications. [Themes](/docs/themes), typed i18n, [storage](/docs/storage),
  [cron](/docs/cron), and [jobs](/docs/integrations/jobs) cover recurring application work.
- **Deployment and previews from the same project.** Use the first-class Node, Vercel, Cloudflare,
  and Netlify [targets](/docs/deployment), or a supported Nitro preset. `farm deploy --plan`
  makes the deployment plan inspectable. [Preview tunnels](/docs/cli#instant-preview) give a
  running local app a public URL for a teammate, webhook, or device.

[Desktop apps](/docs/desktop) and the [mobile preview](/docs/mobile) extend the project further.
Read their platform limits before planning a native application; they are not a promise that
every web component becomes a native screen.

### Agent native at the core

Agent experience (AX) means making the application understandable and usable by software agents,
as well as giving a coding agent enough information to work on it accurately.

**The core provides the reading and discovery surface by default.** On Farm's normal page-serving
pipeline, pages have Markdown mirrors; eligible static pages feed `llms.txt` and the sitemap;
metadata supplies JSON-LD; and `/mcp` provides `list_pages`, `search_pages`, and `read_page`.
The app manifest and AI catalog describe the capabilities and MCP servers the app already serves.
These are core features configured through `md` and `agent` in `farm.config.ts`.

The docs engine supplies its own page indexes and MCP server, and an application's own MCP server
takes precedence. API-only apps do not enable the page-derived defaults, and the experimental
React RSC pipeline does not yet serve the default read-only MCP endpoint. Individual core
features can be configured or disabled; discovery never grants permission to act.

| Capability                                              | What it gives you                                                                             | Boundary                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Markdown mirrors](/docs/markdown)                      | A readable representation of pages through a `.md` URL or Markdown content negotiation.       | Configure what may be exposed; authentication still applies.                                     |
| [Discovery](/docs/configuration#agent-readiness)        | Generated `llms.txt`, sitemap, and metadata-derived JSON-LD.                                  | Generated indexes cover eligible pages, not every possible dynamic URL.                          |
| [Read-only MCP](/docs/configuration#default-mcp-server) | List, search, and read public static pages through `/mcp`.                                    | It steps aside for your own MCP server; it grants no write access.                               |
| [App manifest](/docs/configuration#app-manifest)        | A machine-readable description of installed capabilities at `/.well-known/farmjs.json`.       | Disclosure can be reduced or disabled; it is not a credential.                                   |
| [AI catalog](/docs/configuration#ai-catalog)            | Core publishes MCP discovery at `/.well-known/ai-catalog.json` and server cards.              | On by default when an MCP server is present; listing a server does not bypass its authorization. |
| [API catalog](/docs/configuration#api-catalog)          | Core can advertise enabled OpenAPI and top-level MCP endpoints at `/.well-known/api-catalog`. | Opt in with `agent.apiCatalog`; OpenAPI and callable tools have their own configuration.         |
| [API MCP](/docs/plugins/mcp)                            | Explicitly selected endpoints and tools share validation and an authorization policy.         | Install and configure it; ordinary API routes do not become tools automatically.                 |
| [WebMCP](/docs/plugins/webmcp)                          | Named browser actions while the page is open, using its session.                              | Experimental browser API; requires support, explicit registration, and server authorization.     |
| [Agent runtimes](/docs/integrations/agent)              | Agent files, durable steps, pauses, and external-event waits beside the app.                  | Opt-in integration with storage and authorization; provider/runtime requirements still apply.    |

**Callable tools and agent execution are explicit extensions.** API MCP uses `@farm.js/mcp` and
selected tools; WebMCP uses `@farm.js/webmcp` and browser registration; durable execution uses an
agent integration. They build on the core's route, validation, and lifecycle contracts. Installing
Farm does not automatically expose mutations or run an agent on your behalf.

Use `farm agent check` to inspect the running application's agent surface. For a coding agent,
the expanded migration guides below supply feature mappings and verification gates. For an agent
running inside your product, keep model keys and privileged tools in server modules. The
[agent-framework guide](/docs/integrations/agent-frameworks) shows how existing frameworks fit
behind Web `Request`/`Response` routes.

### Integrations for the product, plugins for the framework

Use integrations for services: authentication with [Better Auth](/docs/integrations/auth/better-auth)
or [Clerk](/docs/integrations/auth/clerk); billing with [Stripe](/docs/integrations/stripe),
[Polar](/docs/integrations/polar), or [Autumn](/docs/integrations/autumn); email with
[Resend](/docs/integrations/email); background work with [Jobs](/docs/integrations/jobs),
[Trigger.dev](/docs/integrations/trigger), or [Inngest](/docs/integrations/inngest); and data or
agent services from the [integration catalog](/docs/integrations).

Use plugins when you want to change how the framework builds, serves, or observes the app:

| Need                            | Relevant plugins and extension APIs                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspect and control performance | [Analyzer](/docs/plugins/analyzer), [DevTools](/docs/plugins/devtools), [Hints](/docs/plugins/hints).                                            |
| Refine navigation               | [Prefetch](/docs/plugins/prefetch), [Progress](/docs/plugins/progress), [Scroll restoration](/docs/plugins/scroll-restoration).                  |
| Publish content and find it     | [Content](/docs/plugins/content), [Search](/docs/plugins/search).                                                                                |
| Work offline                    | [PWA](/docs/plugins/pwa) for navigation and assets; [Sync](/docs/plugins/sync) for row-level data and queued writes.                             |
| Manage browser SDKs             | [Scripts](/docs/plugins/scripts) for consent and loading; [Partytown](/docs/plugins/partytown) for opted-in worker execution.                    |
| Operate the server              | [Health](/docs/plugins/health), [Sentry](/docs/plugins/sentry), and community-maintained [Blyp](/docs/plugins/blyp).                             |
| Protect forms and test requests | [Bot protection](/docs/plugins/bot), [MSW](/docs/plugins/msw).                                                                                   |
| Extend the build and browser    | [StyleX](/docs/plugins/stylex), [WebAssembly](/docs/plugins/wasm), [Federation](/docs/plugins/federation).                                       |
| Expose agent tools              | [API MCP](/docs/plugins/mcp), [WebMCP](/docs/plugins/webmcp).                                                                                    |
| Build your own extension        | [Server/build hooks](/docs/plugins/create-plugin), [client hooks](/docs/plugins/client), and [schema-owned tables](/docs/plugins/schema-tables). |

Install the capabilities the application uses. Check each plugin's renderer and runtime
requirements; a React provider or example is not automatically a Vue or Svelte component.

## Read the performance evidence

The guides compare different workloads:

- The [Next.js guide](/docs/migrations/nextjs#performance-and-build-cost) summarizes November
  2026 measurements of a real documentation site, Vercel deploys, and a separate four-page
  application. It separates observed build charges from projected
  runtime costs and self-hosted throughput from CDN delivery.
- The [TanStack Start](/docs/migrations/tanstack#performance-evidence),
  [Nuxt](/docs/migrations/nuxt#performance-evidence), and
  [SvelteKit](/docs/migrations/sveltekit#performance-evidence) guides use the checked-in
  five-framework SSR fixture. Its Farm arm uses React, so it does not measure Farm's Vue or
  Svelte renderer. SvelteKit wins some of its server timings.

Record your own baseline before moving: startup to usable page, edited component to visible
result, cold and warm builds, transferred assets, and production latency. Keep route content,
authentication, rendering mode, compression, and deployment target equivalent. A migration is
successful when the application preserves its behavior and improves the costs that matter to you.

## Choose a source

React apps keep their components, since React is Farm's default renderer. Nuxt applications can retain Vue SFCs through `@farm.js/vue`,
and SvelteKit applications can retain Svelte components through `@farm.js/svelte` while their
framework-specific modules are adapted.

| Source                                      | Renderer          | Guide covers                                                                        |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| [Next.js](/docs/migrations/nextjs)          | React (built in)  | App Router files, server actions, route handlers, metadata, middleware, and config. |
| [TanStack Start](/docs/migrations/tanstack) | React (built in)  | File routes, the root route, loaders, server functions, and server routes.          |
| [SvelteKit](/docs/migrations/sveltekit)     | `@farm.js/svelte` | Routes, layouts, load functions, form actions, endpoints, hooks, and adapters.      |
| [Nuxt](/docs/migrations/nuxt)               | `@farm.js/vue`    | Pages, layouts, server routes, data composables, middleware, and runtime config.    |

## Migrate with a coding agent

Every guide has an expanded Markdown version written for coding agents. It maps each feature of
the source framework to its Farm equivalent, marks what works unchanged, what needs a rewrite, and
what has no direct equivalent, and ends with a verification checklist.

Request any guide with a `.md` suffix, or send `Accept: text/markdown`:

```bash
curl https://farmjs.dev/docs/migrations/nextjs.md
```

Then hand the URL to your agent:

```txt
Migrate this app to Farm. Follow https://farmjs.dev/docs/migrations/nextjs.md and run its
verification checklist before removing Next.js.
```

Replace `nextjs` with `tanstack`, `sveltekit`, or `nuxt` for the other sources.

## Workflow

Each guide works as a checklist:

1. Create a branch and keep the existing app runnable.
2. Add Farm and the matching renderer, and create `farm.config.ts`.
3. Move routes into `src/app`, starting with the root layout.
4. Replace framework-specific imports, data loading, mutations, and middleware one feature at a time.
5. Run the app in development and production, and compare every route with the old app.
6. Remove the previous framework only after the Farm build behaves the same in production.

## Ground rules

- Farm's app directory is `src/app`, and the `@/` import alias points at `src`.
- Production output lives in `.farm/.output`. The start script is
  `node .farm/.output/server/index.mjs`, the same as in new Farm projects.
- Delete the previous framework's `vite.config.*` once its plugins are no longer needed. Move any
  options you still want into the `vite` field of `farm.config.ts`.
- Pin exact Farm versions. Package managers with a minimum release age, such as pnpm 11 and later,
  can resolve `latest` to an older release for a day after a publish.
- Unsupported APIs should be rewritten deliberately rather than shimmed. Each guide lists the
  closest Farm equivalent.
