---
title: "Vue Renderer"
description: "Use Vue Single-File Components, SSR, hydration, and typed FARMJS server calls through the @farm.js/vue adapter."
section: "Core"
---

# Vue Renderer

`@farm.js/vue` connects Vue Single-File Component compilation, `createSSRApp` rendering, and browser
hydration to the FARMJS renderer contract. React remains the default unless the application selects
Vue.

## Create an app

```bash
pnpm create @farm.js/app my-vue-app --template basic --renderer vue --typescript
```

For an existing Basic app, install the adapter and Vue runtime:

```bash
pnpm add @farm.js/vue vue
```

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
});
```

## Pages and layouts

Vue routes use `.vue` files:

```text
src/app/layout.vue
src/app/page.vue
src/app/products/[id]/page.vue
```

Use a normal script for FARMJS route exports and `<script setup>` for the Vue component. A layout
renders its children through the default slot:

```vue
<script lang="ts">
import type { Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS with Vue",
};
</script>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <slot />
</template>
```

`inheritAttrs: false` prevents FARMJS route props such as `path` from falling through to the root
DOM element. Declare the props with `defineProps` when the page needs them.

## Hydrate interactive routes

Export `hydrate = true` from the route's normal script, then use Vue state and events normally:

```vue
<script lang="ts">
export const hydrate = true;
</script>

<script setup lang="ts">
import { ref } from "vue";

defineOptions({ inheritAttrs: false });

const count = ref(0);
</script>

<template>
  <button type="button" @click="count += 1">Count: {{ count }}</button>
</template>
```

FARMJS reads `hydrate` from the file before Vue compiles it, so write the literal `true` or `false`. Any declaration works,
including a type annotation or an export list. A value FARMJS can't read without running the code,
such as an expression, an import, or a re-export, fails the build with an error that names the file.

FARMJS server-renders the SFC with `createSSRApp` and Vue's native Node or WHATWG Web stream, then
uses `createSSRApp` again to claim the existing browser markup. Output starts once the render waits
on unfinished work, such as an `await` in `<script setup>`. A `redirect()`, `notFound()`, or error
thrown before that sets the response status, in development and production. One thrown after it
arrives once the response has started, so the status stays 200.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Call them from the SFC with `apiClient`, created once in `src/lib/api.ts` as shown in [API Client](/docs/api-client#create-both-callers-once):

```vue
<script setup lang="ts">
import { ref } from "vue";
import { apiClient } from "../lib/api";

const message = ref("Ready");

async function callServer() {
  const result = await apiClient.greeting.post({ body: { name: "Vue" } });
  if (result.data) message.value = result.data.message;
}
</script>

<template>
  <button type="button" @click="callServer">{{ message }}</button>
</template>
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets remain
in the server bundle. With `experimental.serverActions`, browser code can also import the server function and call it
directly; see [callable actions](/docs/renderers#native-client-bindings).

## Install Vue plugins

Pass an app setup module to `vue()` to install plugins such as Pinia, vue-i18n, or a component
library with `app.use()`:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue({ app: "./src/vue-app.ts" }),
});
```

**src/vue-app.ts**

```ts
import { defineVueApp } from "@farm.js/vue";
import { createPinia } from "pinia";

export default defineVueApp((app, { ssr }) => {
  app.use(createPinia());
});
```

Farm calls the function for every Vue app it creates: once per server render, so plugin state such
as a Pinia store is never shared between requests, and once for each hydrated root in the browser.
`ssr` is `true` on the server. State created during the server render is not transferred to the
browser; stores start from their initial state when the page hydrates. In development, edits to the
module apply on the next request.

## Current boundaries

Use the Vue-native composables for reactive router, theme, and i18n state:

```ts
import { useRouter, useTheme } from "@farm.js/vue/bindings";

const router = useRouter();
const theme = useTheme();

await router.push("/products");
theme.toggleTheme();
```

`useAction` and `useServerQuery` take a server function or server query imported from its server
module, which needs `experimental.serverActions`; see
[callable actions](/docs/renderers#native-client-bindings).

The composables return Vue refs and computed values. `useStore(store)` binds your own state, a
store from `createStore` in `@farm.js/core/renderer-client`, to a read-only ref; see
[Shared client state](/docs/renderers#shared-client-state). `Link` from `@farm.js/vue/bindings`
navigates and prefetches like the React one; see [Link in Solid, Vue, and Svelte](/docs/routing#link-in-solid-vue-and-svelte).
`useAction(fn).Form` renders a form that submits through the action; see
[action forms](/docs/renderers#action-forms). Fetchers and integration providers remain
React-oriented today. `withDocs()` from `@farming-labs/farmjs` builds docs pages with Vue;
see [Docs adapters on any renderer](/docs/docs-engine#docs-adapters-on-any-renderer). Markdown and MDX pages and [programmatic UI routes](/docs/routing#programmatic-routes) render with Vue, and an
`opengraph-image.vue` component draws a
[generated metadata image](/docs/routing#generated-metadata-images).

The Better Auth starter includes native Vue SFC routes, composables, and forms:

```bash
pnpm create @farm.js/app my-auth-app --template better-auth --renderer vue --typescript
```

Other integration starter templates currently target React, so add their renderer-neutral provider
code to a native Basic starter.

Run the complete example:

```bash
pnpm --filter farm-vue-renderer-example dev
```

See the [Vue renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/vue-renderer),
the [renderer support matrix](/docs/renderers), and Vue's
[SSR guide](https://vuejs.org/guide/scaling-up/ssr).
