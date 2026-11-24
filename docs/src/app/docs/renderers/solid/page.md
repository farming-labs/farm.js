---
title: "Solid Renderer"
description: "Use Solid components, signals, SSR, and hydration with FARMJS routing and renderer-neutral server primitives."
section: "Core"
---

# Solid Renderer

`@farm.js/solid` connects Solid component compilation, server rendering, and browser hydration to
the FARMJS renderer contract. React remains the default unless the application selects Solid.

## Create an app

```bash
pnpm create @farm.js/app my-solid-app --template basic --renderer solid --typescript
```

For an existing Basic app, install the adapter and Solid runtime:

```bash
pnpm add @farm.js/solid solid-js
```

```ts
import { defineConfig } from "@farm.js/core";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
});
```

## Pages and layouts

Solid routes use `.tsx` or `.jsx`. Layout children arrive through the normal `children` property:

```tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS with Solid",
};

export default function RootLayout(props: LayoutProps) {
  return <>{props.children}</>;
}
```

Use Solid primitives inside interactive components and mark the component with `"use client"`:

```tsx
"use client";

import { createSignal } from "solid-js";

export function Counter() {
  const [count, setCount] = createSignal(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count()}</button>;
}
```

FARMJS streams the route through Solid's native SSR runtime and hydrates the Solid boundary in the
browser. The adapter exposes both Node and WHATWG Web stream modes.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Call them from Solid UI with `apiClient`, created once in `src/lib/api.ts` as shown in [API Client](/docs/api-client#create-both-callers-once), and keep the privileged handler in a server
module:

```tsx
"use client";

import { createSignal } from "solid-js";
import { apiClient } from "../../lib/api";

export function Greeting() {
  const [message, setMessage] = createSignal("Ready");

  const callServer = async () => {
    const result = await apiClient.greeting.post({ body: { name: "Solid" } });
    if (result.data) setMessage(result.data.message);
  };

  return <button onClick={callServer}>{message()}</button>;
}
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets remain
in the server bundle. With `experimental.serverActions`, browser code can also import the server function and call it
directly; see [callable actions](/docs/renderers#native-client-bindings).

## Current boundaries

Use the Solid-native bindings for reactive router, theme, and i18n state:

```tsx
import { useRouter, useTheme } from "@farm.js/solid/bindings";

const router = useRouter();
const theme = useTheme();

await router.push("/products");
theme.toggleTheme();
```

`useAction` and `useServerQuery` take a server function or server query imported from its server
module, which needs `experimental.serverActions`; see
[callable actions](/docs/renderers#native-client-bindings).

The binding properties are backed by Solid signals. `useStore(store)` binds your own state, a
store from `createStore` in `@farm.js/core/renderer-client`, to an accessor; see
[Shared client state](/docs/renderers#shared-client-state). `Link` from `@farm.js/solid/bindings`
navigates and prefetches like the React one; see [Link in Solid, Vue, and Svelte](/docs/routing#link-in-solid-vue-and-svelte).
`useAction(fn).Form` renders a form that submits through the action; see
[action forms](/docs/renderers#action-forms). Fetchers and integration providers remain
React-oriented today. `withDocs()` from `@farming-labs/farmjs` builds docs pages with Solid;
see [Docs adapters on any renderer](/docs/docs-engine#docs-adapters-on-any-renderer). Markdown and MDX pages and [programmatic UI routes](/docs/routing#programmatic-routes) render with Solid, and so
do [generated metadata images](/docs/routing#generated-metadata-images) written in Solid JSX.

The Better Auth starter includes native Solid routes, signals, and forms:

```bash
pnpm create @farm.js/app my-auth-app --template better-auth --renderer solid --typescript
```

Other integration starter templates currently target React, so add their renderer-neutral provider
code to a native Basic starter.

Run the complete example:

```bash
pnpm --filter farm-solid-renderer-example dev
```

See the [Solid renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/solid-renderer)
and the [renderer support matrix](/docs/renderers).
