---
title: "React Renderer"
description: "Use FARMJS with the default React renderer, including client hooks, integrations, streaming SSR, and experimental Server Components."
section: "Core"
---

# React Renderer

React is the default FARMJS renderer and has the broadest client-feature support. Existing projects
do not need a renderer option or an additional adapter package.

## Create an app

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
```

Omitting `renderer` keeps React active:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({});
```

## Route components

React routes use `.tsx` or `.jsx` files:

```text
src/app/layout.tsx
src/app/page.tsx
src/app/products/[id]/page.tsx
```

```tsx
import type { LayoutProps, Metadata } from "@farm.js/core";
import "./globals.css";

export const metadata: Metadata = {
  title: "My FARMJS app",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main>{children}</main>;
}
```

Add `"use client"` to an interactive component. FARMJS keeps ordinary server-rendered routes out of
the browser bundle and hydrates the client boundaries imported by the route.

```tsx
"use client";

import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}
```

## React-specific FARMJS APIs

Choose React when the application needs the complete built-in client layer:

- `Link`, `useRouter`, `useNavigation`, and scroll restoration;
- `useAction`, fetcher forms, mutations, and server-query hooks;
- `useTheme`, `useLocale`, translations, and the built-in auth hook;
- integration providers and generated integration UI;
- Markdown/MDX visual routes and the docs adapter;
- generated JSX metadata images;
- experimental React Server Components and optimized Strata boundaries.

Server APIs such as endpoints, server functions, middleware, storage, caching, observability, and
deployment use the same contracts described in the renderer overview.

## Production rendering

The React adapter supports string rendering and streaming when the active production runtime can
use `renderToPipeableStream`. Static generation, ISR, PPR, and ordinary dynamic rendering continue
to follow route configuration rather than the component extension.

See [Rendering Model](/docs/server-rendering) for rendering modes and
[Renderers](/docs/renderers) for the cross-renderer support matrix.
