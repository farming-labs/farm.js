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
| Streaming SSR                                    | Available                | Available                       | Buffered today       | Buffered today       | Buffered today       |
| Loading, error, not-found, and slot files        | Available                | Available                       | Available            | Available            | Available            |
| Static metadata and favicon configuration        | Available                | Available                       | Available            | Available            | Available            |
| API routes and generated typed API clients       | Available                | Available                       | Available            | Available            | Available            |
| Server functions, middleware, cache, and storage | Available                | Available                       | Available            | Available            | Available            |
| Observability and production Node output         | Available                | Available                       | Available            | Available            | Available            |
| Basic create-app starter                         | Available                | Available                       | Available            | Available            | Available            |
| `Link`, router hooks, actions, fetchers, queries | Available                | Through `preact/compat`         | React API only       | React API only       | React API only       |
| Client theme and i18n hooks                      | Available                | Through `preact/compat`         | React API only       | React API only       | React API only       |
| Programmatic UI routes                           | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| Markdown/MDX visual routes and docs adapter      | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| Generated JSX metadata images                    | Available                | Compatibility surface           | React-oriented today | React-oriented today | React-oriented today |
| React Server Components and optimized boundaries | Available experimentally | Not applicable                  | Not applicable       | Not applicable       | Not applicable       |
| Integration UI providers and provider starters   | Available                | Provider-specific compatibility | React-oriented today | React-oriented today | React-oriented today |

“React API only” means the server feature remains usable, but its current convenience hook or
component imports React. Preact resolves many of those imports through `preact/compat`; Solid, Vue,
and Svelte applications should call validated endpoints through the generated API client and use
their renderer's native state primitives.

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

Integration starter templates currently target React. Use the Basic starter for Preact, Solid, Vue,
or Svelte, then add renderer-neutral integrations without their React UI scaffold.
