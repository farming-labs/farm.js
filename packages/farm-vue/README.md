# @farm.js/vue

Vue renderer for Farm.js applications. It compiles `.vue` Single-File Components, renders them on
the server with `createSSRApp` and Vue's Node or Web streams, and hydrates the page in the browser.
Farm keeps routing, layouts, API routes, middleware, and deployment output.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/core @farm.js/vue vue
```

`@farm.js/core` (`>=0.1.0 <0.2.0`) and `vue` (`^3.5.44`) are peer dependencies.
`@vitejs/plugin-vue` and `@vue/server-renderer` are installed with the adapter.

To start a new project with Vue already selected:

```bash
pnpm create @farm.js/app my-vue-app --template basic --renderer vue
```

The Better Auth starter also ships native Vue routes, composables, and forms with
`--template better-auth`.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
});
```

The renderer is application-wide, so do not mix Vue route components with another renderer's
components in the same route tree.

## Pages and layouts

Routes are `.vue` files such as `src/app/layout.vue`, `src/app/page.vue`, and
`src/app/products/[id]/page.vue`. Put Farm route exports in a normal `<script>` block and the
component in `<script setup>`. A layout renders its children through the default slot:

```vue
<script lang="ts">
import type { Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js with Vue",
};
</script>

<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <slot />
</template>
```

`inheritAttrs: false` keeps Farm route props such as `path` from falling through to the root DOM
element. Declare them with `defineProps` when the page needs them.

To hydrate an interactive route, export `hydrate = true` from the normal script:

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

For TypeScript, the starter adds a `src/env.d.ts` that declares `*.vue` modules.

## Install Vue plugins

Pass an app setup module to `vue({ app })` to install plugins such as Pinia or vue-i18n. The path
is relative to the project root, and the module must default-export a function:

```ts
// farm.config.ts
export default defineConfig({
  renderer: vue({ app: "./src/vue-app.ts" }),
});
```

```ts
// src/vue-app.ts
import { defineVueApp } from "@farm.js/vue";
import { createPinia } from "pinia";

export default defineVueApp((app, { ssr }) => {
  app.use(createPinia());
});
```

Farm calls the function for every Vue app it creates: once per server render, so plugin state is
never shared between requests, and once for each hydrated root in the browser. `ssr` is `true` on
the server. Server state is not transferred to the browser, so stores start from their initial
state when the page hydrates.

## Client bindings

Import router, action, query, theme, and i18n state from `@farm.js/vue/bindings`. The composables
return Vue refs and computed values.

| Export                       | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `useRouter`                  | Path, params, search params, and navigation methods      |
| `useAction`                  | Callable server function with `pending`, `data`, `error` |
| `useServerQuery`             | Cached server query with `data`, `status`, `refetch()`   |
| `useTheme`                   | `theme`, `resolvedTheme`, `setTheme`, `toggleTheme`      |
| `useI18n`, `useTranslations` | Locale state and a reactive translator                   |

```vue
<script setup lang="ts">
import { useAction, useRouter } from "@farm.js/vue/bindings";
import { saveProduct } from "../lib/products";

const router = useRouter();
const save = useAction(saveProduct);
const pending = save.pending;

async function onSave() {
  await save({ name: "Farm" });
  await router.push("/products");
}
</script>

<template>
  <button type="button" :disabled="pending" @click="onSave">Save</button>
</template>
```

`saveProduct` is a server function created with `createServerFn` from `@farm.js/core/server-fn`.

## Current boundaries

Renderer-specific `Link` and form components, integration UI providers, programmatic UI routes,
Markdown and MDX visual pages, the docs adapter, and generated JSX metadata images remain
React-oriented today. Production client and server graphs build one after the other for Vue,
because `@vitejs/plugin-vue` shares compiler caches between plugin instances.

## Entry points

| Subpath                 | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `@farm.js/vue`          | The `vue()` factory, `defineVueApp`, and the `VUE_RENDERER` descriptor. |
| `@farm.js/vue/bindings` | Ref-based router, action, query, theme, and i18n composables.           |
| `@farm.js/vue/vite`     | Vite plugin wrapping `@vitejs/plugin-vue`.                              |
| `@farm.js/vue/server`   | Server rendering to a string, a Node stream, or a Web stream.           |
| `@farm.js/vue/client`   | Browser hydration through `createSSRApp`.                               |

Farm loads the `vite`, `server`, and `client` entries from the renderer descriptor. Applications
normally import only the package root and `/bindings`.

## Documentation

- [Vue renderer guide](https://farmjs.dev/docs/renderers/vue)
- [Renderer support matrix](https://farmjs.dev/docs/renderers)
- [Vue renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/vue-renderer)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
