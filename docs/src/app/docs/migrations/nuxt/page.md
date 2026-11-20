---
title: "Migrate from Nuxt"
description: "Evaluate Farm.js for a Nuxt app: keep Vue components, compare performance evidence, and adopt typed services, developer tools, plugins, and agent capabilities."
section: "Migrations"
---

# Migrate from Nuxt

Nuxt and Farm share Vue, file-based routing, server rendering, API routes, Vite, and Nitro
deployment output. Farm uses a different application and server contract, but the
`@farm.js/vue` renderer lets route UI remain in Vue Single-File Components. Preserve route URLs and
server contracts while replacing Nuxt-specific macros, composables, modules, and runtime behavior.

> **Using a coding agent?**
>
> Point it at [`/docs/migrations/nuxt.md`](/docs/migrations/nuxt.md). That version maps every
> Nuxt feature to its Farm equivalent and ends with a verification checklist.

## Why move from Nuxt

**Keep Vue components while adopting Farm's application, integration, and agent contracts.** Nuxt
already combines Vue, Vite, Nitro, modules, and server rendering. The reason to move is a fit with
Farm's particular APIs and tools, rather than gaining those shared foundations for the first time.

- **Retain the Vue work you have.** Templates, refs, computed values, scoped styles, and ordinary
  components remain Vue. Replace Nuxt macros and composables deliberately instead of rewriting
  the interface in React.
- **Use explicit hydration boundaries.** Farm's Vue routes render HTML without hydration until
  you opt in. This gives content pages an explicit way to avoid component hydration work.
  Enable hydration for interactive routes and test them; removing interactivity is not an
  optimization.
- **Connect services through typed endpoints.** Server integrations can own routes, configuration,
  callers, and lifecycle. Vue consumes their server APIs without adopting React providers.
- **Reuse a framework contract across projects.** If your team maintains both Vue and React apps,
  Farm gives their server routes, storage, deployment, plugins, and diagnostics a common vocabulary.
- **Make content and approved actions accessible to agents.** Farm includes discovery and reading
  surfaces, with opt-in tools and agent runtimes when the product needs them.

### Performance evidence

The [published November 3, 2026 snapshot](https://github.com/farming-labs/farm.js/blob/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks/results/latest.md)
compares Nuxt 4.5.0/Vue 3.5.40 with **Farm.js 0.1.51-beta.2 using React 19.2.4**. It does not
measure Farm's Vue renderer or a migrated Nuxt application. Lower durations are better.

| Measure                                   | Nuxt           | Farm.js, React fixture |
| ----------------------------------------- | -------------- | ---------------------- |
| Process launch to first dev page, median  | 2,387.53 ms    | 271.78 ms              |
| Warm dev response, median                 | 3.16 ms        | 2.08 ms                |
| Clean fixture build, median               | 4,487.00 ms    | 589.12 ms              |
| Production boot to first response, median | 118.56 ms      | 77.69 ms               |
| Production response, median / p95         | 1.03 / 1.51 ms | 0.74 / 1.64 ms         |

The Farm React fixture reaches the first dev page about 8.8× sooner and builds about 7.6× faster.
Nuxt has the lower production-response p95 in this run. Neither result tells you the speedup of
keeping Vue and moving the same app to Farm; measure that path separately.

The workload is one fresh SSR page with 120 list items and shared CSS. The run used an Apple M1,
16 GB RAM, macOS 26.2, Node 24.21.0, one discarded burn-in, and seven position-balanced measured
rounds. Each server received 30 warmup and 30 measured requests per round over local HTTP/1.1,
requesting identity encoding. Generated framework caches were removed for dev and build; OS and
product-enabled Node compile caches stayed warm. Farm package preparation and dependency installs
are outside the build timer. See the
[method and raw samples](https://github.com/farming-labs/farm.js/tree/5ff3c9fb20319c9344c1cc1fe918b7eab71b3877/benchmarks/frameworks).
This measures neither browser hydration nor the cost of Nuxt modules in your application.

### Developer experience after the move

Use Farm's [validated API routes](/docs/api-routes) and a renderer-neutral typed client to keep
request and response contracts connected. In Vue code, follow the imports in the
[Vue renderer guide](/docs/renderers/vue), including `@farm.js/vue/bindings` and
`@farm.js/core/api/client`; React client hooks are not Vue composables.

Move shared app foundations into [layers](/docs/layers). Use Farm's
[i18n configuration](/docs/internationalization), [storage mounts](/docs/storage), and
[deployment targets](/docs/deployment) where they meet your requirements. Nuxt already has layers
and Nitro deployment; review the behavior changes instead of assuming matching names mean matching
semantics.

Run `farm doctor` for diagnostics, `farm explain /products/42` for resolved route behavior, and
`farm generate --check` for generated declarations. [DevTools](/docs/plugins/devtools) can inspect
served Vue modules; [Hints](/docs/plugins/hints) checks the live page and
[Analyzer](/docs/plugins/analyzer) explains output size. These make the migration's server and
browser boundaries easier to inspect.

### Agent experience after the move

Farm's [Markdown mirrors](/docs/markdown), [discovery metadata](/docs/configuration#agent-readiness),
and [read-only MCP server](/docs/configuration#default-mcp-server) work at the framework level.
An agent can discover and read eligible public static pages without understanding Vue's component
tree. The [app manifest](/docs/configuration#app-manifest) describes configured capabilities.

For approved operations, [API MCP](/docs/plugins/mcp) exposes selected server endpoints with
validation and authorization. [WebMCP](/docs/plugins/webmcp) offers explicit browser tools; register
and dispose of them through Vue's lifecycle. It requires a supporting browser and is experimental.
The [agent integration](/docs/integrations/agent) can host durable server-side agent work beside
your Vue app. Its server capabilities do not require a React chat interface.

### Integrations and plugins to replace Nuxt-specific wiring

- Start with the [integration catalog](/docs/integrations) for auth, billing, email, jobs, and
  agents. Keep server adapters separate from renderer-specific UI; port React examples to Vue
  rather than installing React providers into a Vue tree.
- Use [Content](/docs/plugins/content) for validated local collections and
  [Search](/docs/plugins/search) for a headless index of emitted static pages. They are migration
  destinations, not automatic replacements for all Nuxt Content features.
- Use [Scripts](/docs/plugins/scripts) for external SDK loading,
  [PWA](/docs/plugins/pwa) for offline navigation, and [Health](/docs/plugins/health) or
  [Sentry](/docs/plugins/sentry) for production operations.
- Extend the app through [server/build hooks](/docs/plugins/create-plugin) and
  [client hooks](/docs/plugins/client) when a Nuxt module has no direct adapter. The
  [complete catalog](/docs/migrations#integrations-for-the-product-plugins-for-the-framework)
  also covers navigation, request mocks, workers, and WebAssembly.

### Decide what must remain Nuxt-compatible

Audit modules, auto-imports, `useAsyncData`, payload transfer, route middleware, and Vue plugins
before moving. Farm's Vue app setup can install Vue plugins, but it does not automatically transfer
their server store state to the browser. Hydration is opt-in, and ordinary anchors perform full
document navigation; use the renderer's router bindings when client navigation is required.

Nuxt's [rendering modes](https://nuxt.com/docs/4.x/guide/concepts/rendering) already support several
delivery strategies. Compare equivalent rendering and cache behavior. React server components,
React hooks, and experimental React compiler results are not capabilities or measurements of
Farm's Vue renderer.

## Create the Farm shell

Add Farm and the Vue renderer without removing Nuxt first:

```bash
pnpm add @farm.js/core @farm.js/vue vue
pnpm add -D @farm.js/cli
```

Create the smallest Farm config:

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
});
```

Point the application scripts at Farm when the first route is ready to run:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Map pages and layouts

Nuxt 4 normally keeps pages under `app/pages`; projects using the earlier layout may use `pages` at
the root. Both map into Farm's `src/app`.

| Nuxt source                                        | Farm output                                 |
| -------------------------------------------------- | ------------------------------------------- |
| `app/pages/index.vue` or `pages/index.vue`         | `src/app/page.vue`                          |
| `app/pages/about.vue` or `pages/about.vue`         | `src/app/about/page.vue`                    |
| `app/pages/posts/[id].vue`                         | `src/app/posts/[id]/page.vue`               |
| `app/pages/docs/[...slug].vue`                     | `src/app/docs/[...slug]/page.vue`           |
| `app/layouts/default.vue` or `layouts/default.vue` | `src/app/layout.vue`                        |
| nested Nuxt layouts                                | nested `src/app/**/layout.vue` files        |
| `error.vue`                                        | the nearest `error.vue` and `not-found.vue` |

Create a root layout before moving pages:

```vue
<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <slot />
</template>
```

Keep ordinary templates, `<script setup>`, refs, computed values, and scoped styles. Replace Nuxt
auto-imports and macros with explicit Vue imports and Farm route exports. Use a normal
`<script lang="ts">` block for named exports such as `metadata` and `hydrate`, and add
`defineOptions({ inheritAttrs: false })` so route props do not fall through to the root DOM element.

See [Vue Renderer](/docs/renderers/vue) for the complete SFC conventions.

## Replace Nuxt navigation

| Nuxt API                 | Farm Vue equivalent                                     |
| ------------------------ | ------------------------------------------------------- |
| `<NuxtLink to="/about">` | `<a href="/about">`                                     |
| `navigateTo("/sign-in")` | `redirect("/sign-in")` in server code                   |
| client `navigateTo()`    | assign `window.location` or use an ordinary anchor      |
| `useRoute().params`      | typed page props declared with `defineProps`            |
| `useRoute().query`       | typed page props or `URLSearchParams` in client code    |
| `definePageMeta()`       | named `metadata`, `generateMetadata`, and route exports |

Keep dynamic segment names stable so existing links and external URLs continue to work.

## Move data fetching

Classify every `useFetch`, `useAsyncData`, and `$fetch` call by where it should run:

| Nuxt behavior                        | Farm destination                                        |
| ------------------------------------ | ------------------------------------------------------- |
| server-rendered page data            | server module called while rendering or an API endpoint |
| cached reusable read                 | `createServerQuery` with an explicit structured key     |
| browser request to an app endpoint   | generated API client or `fetch`                         |
| mutation or privileged server action | server function behind a validated API route            |
| route guard data                     | route middleware                                        |

Keep database clients, secrets, and privileged provider SDKs in server-only modules. Validate
untrusted params, query values, form data, and API bodies before using them.

## Convert server routes

Move Nitro server handlers into Farm API route modules:

| Nuxt source                      | Farm output                                    |
| -------------------------------- | ---------------------------------------------- |
| `server/api/hello.get.ts`        | `src/app/api/hello/route.ts` with `GET`        |
| `server/api/users/[id].patch.ts` | `src/app/api/users/[id]/route.ts` with `PATCH` |
| `server/routes/health.ts`        | an API route or programmatic Farm route        |
| `server/middleware/*.ts`         | Farm middleware or a server plugin             |

Farm handlers use Web `Request` and `Response` objects:

```ts
export async function GET() {
  return Response.json({ ok: true });
}
```

Use `createEndpoint` when the endpoint needs schema validation and a typed generated client.

## Move middleware and plugins

Nuxt route middleware and server middleware do not share one lifecycle, so migrate them by
responsibility:

- move authentication redirects and route gates into `src/app/**/middleware.ts`
- move global request behavior into `farm.config.ts` middleware
- move reusable server lifecycle behavior into a Farm plugin
- move provider setup into a Farm integration when it owns routes, middleware, or client context
- replace Nuxt client plugins with Vue components or Farm client plugin hooks

Repeat sensitive authorization in API routes and server functions. A page redirect is not an
authorization boundary.

## Move runtime configuration

Review `nuxt.config.ts`, `app.config.ts`, modules, auto-imports, aliases, and `runtimeConfig`
explicitly:

| Nuxt configuration       | Farm destination                                       |
| ------------------------ | ------------------------------------------------------ |
| private `runtimeConfig`  | typed server environment variables                     |
| `runtimeConfig.public`   | typed public environment variables                     |
| app metadata             | page or layout metadata exports                        |
| Vite plugins and aliases | the `vite` field in `farm.config.ts` when still needed |
| Nuxt modules             | Farm integrations, plugins, or ordinary packages       |
| auto-imported components | explicit Vue component imports                         |

Do not expose a private Nuxt runtime value through Farm's public environment configuration.

## Verify and remove Nuxt

Run both applications during the transition and compare:

- static, dynamic, optional, and catch-all routes
- layouts, metadata, error states, and redirects
- server-rendered data and client navigation
- API status codes, headers, cookies, and response bodies
- middleware order and authorization
- image and public asset URLs
- production output on the target deployment platform

After the Farm application passes those checks, remove Nuxt, Nuxt modules, `.nuxt`, and
Nuxt-specific deployment configuration. Keep Vue and `@farm.js/vue` as application dependencies.

For source behavior, refer to Nuxt's official [pages](https://nuxt.com/docs/4.x/directory-structure/app/pages),
[data fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching), and
[directory structure](https://nuxt.com/docs/4.x/directory-structure) documentation while auditing
the original app.
