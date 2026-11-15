# @farm.js/svelte

Svelte 5 renderer for Farm.js applications. It compiles `.svelte` route components, renders them
on the server with Svelte's server runtime, and hydrates the page in the browser. Farm keeps
routing, layouts, API routes, middleware, and deployment output.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/core @farm.js/svelte svelte
```

`@farm.js/core` (`>=0.1.0 <0.2.0`) and `svelte` (`^5.46.4`) are peer dependencies.
`@sveltejs/vite-plugin-svelte` is installed with the adapter.

To start a new project with Svelte already selected:

```bash
pnpm create @farm.js/app my-svelte-app --template basic --renderer svelte
```

The Better Auth starter also ships native Svelte routes, runes, and forms with
`--template better-auth`.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

`svelte()` takes no options. The renderer is application-wide, so do not mix Svelte route
components with another renderer's components in the same route tree.

## Pages and layouts

Routes are `.svelte` files such as `src/app/layout.svelte`, `src/app/page.svelte`, and
`src/app/products/[id]/page.svelte`. Put Farm route exports in a module script. A layout renders
its route content through the `children` snippet:

```svelte
<script module lang="ts">
  import type { Metadata } from "@farm.js/core";
  import "./globals.css";

  export const metadata: Metadata = {
    title: "Farm.js with Svelte",
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children?: Snippet } = $props();
</script>

{@render children?.()}
```

Page props such as `params` and `searchParams` are available through `$props()`. To hydrate an
interactive route, export `hydrate = true` from the module script and use runes normally:

```svelte
<script module lang="ts">
  export const hydrate = true;
</script>

<script lang="ts">
  let count = $state(0);
</script>

<button type="button" onclick={() => (count += 1)}>Count: {count}</button>
```

## Server rendering

Svelte renders buffered HTML: the full page is rendered to a string before the response is sent,
on every target. Streaming is not available with this renderer. Markup from `<svelte:head>` is
carried into the document head alongside Farm's static metadata.

## Client bindings

Import router, action, query, theme, and i18n state from `@farm.js/svelte/bindings`. Each value
implements Svelte's readable-store contract, so `$store` syntax works in components.

| Export              | Purpose                                                   |
| ------------------- | --------------------------------------------------------- |
| `createRouter`      | Router snapshot store with `push`, `replace`, `refresh`   |
| `createAction`      | Callable server function and a store of its pending state |
| `createServerQuery` | Cached server query store with `refetch()`                |
| `createTheme`       | Theme store with `setTheme` and `toggleTheme`             |
| `createI18n`        | Locale store with `t` and `setLocale`                     |

```svelte
<script lang="ts">
  import { createAction, createRouter } from "@farm.js/svelte/bindings";
  import { saveProduct } from "../lib/products";

  const router = createRouter();
  const save = createAction(saveProduct);

  async function onSave() {
    await save({ name: "Farm" });
    await router.push("/products");
  }
</script>

<p>Current path: {$router.pathname}</p>
<button type="button" onclick={onSave} disabled={$save.pending}>Save</button>
```

`saveProduct` is a server function created with `createServerFn` from `@farm.js/core/server-fn`.

## Current boundaries

Renderer-specific `Link` and form components, integration UI providers, programmatic UI routes,
Markdown and MDX visual pages, the docs adapter, and generated JSX metadata images remain
React-oriented today.

## Entry points

| Subpath                    | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `@farm.js/svelte`          | The `svelte()` factory and the `SVELTE_RENDERER` descriptor. |
| `@farm.js/svelte/bindings` | Readable stores for router, action, query, theme, and i18n.  |
| `@farm.js/svelte/vite`     | Vite plugin wrapping `@sveltejs/vite-plugin-svelte`.         |
| `@farm.js/svelte/server`   | Buffered server rendering, including `<svelte:head>` output. |
| `@farm.js/svelte/client`   | Browser hydration.                                           |

Farm loads the `vite`, `server`, and `client` entries from the renderer descriptor. Applications
normally import only the package root and `/bindings`.

## Documentation

- [Svelte renderer guide](https://farmjs.dev/docs/renderers/svelte)
- [Renderer support matrix](https://farmjs.dev/docs/renderers)
- [Svelte renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/svelte-renderer)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
