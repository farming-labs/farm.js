# @farm.js/preact

Preact renderer for Farm.js applications. It compiles route components as Preact JSX, renders them
on the server with Node or Web streaming, hydrates them in the browser, and enables Prefresh for
hot updates. Farm keeps routing, layouts, API routes, middleware, and deployment output.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add @farm.js/core @farm.js/preact preact
```

`@farm.js/core` (`>=0.1.0 <0.2.0`) and `preact` (`^10.29.8`) are peer dependencies. The Vite
preset (`@preact/preset-vite`) and `preact-render-to-string` are installed with the adapter.

To start a new project with Preact already selected:

```bash
pnpm create @farm.js/app my-preact-app --template basic --renderer preact
```

The Better Auth starter also ships native Preact routes and forms with `--template better-auth`.

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
});
```

`preact()` takes no options. The renderer is application-wide, so do not mix Preact route
components with another renderer's components in the same route tree.

## Pages and layouts

Routes are `.tsx` or `.jsx` files under `src/app`. Layout children use Preact's
`ComponentChildren` type:

```tsx
// src/app/layout.tsx
import type { Metadata } from "@farm.js/core";
import type { ComponentChildren } from "preact";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farm.js with Preact",
};

export default function RootLayout({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}
```

Mark interactive components with `"use client"` and use Preact hooks normally:

```tsx
"use client";

import { useState } from "preact/hooks";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}
```

For TypeScript, the starter sets `"jsx": "react-jsx"` and `"jsxImportSource": "preact"` in
`tsconfig.json`. Async function components are rejected with an actionable error instead of
rendering an empty string, so resolve data before rendering the component.

## Client bindings

`@farm.js/preact/bindings` re-exports Farm's client hooks. They are React-shaped and run on Preact
through the `preact/compat` aliases, so no second UI runtime ships to the browser.

| Export                                                                             | Purpose                     |
| ---------------------------------------------------------------------------------- | --------------------------- |
| `useRouter`, `useNavigation`, `usePageState`, `useBlocker`, `useScrollRestoration` | Router state and navigation |
| `useAction`                                                                        | Call a server function      |
| `useServerQuery`                                                                   | Read a cached server query  |
| `useTheme`                                                                         | Read and change the theme   |
| `useLocale`, `useTranslations`                                                     | i18n state and translations |

```tsx
"use client";

import { useRouter, useTheme } from "@farm.js/preact/bindings";

export function Toolbar() {
  const router = useRouter();
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <nav>
      <button onClick={() => router.push("/products")}>Products</button>
      <button onClick={() => toggleTheme()}>Theme: {resolvedTheme}</button>
    </nav>
  );
}
```

API routes, server functions, the generated API client, cache, and storage are renderer-neutral
and work from Preact components unchanged.

## React compatibility

`@preact/preset-vite` aliases `react` and `react-dom` imports to `preact/compat`, which lets many
existing client components and hooks run without changes. Third-party React integration UI depends
on each provider, so verify it before relying on it in production.

React Server Components remain React-only. Programmatic UI routes, Markdown and MDX visual pages,
the docs adapter, generated JSX metadata images, and integration UI providers are compatibility
surfaces under Preact.

## Entry points

| Subpath                    | Purpose                                                       |
| -------------------------- | ------------------------------------------------------------- |
| `@farm.js/preact`          | The `preact()` factory and the `PREACT_RENDERER` descriptor.  |
| `@farm.js/preact/bindings` | Client hooks for router, actions, queries, theme, and i18n.   |
| `@farm.js/preact/vite`     | Vite plugin for Preact JSX and Prefresh.                      |
| `@farm.js/preact/server`   | Server rendering to a string, a Node stream, or a Web stream. |
| `@farm.js/preact/client`   | Browser hydration through Preact's `hydrate()`.               |

Farm loads the `vite`, `server`, and `client` entries from the renderer descriptor. Applications
normally import only the package root and `/bindings`.

## Documentation

- [Preact renderer guide](https://farmjs.dev/docs/renderers/preact)
- [Renderer support matrix](https://farmjs.dev/docs/renderers)
- [Preact renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/preact-renderer)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
