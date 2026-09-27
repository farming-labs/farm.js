---
title: "Renderers"
description: "Choose React, Preact, Solid, Vue, or Svelte for application UI while keeping FARMJS routing, server APIs, middleware, observability, and deployment."
section: "Core"
---

# Renderers

Choose React, Preact, Solid, Vue, or Svelte for application UI while keeping FARMJS routing, server
APIs, middleware, observability, and deployment. React remains the default; Preact, Solid, Vue, and
Svelte are beta renderer adapters.

## Choose a renderer

| Renderer                         | Select it with       | Route components | Best fit                                                     |
| -------------------------------- | -------------------- | ---------------- | ------------------------------------------------------------ |
| [React](/docs/renderers/react)   | Omit `renderer`      | `.tsx`, `.jsx`   | Complete FARMJS client API and integration UI support.       |
| [Preact](/docs/renderers/preact) | `renderer: preact()` | `.tsx`, `.jsx`   | Small React-compatible runtime with streaming SSR.           |
| [Solid](/docs/renderers/solid)   | `renderer: solid()`  | `.tsx`, `.jsx`   | Fine-grained interactive UI with FARMJS server features.     |
| [Vue](/docs/renderers/vue)       | `renderer: vue()`    | `.vue`           | Vue SFCs, SSR, hydration, and FARMJS server features.        |
| [Svelte](/docs/renderers/svelte) | `renderer: svelte()` | `.svelte`        | Svelte 5 components, runes, SSR, and FARMJS server features. |

The renderer controls component compilation, element creation, server rendering, and browser
hydration. FARMJS continues to control route discovery, layouts, API routes, middleware, cache and
storage, integrations, observability, and deployment output.

## Feature support

| Capability                                       | React                    | Preact                          | Solid                | Vue                  | Svelte               |
| ------------------------------------------------ | ------------------------ | ------------------------------- | -------------------- | -------------------- | -------------------- |
| File pages and nested layouts                    | Available                | Available                       | Available            | Available            | Available            |
| Server rendering and browser hydration           | Available                | Available                       | Available            | Available            | Available            |
| Shared layout state across client navigation     | Available                | Available                       | Native route update  | Available            | Available            |
| Streaming SSR                                    | Node                     | Node and Web                    | Node and Web         | Node and Web         | Buffered today       |
| Loading, error, not-found, and slot files        | Available                | Available                       | Available            | Available            | Available            |
| Static metadata and favicon configuration        | Available                | Available                       | Available            | Available            | Available            |
| API routes and generated typed API clients       | Available                | Available                       | Available            | Available            | Available            |
| Server functions, middleware, cache, and storage | Available                | Available                       | Available            | Available            | Available            |
| Observability and production Node output         | Available                | Available                       | Available            | Available            | Available            |
| Basic create-app starter                         | Available                | Available                       | Available            | Available            | Available            |
| Better Auth create-app starter                   | Available                | Native                          | Native               | Native               | Native               |
| Router state and programmatic navigation         | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Callable actions and server queries              | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Client theme and i18n state                      | Available                | Through `preact/compat`         | Solid binding        | Vue binding          | Svelte store         |
| Renderer-specific `Link` and form components     | Available                | Through `preact/compat`         | Not yet              | Not yet              | Not yet              |
| Programmatic UI routes                           | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| Markdown/MDX visual routes and docs adapter      | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| Generated JSX metadata images                    | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| React Server Components and optimized boundaries | Available experimentally | Not applicable                  | Not applicable       | Not applicable       | Not applicable       |
| Other integration UI providers and starters      | Available                | Provider-specific compatibility | React-oriented today | React-oriented today | React-oriented today |

In experimental React Server Components, synchronous page and layout components are rendered through React, including supported server hooks such as `useId()`. A string or variable containing `async` does not make a component asynchronous. Stateful hooks and effects still belong in Client Components.

Preact resolves the React-shaped bindings through `preact/compat`. Solid exposes signal-backed
getters, Vue exposes refs and computed values, and Svelte exposes readable stores. The underlying
navigation, action, query-cache, theme, and i18n transports live in the renderer-neutral
`@farm.js/core/renderer-client` entry.

## Native client bindings

Import client bindings from the selected renderer rather than importing React hooks:

```ts
// Solid
import { useAction, useRouter, useServerQuery, useTheme } from "@farm.js/solid/bindings";

// Vue
import { useAction, useRouter, useServerQuery, useTheme } from "@farm.js/vue/bindings";

// Svelte
import {
  createAction,
  createRouter,
  createServerQuery,
  createTheme,
} from "@farm.js/svelte/bindings";
```

Actions remain normal typed RPC calls. Solid exposes action state through reactive properties, Vue
through refs, and Svelte through the callable action's readable-store subscription. Server queries
share FARMJS's existing browser cache, invalidation, deduplication, stale-while-revalidate, focus,
and reconnect behavior across all bindings.

## Renderer capability contract

Renderer packages advertise streaming support in their descriptor instead of relying on FARMJS to
guess from optional runtime exports:

```ts
import { defineRenderer } from "@farm.js/core";

export const customRenderer = defineRenderer({
  name: "custom",
  vite: "@example/renderer/vite",
  server: "@example/renderer/server",
  client: "@example/renderer/client",
  capabilities: {
    streaming: {
      node: false,
      web: true,
    },
    reconcilesRerenders: false,
    functionComponents: false,
  },
});
```

### Re-render behavior

`reconcilesRerenders` states whether re-rendering an existing root diffs the new tree against the
live DOM or rebuilds it.

Virtual-DOM renderers (React, Preact, Vue) compare the incoming tree with what is mounted. Svelte's
FARMJS compatibility root likewise applies a new element description through one mounted reactive
root. In both cases, a client navigation keeps matching DOM nodes, focus, and component state.

Solid remains a compile-time fine-grained renderer: handing `root.render()` a freshly materialized
tree replaces its nodes because there is no virtual DOM to diff. FARMJS therefore does not use
ordinary root re-rendering for a shared Solid layout. The client runtime supplies route state to the
adapter's optional `renderRoute()` method instead; the Solid adapter keeps the matching layout chain
mounted and updates its page slot and params through signals. Changing the layout chain still mounts
the new chain, as it does in the other renderers.

Renderers that do not declare the field are treated as rebuilding, so nothing silently depends on
reconciliation it will not get. The shared renderer conformance suite asserts the behavior each
renderer declares, so the flag cannot drift away from what the adapter actually does.

Custom fine-grained renderers can implement the same optional route-update contract:

```ts
import type { FarmRendererClientRoot, FarmRendererRouteState } from "@farm.js/core/renderer";

interface CustomRoot extends FarmRendererClientRoot {
  renderRoute(state: FarmRendererRouteState): void;
}

export function hydrateRoot(
  container: Element,
  element: unknown,
  initialRoute?: FarmRendererRouteState,
): CustomRoot {
  // Establish native reactive bindings from initialRoute during hydration.
  // Later navigations call root.renderRoute(nextRoute).
}
```

`layouts` arrive outermost first with stable route patterns, `page` is the innermost route slot, and
`params` is the current route-param snapshot. `element` is the fully composed fallback tree, while
`wrap()` reapplies framework-owned outer wrappers such as integration providers. Renderers that omit
`renderRoute()` continue through `render(element)` unchanged.

### Function components

`functionComponents` states whether the renderer can render a plain function component: one that
takes props and returns an element tree rather than a component built by the renderer's own
compiler. FARMJS gates integration provider components on this capability.

React-shaped renderers do this natively. A compile-time renderer needs its adapter to recognize such
a component and call it, because its own components are functions too and the two are otherwise
indistinguishable at runtime.

FARMJS resolves the ambiguity at build time rather than guessing. A provider component in a
production build must be an importable module reference, so the module's extension answers the
question: a `.svelte` provider under the Svelte renderer is a Svelte component, while a `.tsx` one is
a function component. The check uses the extensions the renderer itself declares in
`componentExtensions`, not the resolved set, which always includes `.ts`, `.tsx`, `.js`, and `.jsx`.
Components that are not renderer-compiled are marked so the adapter calls them instead of
instantiating them.

The field defaults to `false`, so a renderer whose adapter has not been taught to handle function
components fails with a clear error naming the renderer rather than rendering something broken.

FARMJS builds the production client and SSR graphs in parallel by default. If a renderer's compiler
plugin uses process-global mutable caches, set `buildConcurrency: "serial"` on its descriptor. The
official Vue renderer does this because `@vitejs/plugin-vue` shares SFC descriptor and script caches
between plugin instances.

A renderer advertising `node` streaming must export `renderToPipeableStream()` from its server
entry. A renderer advertising `web` streaming must export `renderToReadableStream()` returning a
WHATWG `ReadableStream`. FARMJS validates those declarations when the server renderer starts and
uses buffered `renderToString()` when neither capability is enabled. Descriptors without a
`capabilities` field remain buffered for compatibility.

## Renderer-neutral server code

Keep product and server behavior outside the component runtime whenever possible:

```ts
import { createEndpoint } from "@farm.js/core";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

const input = z.object({ name: z.string().min(1) });

const greet = createServerFn({
  input,
  async handler({ input }) {
    return { message: `Hello, ${input.name}` };
  },
});

export const POST = createEndpoint(
  "/api/greeting",
  { method: "POST", body: input },
  async ({ body }) => greet(body),
);
```

React, Preact, Solid, Vue, and Svelte components can call this endpoint through the same generated client.
Database access, secrets, validation, cache invalidation, middleware, and the server-function
handler remain on the server.

## Switch renderers deliberately

The renderer option is application-wide. Do not mix React, Preact, Solid, Vue, and Svelte route components
in the same route tree. Share server modules, schemas, API clients, CSS, and plain TypeScript across
renderers; rewrite component and client-state code using the selected renderer's native primitives.

The Basic and Better Auth templates support every renderer directly:

```bash
PNPM_CONFIG_DLX_CACHE_MAX_AGE=0 PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE='["@farm.js/*"]' pnpm create @farm.js/app@beta my-auth-app --template better-auth --renderer vue --typescript
```

Other integration starter templates currently target React. Add their renderer-neutral server
integration to a native Basic starter when using Preact, Solid, Vue, or Svelte.
