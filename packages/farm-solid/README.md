# @farm.js/solid

Solid renderer for Farm.js applications. It compiles route components with Solid's JSX compiler,
streams server-rendered HTML, and hydrates the page in the browser. Farm keeps routing, layouts,
API routes, middleware, and deployment output.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/core @farm.js/solid solid-js
```

`@farm.js/core` (`>=0.1.0 <0.2.0`) and `solid-js` (`^1.9.18`) are peer dependencies.
`vite-plugin-solid` is installed with the adapter.

To start a new project with Solid already selected:

```bash
pnpm create @farm.js/app my-solid-app --template basic --renderer solid
```

The Better Auth starter also ships native Solid routes, signals, and forms with
`--template better-auth`.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
});
```

`solid()` takes no options. The renderer is application-wide, so do not mix Solid route components
with another renderer's components in the same route tree.

## Pages and layouts

Routes are `.tsx` or `.jsx` files under `src/app`. Layout children arrive through the normal
`children` prop:

```tsx
// src/app/layout.tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js with Solid",
};

export default function RootLayout(props: LayoutProps) {
  return <>{props.children}</>;
}
```

Mark interactive components with `"use client"` and use Solid primitives:

```tsx
"use client";

import { createSignal } from "solid-js";

export function Counter() {
  const [count, setCount] = createSignal(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count()}</button>;
}
```

For TypeScript, the starter sets `"jsx": "preserve"` and `"jsxImportSource": "solid-js"` in
`tsconfig.json`.

## Client bindings

Import router, action, query, theme, and i18n state from `@farm.js/solid/bindings` instead of
React hooks. The returned properties are getters backed by Solid signals, so read them in place
(for example `router.pathname`) rather than destructuring them.

| Export                       | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `useRouter`                  | Path, params, search params, and navigation methods      |
| `useAction`                  | Callable server function with `pending`, `data`, `error` |
| `useServerQuery`             | Cached server query with `data`, `status`, `refetch()`   |
| `useTheme`                   | `theme`, `resolvedTheme`, `setTheme`, `toggleTheme`      |
| `useI18n`, `useTranslations` | Locale state and a reactive translator                   |

```tsx
"use client";

import { useAction, useRouter } from "@farm.js/solid/bindings";
import { saveProduct } from "../lib/products";

export function SaveProduct() {
  const router = useRouter();
  const save = useAction(saveProduct);

  const onSave = async () => {
    await save({ name: "Farm" });
    await router.push("/products");
  };

  return (
    <button onClick={onSave} disabled={save.pending}>
      Save
    </button>
  );
}
```

`saveProduct` is a server function created with `createServerFn` from `@farm.js/core/server-fn`.
Server queries share Farm's browser cache, invalidation, and deduplication with every other
renderer.

## Navigation and rendering

Solid has no virtual DOM, so re-rendering a root with a new tree replaces its nodes. On client
navigation the adapter keeps the matching layout chain mounted and updates the page slot and route
params through signals, which preserves layout state. Moving to a route with a different layout
chain mounts the new chain.

Server rendering supports both Node and Web streams on every target.

## Current boundaries

Renderer-specific `Link` and form components, integration UI providers, programmatic UI routes,
Markdown and MDX visual pages, the docs adapter, and generated JSX metadata images remain
React-oriented today. React Server Components do not apply to Solid.

## Entry points

| Subpath                   | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `@farm.js/solid`          | The `solid()` factory and the `SOLID_RENDERER` descriptor.    |
| `@farm.js/solid/bindings` | Signal-backed router, action, query, theme, and i18n state.   |
| `@farm.js/solid/vite`     | Vite plugin wrapping `vite-plugin-solid` with hydratable SSR. |
| `@farm.js/solid/server`   | Server rendering to a string, a Node stream, or a Web stream. |
| `@farm.js/solid/client`   | Browser hydration and route updates.                          |

Farm loads the `vite`, `server`, and `client` entries from the renderer descriptor. Applications
normally import only the package root and `/bindings`.

## Documentation

- [Solid renderer guide](https://farmjs.dev/docs/renderers/solid)
- [Renderer support matrix](https://farmjs.dev/docs/renderers)
- [Solid renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/solid-renderer)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
