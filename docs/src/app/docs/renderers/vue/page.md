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
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-vue-app --template basic --renderer vue --typescript
```

For an existing Basic app, install the adapter and Vue runtime:

```bash
pnpm add @farm.js/vue@beta vue
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

FARMJS server-renders the SFC with `createSSRApp` and Vue's native Node or WHATWG Web stream, then
uses `createSSRApp` again to claim the existing browser markup.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Use the generated typed API client from the SFC:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { api } from "../lib/api.generated";

const message = ref("Ready");

async function callServer() {
  const result = await api.greeting.post({ body: { name: "Vue" } });
  if (result.data) message.value = result.data.message;
}
</script>

<template>
  <button type="button" @click="callServer">{{ message }}</button>
</template>
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets remain
in the server bundle.

## Current boundaries

Use the Vue-native composables for reactive router, action, server-query, theme, and i18n state:

```ts
import { useAction, useRouter, useTheme } from "@farm.js/vue/bindings";

const router = useRouter();
const save = useAction(saveProduct);
const theme = useTheme();

await save({ name: "FARMJS" });
await router.push("/products");
theme.toggleTheme();
```

The composables return Vue refs and computed values. Renderer-specific `Link` and form components,
fetchers, integration providers, programmatic UI routes, Markdown/MDX visual pages, the docs
adapter, and generated JSX metadata images remain React-oriented today.

The Better Auth starter includes native Vue SFC routes, composables, and forms:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-auth-app --template better-auth --renderer vue --typescript
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
