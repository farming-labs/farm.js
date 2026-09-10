---
title: "Partytown"
description: "Move explicitly opted-in third-party scripts off the browser main thread with a typed Farm.js plugin."
section: "Plugin Ecosystem"
---

# Partytown

`@farm.js/partytown` moves compatible analytics and tag-manager scripts into a web worker. Farm
serves Partytown's same-origin runtime in development, copies it into the correct production output,
and injects its bootstrap. Your application still chooses every script and global call that moves.

This is useful when a third-party SDK spends meaningful main-thread time parsing JavaScript or
handling analytics events. It is not a blanket switch for every script on a page.

## Install

```bash
pnpm add @farm.js/partytown
```

The package includes the Partytown runtime, so no second Partytown dependency is required.

## Full example

Create a typed, fire-and-forget caller. This replaces an untyped `window.plausible(...)` access in
application components.

**src/lib/analytics.ts**

```ts
import { defineForward } from "@farm.js/partytown/client";

type PlausibleOptions = {
  props?: Record<string, string | number | boolean>;
};

export const track =
  defineForward<(event: string, options?: PlausibleOptions) => void>("plausible");
```

Pass that same value to the plugin. The function carries its forward path, so the configuration and
the call site cannot drift onto two different strings.

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { partytown } from "@farm.js/partytown";
import { track } from "./src/lib/analytics";

export default defineConfig({
  plugins: [partytown({ forward: [track] })],
});
```

The vendor URL belongs in the application layout. `type="text/partytown"` is the explicit opt-in
that prevents the browser from executing this script on the main thread.

**src/app/layout.tsx**

```tsx
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

Call the typed bridge from a client component:

**src/components/UpgradeButton.tsx**

```tsx
"use client";

import { track } from "../lib/analytics";

export function UpgradeButton() {
  return <button onClick={() => track("Upgrade", { props: { plan: "pro" } })}>Upgrade</button>;
}
```

The token or site identifier used by a browser analytics SDK is public configuration. Never place a
server secret in the layout, the forward arguments, or any browser bundle.

## SDKs that require initialization

Keep provider initialization with the provider script and mark both as Partytown scripts. For
example, a Mixpanel-style setup looks like this:

```tsx
<script
  type="text/partytown"
  src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"
/>
<script type="text/partytown">
  {`mixpanel.init("YOUR_PUBLIC_PROJECT_TOKEN", { track_pageview: true });`}
</script>
```

Then define and forward the method used by application code:

```ts
export const track =
  defineForward<(event: string, properties?: Record<string, string | number | boolean>) => void>(
    "mixpanel.track",
  );
```

Use the initialization snippet recommended by the provider when it does more than a direct
`init()` call.

## Options

```ts
partytown({
  forward: [track, "dataLayer.push"],
  debug: false,
  fallbackTimeout: 4_000,
  strictProxyHas: true,
});
```

| Option            | Default                           | Purpose                                                                |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `forward`         | `[]`                              | Typed handles or safe dotted global paths to forward into the worker.  |
| `debug`           | Development `true`, build `false` | Select the readable Partytown debug runtime.                           |
| `fallbackTimeout` | Partytown default                 | Wait time before opted-in scripts fall back to the main thread.        |
| `strictProxyHas`  | Partytown default                 | Escape hatch for SDKs that depend on strict JavaScript `in` semantics. |

Set `fallbackTimeout: 0` when a main-thread fallback is less desirable than dropping the optional
third-party script.

There is no `enabled` option. Adding `partytown()` enables the plugin; removing it disables the
plugin and all of its runtime and build work.

## Preserve an existing function

Partytown normally replaces a forwarded main-thread function with its queue. If an existing
implementation must continue running, opt in while defining the bridge:

```ts
const push = defineForward<(event: Record<string, unknown>) => number>("dataLayer.push", {
  preserveBehavior: true,
});
```

The bridge still returns `void`. Worker calls cannot synchronously return a vendor result to browser
code.

## What Farm handles

- The bootstrap and worker files are served under `/~partytown/`, including a configured
  `basePath`.
- Production assets land in Nitro's public directory, including the separate Vercel static output.
- Debug worker files are omitted from production unless `debug: true` is explicit.
- The bootstrap is an external same-origin script rather than plugin-owned inline JavaScript.

Partytown's worker scope can coexist with a root PWA service worker because the browser selects the
most specific matching scope.

## Compatibility and tradeoffs

Partytown proxies browser APIs, but not every third-party script is a good worker candidate. Keep
DOM-heavy widgets, consent interfaces, and APIs that require synchronous return values on the main
thread. Test each provider's important flows in a production build.

The plugin uses Farm's final HTML transform because Partytown's bootstrap must be present in the
document head before opted-in scripts run. Farm buffers that document when the plugin is enabled, so
this trades streamed HTML delivery for less third-party work on the browser main thread. Measure the
result for your application rather than assuming every page wins.

For Content Security Policy, allow the vendor's required script and network origins. Farm's own
bootstrap and workers stay same-origin. See Partytown's
[configuration](https://partytown.qwik.dev/configuration/) and
[tested services](https://partytown.qwik.dev/common-services/) when evaluating an SDK.
