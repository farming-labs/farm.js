---
title: "Farm.js v0.1.0: Stable, Integrated, and Agent-Native"
description: "Our first stable release. Built for apps and agents."
---

# Farm.js v0.1.0: Stable, Integrated, and Agent-Native

KinfeMichael Tariku · Oct 2026

Farm.js 0.1 is out. It is the first release with a compatibility promise, and the first one I am comfortable calling stable.

It is also a good moment to show everything that landed during the betas, because Farm.js is a lot more than a router now. There is a DevTools workspace, an ecosystem of plugins and product integrations, five renderers, a CLI that explains and repairs your app, and apps that work for the agents reading and calling them.

The release snapshot: **18 provider integration options, 15 official plugins, composable MCP tools, and five renderers.** Those are separate capabilities, not a count inflated by compatibility exports or helper packages. Here is what they let you build.

<span id="what-stable-means" className="blog-heading-anchor" />

## What stable means

Patch releases (`0.1.1`, `0.1.2`) fix bugs. They do not break stable APIs, configuration, generated route types, or production output. Security fixes can tighten previously unsafe behavior; those changes are called out in the release notes.

A minor release (`0.2.0`) can change a stable API, but only after that API was deprecated in an earlier minor release, kept working, and documented with a migration path. Experimental features stay opt-in, can change in any release, and cost nothing when they are off.

- **Stable:** core, the CLI, the app generator, DevTools, the plugin API, and the first-party integrations. They release together at the same version.
- **Beta:** the Preact, Solid, Vue, and Svelte renderers, the separate `@farm.js/react` compiler/runtime package, and most plugins. Tested and supported, but their APIs can still move. The default React renderer is built into core and is stable.
- **Experimental:** React Server Components, Server Actions under RSC, Partial Prerendering, isolated hydration, the React compiler, API MCP, WebMCP, federation, and WebAssembly components.

Stable integrations promise compatibility for their Farm.js factory, configuration, routes, and typed callers. The external service still follows its own SDK and API contract. Keep core, the CLI, DevTools, and the integrations on matching shared-release versions; independently versioned renderer and plugin packages can remain in beta.

The full breakdown, including which deployment targets are verified and how, is on the [Stability and Support](https://farmjs.dev/docs/stability) page.

<span id="the-app-foundation" className="blog-heading-anchor" />

## The app foundation

The parts every product needs, typed end to end:

- **App-directory routing** with generated route types, layouts, route groups, and loading and error boundaries.
- **Typed APIs and data.** API routes produce a typed client (`apiClient.hello.get()`), and server queries give you deduplicated, prefetchable, invalidatable reads defined once on the server.
- **Server functions and mutations.** `createServerFn` gives shared server operations input and output validation. `createServerQuery` adds structured cache keys, stale-while-revalidate, and invalidation for reads. Browser references require the experimental server-function transform; without it, keep the handler on the server and call a typed API route. The [server-query guide](https://farmjs.dev/docs/server-queries) explains that boundary.
- **Rendering control.** Streaming SSR, static generation, ISR-style revalidation, shared cache helpers with tag and path invalidation, and per-route runtime, region, and duration hints.
- **Built-ins you would otherwise assemble:** internationalization with typed ICU messages and RTL, light and dark themes with a pre-paint selector, responsive images, self-hosted fonts, cron schedules that compile to each platform's native triggers, `after()` for post-response work, a KV storage layer, and layers for sharing app directories between projects.

Small browser enhancements do not need a hydrated component tree. An optional [`src/client.ts`](https://farmjs.dev/docs/project-structure#html-first-client-lifecycle) connects server-rendered HTML to Farm.js's browser lifecycle, including initial setup, navigation, and cleanup. It is how this blog keeps its copy controls and reading indicator working between pages.

<span id="five-renderers-one-framework" className="blog-heading-anchor" />

## Five renderers, one framework

React is the default. Preact, Solid, Vue, and Svelte use the same routing, APIs, middleware, integrations, and deployment. Choose one when you create an app with the CLI's `--renderer` option.

The other four are beta in 0.1, and a test-checked [capability matrix](https://farmjs.dev/docs/renderers) shows exactly what each one supports, including streaming per deployment target. Shared routing does not mean identical rendering features: Svelte currently buffers server rendering rather than streaming it. Check the matrix before choosing an adapter for a specific runtime.

<span id="an-integrations-ecosystem" className="blog-heading-anchor" />

## An integrations ecosystem

Integrations connect a service to the app: its configuration, routes, webhooks, typed callers, and lifecycle. You choose the provider and the name it has inside your app.

The CLI has **15 provider scaffolds**. Run `farm add integration --list` to see the choices, then add the ones you need. The [integrations guide](https://farmjs.dev/docs/integrations) covers setup for each provider.

<BlogFigure kind="integration" caption="One command writes the integration, registers it, and lists the environment it needs" />

The broader catalog covers **18 provider options across 17 dedicated packages**. Trigger.dev and Inngest share `@farm.js/jobs`; Eve, Cloudflare Agents, and Contentful have package-level setup rather than a `farm add integration` scaffold:

- **Auth · 6:** Better Auth, Auth.js, Clerk, Auth0, WorkOS, and Supabase.
- **Billing · 3:** Stripe, Autumn, and Polar.
- **Email · 1:** Resend.
- **Background jobs · 2:** Trigger.dev and Inngest.
- **Content · 2:** Sanity and Contentful.
- **API keys · 1:** Unkey.
- **AI and agents · 3:** AI SDK chat routes, Cloudflare Agents, and Eve.

Farm's built-in auth, UI registries, ORM support, and integration-authoring utilities are additional capabilities, not extra entries in that provider count.

### Bring your SDK, keep typed callers

Your app can own the provider SDK. Configure the real Stripe client yourself, then pass that instance to Farm.js. You keep control of SDK options such as retries; Farm adds the integration's routes, webhooks, and typed callers around it.

```ts
// src/lib/integrations.ts — server-only
import Stripe from "stripe";
import { stripe } from "@farm.js/stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
const priceId = process.env.STRIPE_PRO_PRICE_ID;
if (!secretKey || !priceId) {
  throw new Error("Set STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID.");
}

const stripeClient = new Stripe(secretKey, {
  maxNetworkRetries: 2,
});

export const integrations = {
  billing: stripe({
    instance: stripeClient,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    products: [{ id: "pro", priceId }],
  }),
};

export type AppIntegrations = typeof integrations;
```

`stripeClient` is the vendor's `Stripe` object, not a second Farm wrapper. The adapter uses the supplied `instance` instead of constructing another SDK client. Set your secret key and an existing Stripe price ID on the server; set `STRIPE_WEBHOOK_SECRET` to verify incoming webhook events. The SDK instance and credentials never belong in browser code.

Register the integration in `farm.config.ts`, then use typed callers to reach it. `billing` is the name you chose, not a hard-coded service name. The [caller guide](https://farmjs.dev/docs/api-client#integration-callers) covers the shared `createApiClients` setup and integration-only callers. Client modules import the registry's **type**, never its runtime value or credentials.

The [Stripe guide](https://farmjs.dev/docs/integrations/stripe) covers installation, registration, and the session and billing-owner checks required for checkout. An app-owned SDK does not bypass those checks. For hosted content, the [Sanity guide](https://farmjs.dev/docs/integrations/sanity) covers typed queries, images, and webhook invalidation.

Integrations can also scaffold working screens through a shadcn-style UI registry, and schema-backed integrations can share your relational models through [@farming-labs/orm](https://orm.farming-labs.dev).

This is not a closed catalog. Use [`defineIntegration`](https://farmjs.dev/docs/integrations/custom) to build an app-local adapter or publish a community package with the same typed routes, configuration validation, and lifecycle hooks. It does not have to live under Farming Labs.

<span id="a-plugin-ecosystem-starting-with-devtools" className="blog-heading-anchor" />

## A plugin ecosystem, starting with DevTools

**DevTools** ships in every new app. Open it from the button in the corner or with `Cmd + Shift + .` on macOS (`Ctrl + Shift + .` on Windows and Linux) to browse your routes and their runtime settings, inspect configured integrations, read runtime diagnostics, and compare your source with the JavaScript Vite actually served.

It is development-only: the plugin removes its UI, launcher, and inspection endpoints from production output. Snapshots show environment key names, not their values. Source code is still sensitive, so keep development servers on a trusted network. The [DevTools guide](https://farmjs.dev/docs/plugins/devtools) covers those boundaries.

There are **15 documented official plugins** in this release snapshot, including DevTools. The other 14 are:

- **Hints** finds accessibility, performance, and HTML problems in the live development page.
- **Analyzer** explains page, client, and server bundle size and enforces limits in CI.
- **Content** validates local Markdown, MDX, JSON, and YAML as typed collections.
- **Search** builds a chunked browser search index from your static pages.
- **PWA** generates a route-aware service worker for offline navigation and safe updates.
- **Sync** and the local-first patterns add instant cached reads, optimistic writes, and reconnect recovery on top of the API you already have.
- **Scripts** and **Partytown** load third-party SDKs with typed handles and consent, or move them off the main thread.
- **Sentry** reports errors and traces with Farm's route and event context.
- **StyleX**, **MSW**, **WebAssembly**, **federation**, and **WebMCP** cover styling, mocking, Wasm, independently deployed modules, and browser agent tools.

We count MCP separately: applications compose API endpoints and standalone tools through `mcp` in Farm config, or opt endpoints in with route-owned metadata. There is no plugin to register manually. OpenTelemetry instrumentation (`@farm.js/otel`), Redis cache adapters, and preview tooling are also available separately. These counts describe the release source, not 15 stable npm releases. Most plugins remain beta; MCP, WebMCP, federation, and WebAssembly are experimental. The stable framework plugin API does not make every plugin stable.

Plugins change how the framework builds, renders, or handles requests; integrations connect a service to your app. Both have public authoring APIs. The [plugin authoring guide](https://farmjs.dev/docs/plugins/create-plugin) is the starting point for your own build tooling, diagnostics, or runtime policies.

<span id="typed-content-collections" className="blog-heading-anchor" />

## Typed content collections

**`@farm.js/content`** gives blogs, changelogs, and documentation a typed publishing pipeline without a separate content configuration file. Markdown and MDX frontmatter—or complete JSON and YAML documents—go through your schema before the app uses them. It is a content plugin, not a hosted CMS, and remains independently versioned in beta.

Define collections in `farm.config.ts`, validate metadata with Zod or another Standard Schema validator, and read them from server code with `getCollection()`. Farm generates the types, including computed fields such as reading time. Invalid content fails validation with a useful error.

Local edits are watched in development; production serves a validated, bundled snapshot. Entries keep their Markdown body separate from typed metadata, so your app controls rendering. Managed assets get content-hashed URLs, and images include dimensions.

Already have a CMS? A `remote()` source can feed the same pipeline from an API or database, including Sanity and Contentful. Production remains a build-time snapshot: publish changes through a rebuild, rather than expecting live CMS reads on every request. The [Content guide](https://farmjs.dev/docs/plugins/content) covers sources, typed assets, static routes, and optional write callbacks.

<span id="local-first-data-with-sync" className="blog-heading-anchor" />

## Local-first data with Sync

**`@farm.js/sync`** turns a schema into rows that live in the browser. Reads render from a local store, writes show up before the server answers, edits made offline queue until the connection returns, and a revisit paints from disk instead of waiting on the network. It sits on top of your own database rather than replacing it, and it remains independently versioned in beta.

Declare a model once with `defineSchema`, then add `sync()` to `plugins` in `farm.config.ts` with the models the browser may read or write and a `where` row filter the server applies to every request. Field metadata does the rest: the primary key, enum validation before an optimistic write, and an `updatedAt` cursor so later loads only send changed rows.

In a client component, `useLiveQuery("tasks", …)` returns the matching rows, and `useSyncAction("tasks")` writes them. Model names and fields are generated from the schema, so a wrong name is a compile error. Each write updates every view of that row in the same frame, then persists in the background. A rejected write rolls back and lands in a `failures` queue with retry and dismiss, so nothing disappears silently.

`where` is the security boundary, enforced by the query rather than by trusting what the browser sent: a device only ever holds rows that passed the filter, columns the filter names are server-owned, and a writable model without a filter fails the build. Point `storage` at a Farm mount to start, or pass a `pg`, Drizzle, Prisma, D1, or Mongo client to sync against your real tables; `farm sync migrate` prints the SQL for a raw connection and never alters existing tables. The [Sync guide](https://farmjs.dev/docs/plugins/sync) covers incremental sync, existing tables, and failure handling, and the [local-first patterns](https://farmjs.dev/docs/local-first) cover what Farm's cache already does without a new package.

<span id="a-cli-that-explains-your-app" className="blog-heading-anchor" />

## A CLI that explains your app

- `farm doctor` checks your Node version, configuration, routes, deployment target, cron, and storage, and can probe a running deployment with `--url`.
- `farm explain /some/path` tells you which route handles a URL and where it runs.
- `farm preview` gives your local app a public URL for webhooks, OAuth callbacks, and testing on a phone.
- `farm migrate next` and `farm migrate tanstack` move an existing Next.js App Router or TanStack Start project over. Nuxt and SvelteKit have migration guides.
- `farm upgrade --latest` updates each Farm package to its latest published version, preserving independently versioned renderer and plugin releases.

<BlogFigure kind="preview" caption="farm preview gives localhost a public URL for phones, teammates, and webhooks" />

<span id="built-for-agents-too" className="blog-heading-anchor" />

## Built for agents too

An agent might need to read your content, discover an API, call a server tool, or act inside an open page. Those are different jobs. Farm.js provides a separate, explicit path for each.

### Read the same content as a person

**Pages have Markdown mirrors** by default. Ask with a `.md` suffix or an `Accept` header:

```bash
curl https://your-app.com/pricing.md
curl -H "Accept: text/markdown" https://your-app.com/pricing
```

A `page.tsx` route is rendered and converted; a `page.md` route returns its source; a `page.md` next to a `page.tsx` overrides the generated version while browsers still get the React page. Missing routes answer agents in Markdown too.

### Discover the app and its documentation

Enable [OpenAPI](https://farmjs.dev/docs/openapi) to publish `/openapi.json` and a reference page from your typed routes. The [docs engine](https://farmjs.dev/docs/docs-engine) adds Markdown, an `llms.txt`-style index, an agent discovery spec, and generated agent/skill instructions. Both are ordinary app configuration; the guides cover their routes and options.

Discovery describes what an app offers. It does **not** create an MCP server or grant access to application data. Pages also get canonical and Open Graph defaults, with optional JSON-LD.

<span id="api-routes-as-mcp-tools" className="blog-heading-anchor" />

## API routes and standalone MCP tools

**Reuse an API route, define a tool without a route, or compose both.** Top-level `mcp` config brings them into one Streamable HTTP server with a shared authorization policy. Endpoint-backed tools keep the validation, middleware, and handler your app already uses. Standalone tools use `defineTool()` for operations that do not need their own HTTP endpoint.

This includes [MCP composition and shared authorization from #1608](https://github.com/farming-labs/farm.js/pull/1608), with [validated tool results from #1611](https://github.com/farming-labs/farm.js/pull/1611). It requires the optional `@farm.js/mcp` runtime. MCP remains experimental; start with the [setup guide](https://farmjs.dev/docs/plugins/mcp) and the repository's [runnable example](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp).

### Keep the API route authoritative

The same route can serve your app and an MCP client. Its middleware still checks credentials, its schema still validates input, and its handler still limits data to the signed-in user. The session and database helpers in this illustration belong to the app, not Farm.js.

<BlogFigure kind="mcp-code" caption="An MCP client calls the route: its middleware and handler run, and the projects come back" />

### Compose both in one server

Put endpoint references and standalone tools in one `mcp.tools` list. That list selects the whole catalog; it replaces automatic discovery rather than adding to it. Standalone tools do not need an HTTP route, and a server can contain only standalone tools. Enabling MCP never exposes every route automatically.

The [composition guide](https://farmjs.dev/docs/plugins/mcp#declare-tools-in-config) shows the complete configuration, endpoint references, and route-owned declarations. Keep the setup on the server; return JSON-compatible results rather than streaming responses.

### Typed results, too

Standalone tools can declare an `outputSchema` to type and validate their results. Endpoint-backed tools reuse an existing route output validator without running its transforms twice. The [result validation guide](https://farmjs.dev/docs/plugins/mcp#validate-tool-results) covers both patterns. Validation catches an invalid result; it does not undo work a handler already performed.

### One policy, per-tool permissions

`authorize` receives the request, tool catalog, and server identity, so you can allow different tools for different users. The same allowlist controls discovery and execution: guessing a hidden tool name does not bypass it.

Endpoint middleware still protects direct API access. Standalone tools receive the authorized principal, and your app remains responsible for row-level checks and sensitive actions. A tool's read-only hint is not a permission. Follow the [authorization guide](https://farmjs.dev/docs/plugins/mcp#authorize-individual-tools) for policy examples and [client setup](https://farmjs.dev/docs/plugins/mcp#connect-a-client) for credentials.

<span id="browser-tools-with-webmcp" className="blog-heading-anchor" />

## Browser tools with WebMCP

**WebMCP is a different surface.** `@farm.js/webmcp` registers named tools in a supporting browser while your page is open. There is no remote `/api/mcp` server in this path. A tool can read page state or call an existing same-origin API with the user's browser session.

A component owns the tool while it is mounted and removes it when the route unmounts:

<BlogFigure kind="webmcp-code" caption="The component registers the tool; the browser's agent calls it and the page shows active projects" />

Registration returns cleanup; Farm's browser adapter handles navigation and HMR. The schema describes inputs to the agent, while validation checks them before execution. Server authorization is still required.

WebMCP remains an experimental [Community Group draft](https://webmachinelearning.github.io/webmcp/), not a W3C Standard. Unsupported browsers keep running the app normally without the tool surface. Check [Chrome's current setup instructions](https://developer.chrome.com/docs/ai/webmcp) for local testing or the origin trial, and the [Farm WebMCP guide](https://farmjs.dev/docs/plugins/webmcp) for lifecycle and security details. Tools that spend money, publish, or delete data still need the application's authorization and confirmation flow.

<span id="bring-your-agent-framework" className="blog-heading-anchor" />

## Bring your agent framework

**Agents can live inside your app.** Start a chat endpoint with `farm add integration ai`; the [CLI guide](https://farmjs.dev/docs/cli#add-integrations) covers adding integrations to an existing app.

**Bring the agent framework you already use.** You do not need to rewrite your agent around a Farm.js-specific API. The Eve and Cloudflare Agents integrations connect their existing runtimes to your app, while you keep their tools, state, and client SDKs.

**Eve.** Install `@farm.js/eve` alongside `eve`, then register `agent: eve()` under `integrations` in `farm.config.ts`. Keep your instructions in `agent/instructions.md` and use Eve's own `useEveAgent()` React hook. `farm dev` starts Eve alongside your app and exposes its `/eve` and workflow routes on the same origin. On Vercel, Farm.js composes the app and Eve output into one project. Eve requires Node.js 24 or newer. The [Eve guide](https://farmjs.dev/docs/integrations/eve) has the complete setup.

**Cloudflare Agents.** Install `@farm.js/cf-agent`, `agents`, and Wrangler, then register `agent: cfAgent()`. Keep your Agent classes and Durable Object bindings in the standard Cloudflare files; your React UI still connects with `useAgent()` from `agents/react`. Farm.js starts Wrangler during development and proxies `/agents`, including WebSockets, through the app origin. With the `cloudflare-module` preset, the app and Agent classes build into one Worker. The [Cloudflare Agents guide](https://farmjs.dev/docs/integrations/cf-agent) covers bindings, migrations, and deployment. The first-class Cloudflare Pages target is stable; the Agents module-Worker setup is a separate deployment path, so follow that guide rather than treating the presets as interchangeable.

<BlogFigure kind="agents-code" caption="One config line moves the app from Eve to Cloudflare Agents; the same chat answers through each runtime's tools" />

Already running either agent separately? Set the adapter's `origin`, or use `EVE_BASE_URL` / `CF_AGENT_ORIGIN`, to connect an existing service instead of having Farm.js start and compose it. Your agent can keep its own deployment lifecycle.

**Other agent frameworks fit through ordinary APIs.** Call a runtime-compatible SDK from a server-only [API route](https://farmjs.dev/docs/api-routes), or connect to a separately hosted agent over HTTP. Return a standard `Response`, including a stream when the SDK and deployment support it. Match the framework's client protocol and runtime requirements; this is an integration path, not a claim that every agent SDK has a built-in adapter. If the setup is reusable, package it with [`defineIntegration`](https://farmjs.dev/docs/integrations/custom) and share it independently of Farming Labs.

Same-origin routing is not authentication. Protect agent HTTP and WebSocket entry points, authorize sensitive tools inside the agent runtime, and keep model credentials on the server.

**And for the agents writing your code,** routes, params, API calls, and configuration are typed and generated, so a wrong guess fails at type-check instead of in production.

<span id="agent-infrastructure" className="blog-heading-anchor" />

## Agent infrastructure

**Coming next.** We're working on infrastructure to deploy agents and MCP servers, connect your tools, and observe runs from your Farm.js codebase. We also want to make websites easier for agents to discover and interact with through readable content and approved tools. It is not part of v0.1.0.

[Explore agent infrastructure](/agents)

<span id="built-with-farm-viby" className="blog-heading-anchor" />

## Built with Farm: Viby

We are also building with this foundation ourselves. [Viby](https://viby-app.farming-labs.dev) is a conversation-first software builder built on Farm.js and powered by [Viby SDK](https://viby.farming-labs.dev). Start with a prompt, reference files, or an existing repository, then inspect the generated source, iterate in the conversation, and preview the result in an isolated sandbox.

**Viby SDK is the infrastructure behind the experience.** `@viby/sdk` is an open-source, framework-agnostic TypeScript SDK for building persistent, skill-guided vibe coding products. It handles durable chats, generation attempts and events, immutable source versions, workspace tools, and optional sandbox previews. Your application owns its interface, authentication, model credentials, and infrastructure.

**The Viby app shows how those pieces come together.** The demo itself runs on Farm.js, and its generated projects start from a Farm.js baseline. Farm and design-engineering skills guide the generation; source versions let you keep iterating from the last result. You can inspect and edit files, preview the app, download the source, or use the repository and deployment integrations.

The SDK is not tied to Farm.js. Farm is one supported framework, and the app is a concrete example of the kind of product you can build on top of it: your product experience, with the generation and workspace infrastructure supplied by Viby.

[Explore the SDK](https://viby.farming-labs.dev) · [Try the Viby demo](https://viby-app.farming-labs.dev) · [Read the source](https://github.com/farming-labs/viby-sdk)

<span id="deploy-where-you-already-are" className="blog-heading-anchor" />

## Deploy where you already are

`deploy.target` maps to a tested Nitro output: `node`, `vercel`, `cloudflare` (Cloudflare Pages), and `netlify` are stable first-class targets. Direct Nitro presets remain a separate, best-effort path; this is not a claim that Farm.js tests every Nitro runtime. `farm deploy` wraps the platform CLIs for Vercel, Cloudflare, and Netlify.

Run a production build for the target you will actually deploy, not only the development server. The [deployment guide](https://farmjs.dev/docs/deployment) covers target configuration and output. Use cron for scheduled HTTP work, `after()` for short post-response tasks, and a [jobs integration](https://farmjs.dev/docs/integrations/jobs) when work needs durable retries and execution history.

<span id="how-we-earned-stable" className="blog-heading-anchor" />

## How we earned "stable"

I did not want 0.1 to be a relabelled beta, so the last stretch went into proving the release rather than adding features.

Every release now installs representative integrations and a freshly generated app from the packed tarballs, the way a user gets them, then type-checks, builds, and serves that app. That check paid for itself immediately: while cutting the release candidate it caught our own integration smoke test quietly installing core from npm instead of the new build.

We also ran deployment output in real runtimes instead of trusting build logs. Booting Cloudflare output in `workerd`, Cloudflare's runtime, turned up two bugs no unit test could have caught: React apps on the `cloudflare-module` preset could not start, and a fix meant to give edge targets React's Web streaming build was being silently dropped from the build config. Both are fixed and covered by build-level tests.

The rest was unglamorous and necessary: malformed request bodies that returned 500 instead of 400, a storage dependency that let fresh installs close a database the app still owned, and a Content Security Policy warning that stayed quiet for policies that break hydration.

<span id="try-it" className="blog-heading-anchor" />

## Try it

Use **Node.js 22.13 or newer** for development and Node deployments. The initializer installs the starter dependencies; then start the development server:

```bash
npx @farm.js/create-app@latest my-app
cd my-app
npm run dev
```

If you prefer pnpm, `pnpm create @farm.js/app my-app` works too; use `pnpm dev` inside the generated app. Use `--template basic --typescript` for the minimal starter, or `--list-templates` to find an auth, billing, jobs, or AI starter. Provider starters include the integration wiring and an `.env.example`; you supply the provider credentials.

If pnpm's `minimumReleaseAge` policy holds back a just-published release, the [upgrade guide](https://farmjs.dev/docs/upgrading) explains the scoped `@farm.js/*` exclusion. Keep the protection for unrelated dependencies.

Coming from a beta, preview the package changes with `farm upgrade --latest --dry-run`, then run `farm upgrade --latest`. Review the [upgrade guide](https://farmjs.dev/docs/upgrading), run your app's checks and production build, and replace deprecated APIs before a later minor release removes them. `latest` does not turn every independently versioned plugin or renderer into a stable package.

If something breaks, open an issue on [GitHub](https://github.com/farming-labs/farm.js/issues) with `farm doctor` output, the renderer, deployment target, and a small reproduction. Remove credentials and private application data before sharing logs. Thanks to everyone who ran the betas and told me what was wrong.

**Already have an app?** [Migrate to Farm.js](https://farmjs.dev/docs/migrations). Next.js and TanStack Start have dry-run-first CLI migrators; Nuxt and SvelteKit have step-by-step manual guides. Run `farm migrate inspect` to identify a supported source, review the plan, and apply changes only when you're ready.
