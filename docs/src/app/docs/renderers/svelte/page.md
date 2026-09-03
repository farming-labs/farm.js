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
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-svelte-app --template basic --renderer svelte --typescript
```

For an existing Basic app, install the adapter and Svelte 5:

```bash
pnpm add @farm.js/svelte@beta svelte
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

FARMJS server-renders the component with Svelte's server runtime and claims the existing markup with
Svelte hydration in the browser.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Use the generated typed API client from a Svelte component:

```svelte
<script lang="ts">
  import { api } from "../lib/api.generated";

  let message = $state("Ready");

  async function callServer() {
    const result = await api.greeting.post({ body: { name: "Svelte" } });
    if (result.data) message = result.data.message;
  }
</script>

<button type="button" onclick={callServer}>{message}</button>
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets remain
in the server bundle.

## Current boundaries

Use the Svelte-native bindings for router, action, server-query, theme, and i18n stores:

```svelte
<script lang="ts">
  import { createAction, createRouter, createTheme } from "@farm.js/svelte/bindings";

  const router = createRouter();
  const save = createAction(saveProduct);
  const theme = createTheme();
</script>

<button on:click={() => save({ name: "FARMJS" })} disabled={$save.pending}>Save</button>
```

The returned values implement Svelte's readable-store contract. Renderer-specific `Link` and form
components, fetchers, integration providers, programmatic UI routes, Markdown/MDX visual pages,
the docs adapter, and generated JSX metadata images remain React-oriented today.

The Better Auth starter includes native Svelte routes, runes, and forms:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-auth-app --template better-auth --renderer svelte --typescript
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
