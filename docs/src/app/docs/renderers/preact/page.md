---
title: "Preact Renderer"
description: "Use Preact components, hooks, SSR, streaming, hydration, and typed FARMJS server calls through the @farm.js/preact adapter."
section: "Core"
---

# Preact Renderer

`@farm.js/preact` connects Preact JSX compilation, server rendering and streaming, browser
hydration, and Prefresh to the FARMJS renderer contract. React remains the default unless the
application selects Preact.

## Create an app

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-preact-app --template basic --renderer preact --typescript
```

For an existing Basic app, install the adapter and Preact:

```bash
pnpm add @farm.js/preact@beta preact
```

```ts
import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
});
```

## Pages and layouts

Preact routes use `.tsx` or `.jsx`. Layout children use Preact's `ComponentChildren` type:

```tsx
import type { Metadata } from "@farm.js/core";
import type { ComponentChildren } from "preact";
import "./globals.css";

export const metadata: Metadata = {
  title: "FARMJS with Preact",
};

export default function RootLayout({ children }: { children?: ComponentChildren }) {
  return <>{children}</>;
}
```

## Hydrate interactive routes

Mark an interactive component with `"use client"`, then use Preact hooks normally:

```tsx
"use client";

import { useState } from "preact/hooks";

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}
```

FARMJS renders route HTML with `preact-render-to-string`, uses its Node or Web streaming runtime
when the deployment supports streaming, and calls Preact's `hydrate()` to claim the existing DOM.
See Preact's [API reference](https://preactjs.com/guide/v10/api-reference/) and
[server-rendering guide](https://preactjs.com/guide/v10/server-side-rendering/) for runtime-specific
behavior.

## Call FARMJS server code

API routes, endpoint schemas, server functions, middleware, cache, storage, and observability are
renderer-neutral. Use the generated API client from Preact UI:

```tsx
"use client";

import { useState } from "preact/hooks";
import { api } from "../lib/api.generated";

export function Greeting() {
  const [message, setMessage] = useState("Ready");

  const callServer = async () => {
    const result = await api.greeting.post({ body: { name: "Preact" } });
    if (result.data) setMessage(result.data.message);
  };

  return <button onClick={callServer}>{message}</button>;
}
```

The endpoint can call a validated `createServerFn`; its handler, database access, and secrets stay
in the server bundle.

## React compatibility

The renderer uses the official `@preact/preset-vite`, which aliases React and React DOM imports to
`preact/compat`. This lets many existing FARMJS client components and hooks run without shipping a
second UI runtime. Compatibility for third-party React integration providers still depends on each
provider, so verify provider UI before relying on it in production.

React Server Components remain React-only. Programmatic UI routes, Markdown/MDX visual pages, the
docs adapter, generated JSX metadata images, and integration UI providers should be treated as
compatibility surfaces until their Preact paths are covered by dedicated tests.

The Better Auth starter includes native Preact routes and forms:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-auth-app --template better-auth --renderer preact --typescript
```

Other integration starter templates currently target React, so add their renderer-neutral provider
code to a native Basic starter.

Run the complete example:

```bash
pnpm --filter farm-preact-renderer-example dev
```

See the [Preact renderer example](https://github.com/farming-labs/farm.js/tree/main/examples/preact-renderer)
and the [renderer support matrix](/docs/renderers).

Preact applications can import FARMJS client hooks from `@farm.js/preact/bindings`. The adapter
routes those React-shaped hooks through its existing `preact/compat` aliases.
