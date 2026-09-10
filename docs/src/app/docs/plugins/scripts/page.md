---
title: "Scripts"
description: "Load external browser SDKs with typed handles, deliberate timing, consent gates, dependencies, retries, and Farm lifecycle integration."
section: "Plugin Ecosystem"
---

# Scripts

`@farm.js/scripts` manages browser SDKs that arrive through external `<script>` tags. It turns an
ambient global such as `window.SupportChat` into one typed application handle and owns loading,
deduplication, readiness, consent, dependencies, retries, and cleanup of its listeners.

Use it for support widgets, analytics, maps, video players, CAPTCHA, payment browser SDKs,
experimentation, personalization, advertising, or any other provider that documents a script URL
and browser global. Packages installed from npm should still use normal imports.

## Install

```bash
pnpm add @farm.js/scripts
```

## Complete example

Define each vendor script in a client-safe module. The local variable can have any name. `global`
must match the path the vendor actually creates on `window`.

**src/lib/scripts.ts**

```ts
import { defineScript } from "@farm.js/scripts/client";

interface SupportChatSDK {
  load(options: { userId: string; email?: string }): void;
  open(): void;
}

export const supportChat = defineScript<SupportChatSDK>({
  name: "support-chat",
  src: "https://cdn.example.com/support-chat.js",
  global: "SupportChat",
  load: "manual",
  preconnect: true,
  timeout: "10s",
  retries: 1,
});
```

Register the same handle once in Farm config:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";
import { scripts } from "@farm.js/scripts";
import { supportChat } from "./src/lib/scripts";

export default defineConfig({
  plugins: [scripts({ scripts: [supportChat] })],
});
```

Use the SDK from a client component without declaring a global `Window` interface:

```tsx
"use client";

import { supportChat } from "../lib/scripts";

export function HelpButton({ userId }: { userId: string }) {
  async function openChat() {
    await supportChat.use((sdk) => {
      sdk.load({ userId });
      sdk.open();
    });
  }

  return <button onClick={openChat}>Talk to support</button>;
}
```

The value named `sdk` is the real `window.SupportChat` object after the script has loaded. It is only
a callback parameter, so call it `chat`, `client`, `provider`, or anything else that reads well.

## Built-in loading strategies

`load` controls the earliest point at which Farm may request the script.

| Strategy                                | Behavior                                                          |
| --------------------------------------- | ----------------------------------------------------------------- |
| `"immediate"`                           | Starts when Farm's browser plugin runtime starts.                 |
| `"after-hydration"`                     | Starts after initial hydration. This is the default.              |
| `"idle"`                                | Starts in `requestIdleCallback`, with a short fallback timeout.   |
| `"interaction"`                         | Starts on the first pointer, keyboard, or touch interaction.      |
| `"manual"`                              | Starts only when application code calls `load()` or `use()`.      |
| `{ when: "visible", selector: "#map" }` | Starts when a matching element approaches or enters the viewport. |

Visibility loading observes elements added by client navigation as well as the initial document.
Set `rootMargin` to begin before the element reaches the viewport:

```ts
const maps = defineScript<MapsSDK>({
  name: "maps",
  src: "https://maps.example.com/sdk.js",
  global: "ExampleMaps",
  load: { when: "visible", selector: "[data-map]", rootMargin: "400px" },
});
```

If `IntersectionObserver` is unavailable, Farm loads once a matching element exists. A manual call
always honors dependencies and consent, regardless of the configured automatic strategy.

## Consent

Add a consent category to prevent a script request until the application grants it:

```ts
export const analytics = defineScript<AnalyticsSDK>({
  name: "analytics",
  src: "https://cdn.example.com/analytics.js",
  global: "ExampleAnalytics",
  load: "after-hydration",
  consent: "analytics",
});
```

Connect your consent interface to the client API:

```ts
import {
  clearScriptConsent,
  denyScriptConsent,
  getScriptConsent,
  grantScriptConsent,
} from "@farm.js/scripts/client";

grantScriptConsent("analytics");
denyScriptConsent("advertising");
clearScriptConsent("analytics");
console.log(getScriptConsent("analytics")); // "unknown" | "granted" | "denied"
```

Farm deliberately does not decide categories, display a banner, persist a choice, or claim legal
compliance. Your application or consent platform owns those decisions. Grant consent again on each
page load after restoring the user's saved choice. Granting a category starts any script whose load
trigger already fired.

Denying or clearing consent prevents future loading. Browsers cannot reliably undo code that has
already executed, so changing consent after a script is ready does not unload it.

## Dependencies

Some providers split a base SDK and an extension into separate files. `dependsOn` makes the order
explicit without relying on DOM insertion timing:

```ts
const maps = defineScript<MapsSDK>({
  name: "maps",
  src: "https://maps.example.com/sdk.js",
  global: "ExampleMaps",
  load: "manual",
});

const places = defineScript<PlacesSDK>({
  name: "places",
  src: "https://maps.example.com/places.js",
  global: "ExampleMaps.places",
  dependsOn: [maps],
  load: "manual",
});
```

Calling `places.load()` first loads `maps`, waits until it is ready, and then loads `places`. Farm
rejects missing, self-referencing, and cyclic dependencies during configuration.

## Handle API

Every `defineScript<T>()` call returns the same small interface:

| Member                | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `name`                | Stable registry name chosen by the application.                              |
| `definition`          | Read-only normalized public definition.                                      |
| `status`              | `idle`, `blocked`, `loading`, `ready`, or `error`.                           |
| `error`               | Last terminal loading error.                                                 |
| `load()`              | Loads once and resolves the typed global. Concurrent callers share the work. |
| `use(callback)`       | Waits for readiness, then calls the callback with the typed global.          |
| `subscribe(listener)` | Reports status, attempt count, and errors. Returns an unsubscribe function.  |

For a React status label, subscribe without duplicating loading state:

```tsx
"use client";

import { useSyncExternalStore } from "react";
import { supportChat } from "../lib/scripts";

export function ChatStatus() {
  const status = useSyncExternalStore(
    (onChange) => supportChat.subscribe(onChange),
    () => supportChat.status,
    () => "idle",
  );
  return <span>{status}</span>;
}
```

## Options

```ts
defineScript<VendorSDK>({
  name: "vendor",
  src: "https://cdn.example.com/vendor.js",
  global: "Vendor.sdk",
  load: "after-hydration",
  consent: "analytics",
  dependsOn: [],
  type: "classic",
  placement: "head",
  async: true,
  timeout: "15s",
  readyTimeout: "1s",
  retries: 0,
  retryDelay: "250ms",
  preconnect: false,
  id: "vendor-sdk",
  integrity: "sha384-...",
  crossOrigin: "anonymous",
  referrerPolicy: "strict-origin-when-cross-origin",
  fetchPriority: "low",
  attributes: { "data-site-id": "public-site-id" },
});
```

| Option           | Default           | Purpose                                                                  |
| ---------------- | ----------------- | ------------------------------------------------------------------------ |
| `name`           | Required          | Unique application registry name.                                        |
| `src`            | Required          | Root-relative or absolute HTTP(S) URL.                                   |
| `global`         | None              | Safe dotted browser global returned by `load()` and `use()`.             |
| `load`           | `after-hydration` | One of the built-in loading strategies.                                  |
| `consent`        | None              | App-owned category that must be granted first.                           |
| `dependsOn`      | `[]`              | Registered handles or names that must load first.                        |
| `type`           | `classic`         | `classic` or `module`.                                                   |
| `placement`      | `head`            | Append to `head` or `body`.                                              |
| `async`          | `true`            | Dynamic script async behavior. Use dependencies for meaningful ordering. |
| `timeout`        | `15s`             | Network load timeout.                                                    |
| `readyTimeout`   | `1s`              | Additional wait for the configured global after the load event.          |
| `retries`        | `0`               | Extra attempts after a network, timeout, or missing-global failure.      |
| `retryDelay`     | `250ms`           | Delay between attempts.                                                  |
| `preconnect`     | `false`           | Add one deduplicated cross-origin preconnect hint.                       |
| `id`             | None              | Script element ID.                                                       |
| `integrity`      | None              | Provider-supplied Subresource Integrity value.                           |
| `crossOrigin`    | None              | `anonymous` or `use-credentials`.                                        |
| `referrerPolicy` | Browser default   | Standard script referrer policy.                                         |
| `fetchPriority`  | Browser default   | `high`, `low`, or `auto` request hint.                                   |
| `attributes`     | `{}`              | Public vendor `data-*` attributes.                                       |

Durations accept milliseconds as numbers or short strings such as `250ms`, `5s`, and `1m`. There
is no `enabled` option. Adding `scripts()` enables the plugin; removing it disables the behavior.

## Common recipes

### Analytics after consent

Use `consent: "analytics"`, load after hydration or on interaction, and expose one app-owned
tracking function so provider calls stay in one module:

```ts
export async function track(event: string, properties?: Record<string, unknown>) {
  return analytics.use((client) => client.track(event, properties));
}
```

### Support chat on demand

Use `load: "manual"` and call `use()` from the help button. The SDK adds no network or parse cost for
visitors who never ask for help.

### Maps, video, and embeds near the viewport

Use the visible strategy with a generous `rootMargin`. This starts loading shortly before the user
reaches the placeholder while avoiding work for routes where the element never appears.

### CAPTCHA or payment browser SDK before an action

Use `manual`, call `load()` when the form becomes active, and await `use()` during submission. Only
public browser keys belong in URLs or attributes. Secret keys stay in server modules.

### Experimentation and personalization

Use `immediate` only when the provider must run before hydration and the visual tradeoff is measured.
Otherwise prefer `after-hydration`. A third-party script loader cannot guarantee flicker-free
experiments by itself.

### Base SDK plus extension

Use `dependsOn` instead of assuming two async tags execute in insertion order. Dependency loading is
transitive and deduplicated.

### Side-effect-only or module script

Omit `global` when readiness means only that the file finished executing. Set `type: "module"` for an
external browser module. `load()` then resolves `void`.

### Self-hosted vendor file

Place the file in the app's public directory and use a root-relative URL such as `/vendor/chat.js`.
Root-relative paths remain stable across routes, and Farm automatically prefixes the configured
`basePath` without double-prefixing a URL that already contains it.

### Resilient optional widget

Add a short timeout and one retry, subscribe to status, and leave the page usable when the provider
is unavailable. Do not make a page's core navigation depend on an optional third party.

## Error handling

`load()` and `use()` reject with focused client errors:

- `ScriptNotRegisteredError` when the handle was not passed to `scripts()`.
- `ScriptEnvironmentError` when browser loading is called during SSR.
- `ScriptConsentRequiredError` when its category is not granted.
- `ScriptLoadError` for a script element error event.
- `ScriptTimeoutError` when the network load exceeds `timeout`.
- `ScriptGlobalMissingError` when the file loads without creating `global`.

```ts
try {
  await supportChat.use((chat) => chat.open());
} catch (error) {
  console.warn("Support is temporarily unavailable", error);
}
```

Automatic strategies report terminal failures to the browser console and update the handle status.
They do not prevent hydration or navigation.

## Security and limits

- Every definition is serialized to the browser. URLs, IDs, attributes, and keys in this config must
  be public. Never pass a provider secret.
- Use a provider-published `integrity` value with `crossOrigin: "anonymous"` when the provider offers
  stable, versioned assets. A mutable latest URL cannot safely use a fixed integrity hash.
- Allow the provider origin in Content Security Policy. Per-request CSP nonces are not a static
  script option and should not be placed in Farm config.
- Farm validates global paths and only allows `data-*` custom attributes. It does not audit or
  sandbox vendor code.
- A loaded script can modify global browser state. Runtime cleanup removes Farm's observers,
  listeners, and timers, but cannot reverse vendor side effects.

`@farm.js/scripts` runs SDKs on the main thread. Use [`@farm.js/partytown`](/docs/plugins/partytown)
for compatible analytics scripts that should execute in a worker. Keep one owner for each script;
do not register the same vendor file in both plugins.

## Why no provider presets?

The package predefines stable behavior such as loading strategies, consent gates, dependency order,
timeouts, retries, and typed readiness. It does not hard-code vendor URLs or initialization snippets,
because those contracts change independently of Farm and often differ by account or product tier.
Copy the current URL and public options from the provider's official setup guide, then describe its
global once with `defineScript<T>()`.

See the runnable `examples/scripts-demo` app for typed analytics and support-widget flows using local
scripts with no external account.
