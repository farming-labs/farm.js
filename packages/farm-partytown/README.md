# `@farm.js/partytown`

Run explicitly opted-in third-party scripts in a web worker with
[Partytown](https://partytown.qwik.dev/), while Farm owns the development and production asset
setup.

## Install

```bash
pnpm add @farm.js/partytown
```

The Partytown runtime is included. Applications do not need to install `@qwik.dev/partytown`
separately.

## Use

Create one typed bridge that can be imported by both the Farm config and browser components:

```ts
// src/lib/analytics.ts
import { defineForward } from "@farm.js/partytown/client";

export const track =
  defineForward<
    (event: string, options?: { props?: Record<string, string | number | boolean> }) => void
  >("plausible");
```

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { partytown } from "@farm.js/partytown";
import { track } from "./src/lib/analytics";

export default defineConfig({
  plugins: [partytown({ forward: [track] })],
});
```

Mark only the vendor scripts that should move to the worker:

```tsx
// src/app/layout.tsx
import type { LayoutProps } from "@farm.js/core";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <>
      <script
        type="text/partytown"
        defer
        data-domain="yourdomain.com"
        src="https://plausible.io/js/script.js"
      />
      <main>{children}</main>
    </>
  );
}
```

```tsx
"use client";

import { track } from "../lib/analytics";

export function UpgradeButton() {
  return <button onClick={() => track("Upgrade", { props: { plan: "pro" } })}>Upgrade</button>;
}
```

`defineForward()` is fire-and-forget. It preserves the argument types supplied by the application,
but its return type is always `void` because a worker call cannot synchronously return a vendor SDK
result.

## Options

```ts
partytown({
  forward: [track, "dataLayer.push"],
  debug: false,
  fallbackTimeout: 4_000,
  strictProxyHas: true,
});
```

- `forward` lists only the global calls the browser must queue and send to the worker.
- `debug` defaults to `true` in development and `false` in production.
- `fallbackTimeout` controls how long Partytown waits before running opted-in scripts on the main
  thread. Use `0` to disable that fallback.
- `strictProxyHas` is an escape hatch for scripts that rely on strict JavaScript `in` behavior.

Pass `{ preserveBehavior: true }` to `defineForward()` only when an existing main-thread function
must also run:

```ts
const push = defineForward<(event: Record<string, unknown>) => number>("dataLayer.push", {
  preserveBehavior: true,
});
```

The typed caller still returns `void`.

## Behavior and limits

- Farm serves the Partytown bootstrap and worker files from the app's own `~partytown` path in
  development and copies them into the correct Nitro public output for production and `basePath`.
- The bootstrap is an external same-origin script, so the plugin does not add plugin-owned inline
  JavaScript. Vendor origins may still need to be allowed by the application's CSP.
- Scripts remain on the main thread unless the application marks them with `type="text/partytown"`.
- DOM-heavy widgets, consent UIs, and SDK methods that synchronously return values may not be good
  worker candidates. Leave those as normal scripts.
- Injecting the required head bootstrap uses Farm's final HTML transform, so enabling this plugin
  buffers the rendered document instead of preserving streamed HTML delivery.
