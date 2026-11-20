---
title: "Migrations"
description: "Compare Farm.js performance, developer tools, agent capabilities, integrations, and migration tradeoffs for Next.js, TanStack Start, SvelteKit, and Nuxt."
section: "Migrations"
---

# Migrations

Move an existing app to Farm with a source-specific guide. This section covers every framework in
the homepage comparison: Next.js, SvelteKit, Nuxt, and TanStack Start.

## What you gain with Farm.js

**One framework for UI, server data, deployment, and agents.** Farm combines its own compiler,
rendering, and data features with typed routes and integrations. Start with the capabilities your
app needs; the compiler and experimental rendering modes are opt-in.

### Core features

- **Farm's React compiler.** The [experimental compiler](/docs/renderers/react#aot-compiler)
  in `@farm.js/react` prepares eligible components at build time so supported updates touch only
  the affected DOM bindings. Opt in with `react({ compiler: true })`; unsupported components
  keep React's normal rendering path.
- **Islands and islx.** Farm's [experimental islands mode](/docs/server-rendering/islands)
  sends server HTML and hydrates client components, using Farm's islx format instead of a React
  Flight payload. It keeps static content out of the client component tree.
- **Rendering and caching per route.** Choose [server rendering or static output](/docs/server-rendering),
  timed revalidation, and [shared cache invalidation](/docs/cache-ppr). Experimental partial
  prerendering caches a page shell while dynamic sections load.
- **Typed server data.** [Validated endpoints](/docs/api-routes) generate
  [typed callers](/docs/api-client). [Server queries](/docs/server-queries) add deduplication,
  prefetching, and shared invalidation; calling them from the browser requires the server-function
  transform described in that guide.
- **Development through production.** Vite powers development; Nitro packages production output
  for [Node, Vercel, Cloudflare, and Netlify](/docs/deployment), with additional Nitro presets.
  `farm deploy --plan` shows the deployment plan before it runs.

### Developer experience

- **Generated types.** Routes, APIs, environment values, and
  [i18n messages](/docs/internationalization) get declarations from the application itself.
  `farm generate --check` catches stale output in CI.
- **Inspect the running app.** `farm doctor`, `farm explain /products/42`,
  [DevTools](/docs/plugins/devtools), and [Hints](/docs/plugins/hints) explain configuration,
  routes, served code, and page problems.
- **Reuse application foundations.** [Layers](/docs/layers), [themes](/docs/themes),
  [storage](/docs/storage), and [cron](/docs/cron) share conventions across projects.
  `farm add integration` wires supported services into their routes, types, and lifecycle.
- **Share and extend.** [Preview tunnels](/docs/cli#instant-preview) expose a local app to a
  teammate or device. [Desktop](/docs/desktop) and the [mobile preview](/docs/mobile) extend
  the project with their documented platform limits.

### Agent native at the core

**Agent readability and discovery are built into `@farm.js/core`.** On the normal page-serving
pipeline, these defaults work without an agent integration or a separate MCP server:

- [Markdown mirrors](/docs/markdown), [`llms.txt`, sitemap, and JSON-LD](/docs/configuration#agent-readiness)
  make eligible public content readable and discoverable.
- [Read-only MCP](/docs/configuration#default-mcp-server) lists, searches, and reads eligible
  public static pages through `/mcp`.
- The [app manifest](/docs/configuration#app-manifest) describes installed capabilities;
  the [AI catalog](/docs/configuration#ai-catalog) advertises available MCP servers.
  The [API catalog](/docs/configuration#api-catalog) is a separate opt-in.

Configure or disable these through `md` and `agent` in `farm.config.ts`. The docs engine supplies
its own indexes and MCP server; an application's own MCP server takes precedence. API-only apps
have no page-derived defaults. The experimental React RSC pipeline does not yet serve the default
read-only MCP endpoint.

To let agents act, explicitly configure [API tools](/docs/plugins/mcp), experimental
[browser tools](/docs/plugins/webmcp), or [durable agent execution](/docs/integrations/agent).
Discovery does not grant write access. Use `farm agent check` to inspect the running app, and the
[agent-framework guide](/docs/integrations/agent-frameworks) to connect an existing agent runtime.

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
