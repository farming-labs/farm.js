---
title: "Svelte Renderer"
description: "Use Svelte 5 components, runes, SSR, hydration, and typed FARMJS server calls through the @farm.js/svelte adapter."
section: "Core"
---

# Svelte Renderer

`@farm.js/svelte` connects Svelte component compilation, server rendering, and browser hydration to
the FARMJS renderer contract. React remains the default unless the application selects Svelte.

## Create an app

```bash
pnpm create @farm.js/app my-svelte-app --template basic --renderer svelte --typescript
```

For an existing Basic app, install the adapter and Svelte 5:

```bash
pnpm add @farm.js/svelte svelte
```

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

## Pages and layouts

Svelte routes use `.svelte` files:

```text
src/app/layout.svelte
src/app/page.svelte
src/app/products/[id]/page.svelte
```

Put FARMJS route exports in a module script. A layout renders its route content through Svelte's
`children` snippet:

```svelte
<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css";

  export const metadata: Metadata = {
    title: "FARMJS with Svelte",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
```

Page route props such as `params` and `searchParams` are available through `$props()` when the
component needs them.

## Hydrate interactive routes

Export `hydrate = true` from the module script, then use Svelte runes and events normally:

```svelte
<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  let count = $state(0);
</script>

<button type="button" onclick={() => (count += 1)}>Count: {count}</button>
```

FARMJS reads `hydrate` from the file before Svelte compiles it, so write the literal `true` or `false`. Any declaration works,
including a type annotation or an export list. A value FARMJS can't read without running the code,
such as an expression, an import, or a re-export, fails the build with an error that names the file.

FARMJS server-renders the component with Svelte's server runtime and claims the existing markup with
Svelte hydration in the browser.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Call them from a Svelte component with `apiClient`, created once in `src/lib/api.ts` as shown in [API Client](/docs/api-client#create-both-callers-once):

```svelte
<script lang="ts">
  import { apiClient } from "../lib/api";

  let message = $state("Ready");

  async function callServer() {
    const result = await apiClient.greeting.post({ body: { name: "Svelte" } });
    if (result.data) message = result.data.message;
  }
</script>

<button type="button" onclick={callServer}>{message}</button>
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets remain
in the server bundle. With `experimental.serverActions`, browser code can also import the server function and call it
directly; see [callable actions](/docs/renderers#native-client-bindings).

## Current boundaries

Use the Svelte-native bindings for router, theme, and i18n stores:

```svelte
<script lang="ts">
  import { createRouter, createTheme } from "@farm.js/svelte/bindings";

  const router = createRouter();
  const theme = createTheme();
</script>

<button on:click={() => router.push("/products")}>{$router.pathname}</button>
<button on:click={theme.toggleTheme}>Theme</button>
```

`createAction` and `createServerQuery` take a server function or server query imported from its server
module, which needs `experimental.serverActions`; see
[callable actions](/docs/renderers#native-client-bindings).

The returned values implement Svelte's readable-store contract. `createReadable(store)` wraps
your own state, a store from `createStore` in `@farm.js/core/renderer-client`, the same way; see
[Shared client state](/docs/renderers#shared-client-state). `Link` from `@farm.js/svelte/link`
navigates and prefetches like the React one; see [Link in Solid, Vue, and Svelte](/docs/routing#link-in-solid-vue-and-svelte).
`<form use:action.enhance>` submits a form through an action; see
[action forms](/docs/renderers#action-forms). Fetchers and integration providers remain
React-oriented today. `withDocs()` from `@farming-labs/farmjs` builds docs pages with Svelte;
see [Docs adapters on any renderer](/docs/docs-engine#docs-adapters-on-any-renderer). Markdown and MDX pages and [programmatic UI routes](/docs/routing#programmatic-routes) render with
Svelte, and an `opengraph-image.svelte` component draws a
[generated metadata image](/docs/routing#generated-metadata-images).

The Better Auth starter includes native Svelte routes, runes, and forms:

```bash
pnpm create @farm.js/app my-auth-app --template better-auth --renderer svelte --typescript
```

Other integration starter templates currently target React, so add their renderer-neutral provider
code to a native Basic starter.

Run the complete example:

```bash
pnpm --filter farm-svelte-renderer-example dev
```

See the [Svelte renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/svelte-renderer),
the [renderer support matrix](/docs/renderers), and Svelte's
[SSR guide](https://svelte.dev/docs/svelte/svelte-server).
