---
title: "Migrate from SvelteKit"
description: "Evaluate Farm.js for a SvelteKit app: retain Svelte components, compare performance honestly, and adopt typed services, plugins, developer tools, and agent capabilities."
section: "Migrations"
---

# Migrate from SvelteKit

SvelteKit and Farm both use filesystem routes, nested layouts, server rendering, Vite, and
standards-based server APIs. The `@farm.js/svelte` renderer lets route UI remain in Svelte 5
components. Preserve the route tree and component markup while replacing SvelteKit-specific data,
navigation, hooks, environment, and deployment APIs.

> **Using a coding agent?**
>
> Point it at [`/docs/migrations/sveltekit.md`](/docs/migrations/sveltekit.md). That version maps every
> SvelteKit feature to its Farm equivalent and ends with a verification checklist.

## Why move from SvelteKit

**Keep Svelte 5 components and adopt Farm's shared server, integration, and agent APIs.**
SvelteKit already offers filesystem routing, Vite, SSR, and Web-platform endpoints. Farm is worth
evaluating when you want those application concerns to share a contract with service integrations,
operational tools, and agent access across projects using different renderers.

- **Preserve component code.** Runes, stores, scoped styles, actions, and transitions remain
  Svelte. The migration replaces SvelteKit-specific modules and data flow, not the component model.
- **Choose where hydration is needed.** Farm Svelte routes emit server-rendered HTML until
  `hydrate = true` opts them in. A layout can enable it for a whole interactive section. SvelteKit
  also has rendering controls; this is a default and ownership difference, not an exclusive ability.
- **Give services a common server boundary.** Typed endpoints and integrations connect auth,
  billing, email, jobs, and storage without changing the UI renderer.
- **Inspect the whole app.** Route explanations, generated declarations, diagnostics, and plugin
  inspection cover more than the component currently on screen.
- **Agent native at the core, including Svelte apps.** `@farm.js/core` supplies Markdown,
  discovery, capability manifests, and read-only MCP. Explicit tools and durable agent execution
  can then reuse your server APIs and authorization.

### Performance evidence

The [published November 3, 2026 snapshot](https://github.com/farming-labs/farm.js/blob/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks/results/latest.md)
compares SvelteKit 2.70.1/Svelte 5.56.7 with **Farm.js 0.1.51-beta.2 using React 19.2.4**.
It does not benchmark Farm's Svelte renderer. Lower durations are better.

| Measure                                   | SvelteKit      | Farm.js, React fixture |
| ----------------------------------------- | -------------- | ---------------------- |
| Process launch to first dev page, median  | 803.65 ms      | 271.78 ms              |
| Warm dev response, median                 | 1.92 ms        | 2.08 ms                |
| Clean fixture build, median               | 1,729.46 ms    | 589.12 ms              |
| Production boot to first response, median | 68.77 ms       | 77.69 ms               |
| Production response, median / p95         | 0.63 / 0.80 ms | 0.74 / 1.64 ms         |

The Farm React fixture reaches the first dev page and finishes its build in about one-third of
the time. **SvelteKit has the lower warm-dev response, production-boot time, and production-response
median and p95.** This evidence supports a startup/build advantage for that fixture, not a claim
that Farm is faster than SvelteKit in every phase or that a Svelte-preserving port will match it.

The workload is one fresh SSR page with 120 list items and shared CSS. The run used an Apple M1,
16 GB RAM, macOS 26.2, Node 24.21.0, one discarded burn-in, and seven position-balanced measured
rounds. Each server received 30 warmup and 30 measured requests per round over local HTTP/1.1,
requesting identity encoding. Generated framework caches were removed for dev and build; OS and
product-enabled Node compile caches stayed warm. Farm package preparation and dependency installs
are outside the build timer. See the
[method and raw samples](https://github.com/farming-labs/farm.js/tree/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks).
Measure a representative route with Farm's Svelte adapter before making a performance decision.

### Developer experience after the move

Use [API routes](/docs/api-routes) with validation and inferred client types, then consume them
through the renderer-neutral client described in the [Svelte guide](/docs/renderers/svelte).
Keep Svelte browser modules on `@farm.js/svelte/bindings` and `@farm.js/core/api/client` rather
than React client entries. Server-only query or action code must stay behind the documented server
boundary; it is not a replacement import for `$app/server`.

Farm's [layers](/docs/layers), [storage](/docs/storage), [cron](/docs/cron), and
[deployment configuration](/docs/deployment) give shared application work a consistent home.
Run `farm doctor --json`, `farm explain /products/42`, and `farm generate --check` to inspect
configuration, routes, and generated types. [DevTools](/docs/plugins/devtools) can inspect Svelte
source and served modules, while [Hints](/docs/plugins/hints) checks the live page and
[Analyzer](/docs/plugins/analyzer) explains the built output.

### Agent experience after the move

**The agent surface belongs to `@farm.js/core`, so you keep it when you choose Svelte.** Core
provides public-page reading and discovery without an agent integration or a separate MCP server.
Its [AI catalog](/docs/configuration#ai-catalog) advertises MCP servers already present; see the
[core defaults and limits](/docs/migrations#agent-native-at-the-core) for ownership, overrides,
and opt-ins.

[Markdown mirrors](/docs/markdown), [discovery metadata](/docs/configuration#agent-readiness),
and the [read-only MCP server](/docs/configuration#default-mcp-server) let agents read eligible
public static content without interpreting Svelte's UI. The
[app manifest](/docs/configuration#app-manifest) describes available capabilities, and
`farm agent check` inspects the running surface.

Expose selected validated endpoints through [API MCP](/docs/plugins/mcp) when an agent should
perform an authorized operation. [WebMCP](/docs/plugins/webmcp) provides explicitly registered
browser tools; use Svelte's mount/disposal lifecycle and a supporting browser. That browser API is
experimental. For background agent work, the [agent integration](/docs/integrations/agent) adds
durable steps, pauses, and event waits on the server. The authorization for a tool call belongs
in the endpoint, just as it does for a form submission.

### Integrations and plugins to include in the migration

- Use [integrations](/docs/integrations) for server services such as Better Auth, Stripe, Resend,
  and Jobs. Check UI support separately: a React provider example does not run in Svelte.
- Consider [Content](/docs/plugins/content) and [Search](/docs/plugins/search) for typed content
  and a headless search index, or [PWA](/docs/plugins/pwa) for offline navigation. Port any
  existing service-worker behavior explicitly before replacing it.
- Add [Progress](/docs/plugins/progress) and [Scroll restoration](/docs/plugins/scroll-restoration)
  only where the app uses Farm client navigation; plain anchors still load documents.
- Use [MSW](/docs/plugins/msw), [Health](/docs/plugins/health), and
  [Sentry](/docs/plugins/sentry) for testing and operations. The
  [complete catalog](/docs/migrations#integrations-for-the-product-plugins-for-the-framework)
  includes script loading, sync, workers, styling, and custom plugin hooks.

### Decide the compatibility cost first

SvelteKit's load functions, form actions and progressive enhancement, hooks, snapshots, and
navigation state have application-visible semantics. Farm's Svelte adapter does not run those
APIs unchanged. Inventory them before moving, especially forms that must work without JavaScript.
Keep the [SvelteKit page-options contract](https://svelte.dev/docs/kit/page-options) in view when
matching SSR, prerendering, and client behavior.

Use the parity guide to choose explicit API and middleware replacements. Keep the original app
until production checks pass. Farm's experimental React rendering and compiler features do not
apply to this Svelte migration.

## Create the Farm shell

Add Farm and its Svelte renderer without removing SvelteKit first:

```bash
pnpm add @farm.js/core @farm.js/svelte svelte
pnpm add -D @farm.js/cli
```

Create the smallest Farm config:

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

Point the application scripts at Farm when the first route is ready:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Map the route tree

SvelteKit and Farm both use bracketed dynamic segments. The main change is replacing SvelteKit's
`+file` convention with Farm's page and route modules.

| SvelteKit source                         | Farm output                          |
| ---------------------------------------- | ------------------------------------ |
| `src/routes/+page.svelte`                | `src/app/page.svelte`                |
| `src/routes/about/+page.svelte`          | `src/app/about/page.svelte`          |
| `src/routes/posts/[id]/+page.svelte`     | `src/app/posts/[id]/page.svelte`     |
| `src/routes/docs/[...slug]/+page.svelte` | `src/app/docs/[...slug]/page.svelte` |
| `src/routes/+layout.svelte`              | `src/app/layout.svelte`              |
| nested `+layout.svelte`                  | nested `src/app/**/layout.svelte`    |
| `+error.svelte`                          | the nearest `error.svelte`           |

SvelteKit route groups such as `(app)` do not add a URL segment. Recreate their layout intent with
Farm route groups or the appropriate nested layout structure, and review advanced layout resets
manually.

Create a root layout before moving pages:

```svelte
<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
```

SvelteKit hydrates every page. Farm hydrates a Svelte route only when it or a layout exports
`hydrate = true`, so the root layout above opts the whole app in.

Keep ordinary Svelte markup, runes, stores, actions, transitions, and scoped styles. Replace
SvelteKit imports and conventions inside each component, and move Farm route exports such as
`metadata` and `hydrate` into `<script module lang="ts">`. See
[Svelte Renderer](/docs/renderers/svelte) for the complete component conventions.

## Move load functions

SvelteKit's sibling `+page.ts`, `+page.server.ts`, `+layout.ts`, and `+layout.server.ts` modules feed
data into pages and layouts. Move each load function according to its responsibility:

| SvelteKit behavior        | Farm destination                                     |
| ------------------------- | ---------------------------------------------------- |
| server-only page load     | `createServerQuery`, server function, or API route   |
| universal load            | typed API/server query plus a Svelte client consumer |
| reusable cached read      | `createServerQuery` with an explicit structured key  |
| layout load               | shared server query or typed API route               |
| redirect or 404 from load | `redirect()` or `notFound()`                         |
| dependency invalidation   | Farm cache, route, API, or server-query invalidation |

Keep private environment variables, database calls, and privileged SDKs on the server.

## Convert endpoints and form actions

| SvelteKit source                   | Farm output                                      |
| ---------------------------------- | ------------------------------------------------ |
| `src/routes/api/hello/+server.ts`  | `src/app/api/hello/route.ts`                     |
| exported `GET`, `POST`, or `PATCH` | matching HTTP method exports                     |
| actions in `+page.server.ts`       | server functions or validated API route handlers |

Both frameworks use Web `Request` and `Response` concepts for endpoints, but review cookies,
locals, params, and platform access:

```ts
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: body });
}
```

Prefer `createEndpoint` when input needs schema validation and typed client generation. Preserve
progressive enhancement intentionally when replacing SvelteKit form actions.

## Replace navigation and app state

| SvelteKit API                 | Farm Svelte equivalent                                     |
| ----------------------------- | ---------------------------------------------------------- |
| ordinary internal `<a>` links | ordinary `<a>` elements (full page loads)                  |
| `goto()`                      | `createRouter().push()` from `@farm.js/svelte/bindings`    |
| `redirect()`                  | `redirect()` from `@farm.js/core/navigation`               |
| `error(404)`                  | `notFound()`                                               |
| page params                   | `params` from `$props()`                                   |
| URL search values             | `searchParams` from `$props()` or browser URL state        |
| `$app/state` or `$app/stores` | route props, Svelte runes/stores, or renderer-neutral APIs |

Choose the smallest state owner. Do not move server-derived user or tenant data into a global
browser store unless it is safe to expose.

## Move hooks and locals

Review `src/hooks.server.ts`, `src/hooks.client.ts`, and `event.locals` by lifecycle:

- move request authentication and request-scoped values into Farm middleware
- move route-specific guards into nested `src/app/**/middleware.ts`
- move global server lifecycle behavior into Farm plugins
- move browser lifecycle behavior into hydrated Svelte components or Farm client plugin hooks
- pass safe request data through middleware data and keep secrets in server-only context

Repeat sensitive authorization inside API routes and server functions.

## Move environment and deployment config

Replace SvelteKit environment modules and adapters explicitly:

| SvelteKit source           | Farm destination                                 |
| -------------------------- | ------------------------------------------------ |
| `$env/static/private`      | typed server environment variables               |
| `$env/dynamic/private`     | server environment access                        |
| `$env/static/public`       | typed public environment variables               |
| `svelte.config.js` adapter | Farm `deploy.target` or a supported Nitro preset |
| `vite.config.ts`           | Farm's `vite` field when customization is needed |
| `static`                   | Farm's public asset directory                    |

Never move a private value into public environment configuration just because a client component
needs related data. Return a safe derived value from the server instead.

## Verify and remove SvelteKit

Run both applications during the transition and compare:

- static, dynamic, optional, rest, and grouped routes
- nested layouts, layout resets, errors, and redirects
- server and universal load behavior
- form actions and progressive enhancement
- endpoint status codes, headers, cookies, and response bodies
- hook order, locals, authentication, and authorization
- SSR, hydration, and client navigation
- adapter behavior on the target deployment platform

After the Farm application passes those checks, remove `@sveltejs/kit`, the SvelteKit adapter,
`.svelte-kit`, and framework-specific configuration. Keep `svelte` and `@farm.js/svelte` as
application dependencies.

For source behavior, refer to SvelteKit's official [routing](https://svelte.dev/docs/kit/routing),
[loading data](https://svelte.dev/docs/kit/load), [advanced routing](https://svelte.dev/docs/kit/advanced-routing),
and [hooks](https://svelte.dev/docs/kit/hooks) documentation while auditing the original app.
