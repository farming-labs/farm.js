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
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-solid-app --template basic --renderer solid --typescript
```

For an existing Basic app, install the adapter and Solid runtime:

```bash
pnpm add @farm.js/solid@beta solid-js
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
renderer-neutral. Use the generated API client from Solid UI and keep the privileged handler in a
server module:

```tsx
"use client";

import { createSignal } from "solid-js";
import { api } from "../../lib/api.generated";

export function Greeting() {
  const [message, setMessage] = createSignal("Ready");

  const callServer = async () => {
    const result = await api.greeting.post({ body: { name: "Solid" } });
    if (result.data) setMessage(result.data.message);
  };

  return <button onClick={callServer}>{message()}</button>;
}
```

## Current boundaries

Use the Solid-native bindings for reactive router, action, server-query, theme, and i18n state:

```tsx
import { useAction, useRouter, useTheme } from "@farm.js/solid/bindings";

const router = useRouter();
const save = useAction(saveProduct);
const theme = useTheme();

await save({ name: "FARMJS" });
await router.push("/products");
theme.toggleTheme();
```

The binding properties are backed by Solid signals. Renderer-specific `Link` and form components,
fetchers, integration providers, programmatic UI routes, Markdown/MDX visual pages, the docs
adapter, and generated JSX metadata images remain React-oriented today.

The Better Auth starter includes native Solid routes, signals, and forms:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-auth-app --template better-auth --renderer solid --typescript
```

Other integration starter templates currently target React, so add their renderer-neutral provider
code to a native Basic starter.

Run the complete example:

```bash
pnpm --filter farm-solid-renderer-example dev
```

See the [Solid renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/solid-renderer)
and the [renderer support matrix](/docs/renderers).
