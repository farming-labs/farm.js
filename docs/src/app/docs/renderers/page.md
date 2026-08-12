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
  },
});
```

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
pnpm create @farm.js/app@beta my-auth-app --template better-auth --renderer vue --typescript
```

Other integration starter templates currently target React. Add their renderer-neutral server
integration to a native Basic starter when using Preact, Solid, Vue, or Svelte.
