---
title: "Bring your own renderer"
description: "I wrote a small React-like library to find out what Farm needs from a renderer: three modules, eleven named exports, and two fixes the official renderers had been hiding."
---

# Bring your own renderer

KinfeMichael Tariku · Nov 2026

Farm ships five renderers: React, Preact, Solid, Vue, and Svelte. Every so often someone asks whether it could use a sixth, usually a library I have never written a line of. My honest answer has been "probably".

I wanted a better answer than "probably". So I wrote a UI library nobody asked for and tried to plug it in.

It's called leaf. It's 385 lines of TypeScript, it looks like React if you squint, and Farm had never heard of it. If Farm's renderer contract is real, leaf should run without a single change to core. If it isn't, leaf would show me where it breaks.

It broke in two places.

<BlogFigure kind="renderer-seams" caption="A renderer is three modules. Farm compiles routes with the Vite module, renders them to HTML with the server module, and hydrates that HTML with the client module." />

<span id="what-farm-asks-of-a-renderer" className="blog-heading-anchor" />

## What Farm asks of a renderer

A renderer is a descriptor that names three modules by package specifier. This is all of leaf's:

```ts
// farm-leaf/src/index.ts
import { defineRenderer } from "@farm.js/core/renderer";

export function leaf() {
  return defineRenderer({
    name: "leaf",
    // Module ids, not functions: farm.config.ts stays serializable and each
    // module resolves from the app's own node_modules.
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    capabilities: {
      streaming: { node: false, web: false }, // buffered SSR through renderToString()
      reconcilesRerenders: true, // patching keeps same-position DOM nodes
      functionComponents: true, // components are plain functions
    },
  });
}
```

An app selects it with `renderer: leaf()` in `farm.config.ts`. Farm resolves each module from the app and reads its named exports:

| Module   | Required named exports                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| `vite`   | `createFarmRendererPlugin`                                                          |
| `server` | `name`, `createElement`, `isValidElement`, `Fragment`, `Suspense`, `renderToString` |
| `client` | `createElement`, `Suspense`, `createRoot`, `hydrateRoot`                            |

That's eleven exports. Streaming, error boundaries, head output, and app setup are optional exports on top, listed in [Renderer modules](/docs/renderers#renderer-modules).

The surprising part is what is _not_ on the list. Routing, layouts, data loading, server functions, caching, navigation, and deployment are all Farm's. A renderer never sees a URL. **Farm composes every route into one tree with `createElement()`, and a renderer's whole job is to turn that tree into HTML on the server and into DOM in the browser.**

That's a small contract. Small enough that a weekend library should be able to meet it.

<span id="meet-leaf" className="blog-heading-anchor" />

## Meet leaf

leaf has the parts you would expect. Elements are plain objects, components are functions, state lives in hooks, and the browser patches the live DOM in place. There are no keys and no scheduler, and nothing suspends, so `Suspense` just renders its children.

You can read it and run it. A version of leaf and its adapter is in the repo at [`examples/custom-renderer`](https://github.com/farming-labs/farm.js/tree/main/examples/custom-renderer), with an app, the conformance suite, and browser tests that run it in development and in a production build. That version is plain JavaScript with type declarations, the shape a published package has, so its line counts and a few names differ from the snippets here.

The library is 316 lines for the core, 49 for `renderToString`, and 20 for the JSX runtime. The Farm adapter is smaller. The server module is a re-export with a name:

```ts
// farm-leaf/src/server.ts
import { Fragment, Suspense, createElement, isValidElement } from "leaf";

export { Fragment, Suspense, createElement, isValidElement };
export { renderToString } from "leaf/server";

export const name = "leaf";
export const capabilities = { streaming: { node: false, web: false } } as const;
```

The client module re-exports `createRoot` and `hydrateRoot` the same way. The Vite module is a 12-line plugin that points JSX at leaf's runtime. Adding the descriptor, the adapter is 52 lines.

Hooks took 38 more. Farm exposes router, query, action, theme, and i18n state as renderer-neutral stores with `getSnapshot()` and `subscribe()`, the same shape as React's `useSyncExternalStore`. A renderer wraps each store in its own reactivity once, and its users get the usual hooks:

```tsx
// src/app/page.tsx
"use client";

import { useState } from "leaf";
import { useRouter } from "farm-leaf/bindings";

export default function Page() {
  const [count, setCount] = useState(0);
  // Backed by Farm's router store, so push() is a client navigation.
  const router = useRouter();
  return (
    <section>
      <p>path: {router.pathname}</p>
      <button onClick={() => setCount((n) => n + 1)}>Clicked {count} times</button>
      <button onClick={() => router.push("/about")}>Go to about</button>
    </section>
  );
}
```

The adapter type-checked against Farm's contract types. It passed the renderer conformance suite the official renderers run. Then I ran a production build.

<span id="the-first-break-a-default-export" className="blog-heading-anchor" />

## The first break: a default export

```txt
[MISSING_EXPORT] "default" is not exported by "../farm-leaf/src/server.ts".
```

Farm generates the production server entry, and that code imported the renderer like this:

```ts
import React, * as ReactDOMServer from "farm-leaf/server";
```

That's a default import, left over from when the server module was always React. Both client entries, production and development, did the same. The development server read the module's named exports instead. Neither the contract types nor the conformance suite mentioned a default, so everything that was supposed to check the adapter passed, and the build failed anyway.

The five official renderers never hit it because each one happens to export a default. leaf didn't, because nothing asked it to.

The fix is to import the namespace everywhere, the way the development server already did:

```ts
import * as ReactDOMServer from "farm-leaf/server";
const React = ReactDOMServer;
```

I also wrote down what was implicit. `FarmRendererClientRuntime` now lists `createElement`, `Suspense`, and `configureApp`, so a renderer can type-check its modules against what Farm actually imports. The shared conformance suite checks the same exports. A regression test builds and serves an app whose renderer has no default exports, then asserts the development client imports it by name. Both parts failed before the fix.

<span id="the-second-break-react-in-the-dev-entry" className="blog-heading-anchor" />

## The second break: React in the dev entry

With a default export added as a stopgap, the production build passed and hydrated in Chrome. Then I started the development server. The leaf app doesn't install React, since it has no reason to. The page rendered on the server, and then never hydrated:

```txt
Could not resolve "react" imported by "@farm.js/core". Is it installed?
```

React is an optional peer of `@farm.js/core`, and `create-farm-app` leaves it out of non-React starters on purpose. But the development client entry, which Farm generates for every renderer, imported its router like this:

```ts
import { installChunkErrorRecovery, SPARouter } from "@farm.js/core/client";
```

`@farm.js/core/client` is the React-facing client API. Its module graph imports `react`. The router class itself never touches React; it was just sitting in a module that does.

It wasn't leaf's bug. The official Solid renderer, in an app without React installed, failed the same way. The Farm monorepo couldn't catch it because core's own `node_modules` has React, so every test resolved it. A fresh `create-farm-app` Solid project doesn't install React, so it would have hit this too.

The fix moves the router behind its own entry, `@farm.js/core/internal/spa-router`, whose graph has no React, and points the development entry at it. The test for this one doesn't trust the monorepo. It loads the generated entry, follows every static import through the built files the browser would link, and fails if any of them reaches `react`.

<span id="what-the-fixes-cost" className="blog-heading-anchor" />

## What the fixes cost

My first fix for the second break was simpler: re-export the router from the production client runtime, which the development entry already imported. It worked. It also grew the production client entry of every React app from 249,086 bytes to 249,665, for a router React apps already had. That's 579 bytes to fix a development-only problem.

So I threw it out. With the separate entry, the React production client entry is 249,086 bytes before and after. React apps pay nothing, and the development entry of every other renderer stops loading a library it doesn't use.

With both fixes in a packed `@farm.js/core`, leaf runs with no React anywhere in the app. The production build serves server-rendered HTML, the browser hydrates it in place (the button the server rendered is the button you click), the counter counts, and `router.push("/about")` navigates without a document reload. Development does the same.

That's the answer I wanted. **Farm's renderer contract is real: three modules and eleven named exports, and the core path no longer needs React installed.** Both fixes shipped in 0.1.79.

Then I ran the example the way you would: packed tarballs, installed in an app outside the repo. It found one more. `notFound()` and `redirect()` live in `@farm.js/core/navigation`, next to React's router hooks, so importing them imported React. A page that called `notFound()` answered 500 in development and stopped `farm build`. Since 0.1.81, when the renderer isn't React or Preact, Farm points that import at a copy without the hooks. Your import doesn't change. The hooks throw there, with an error that sends you to your renderer's bindings.

The same run caught the example's API route importing `createEndpoint` from `@farm.js/core`, whose root entry imports React too. It imports from `@farm.js/core/api` now. In an app without React, import from core's subpaths.

<span id="your-own-file-format" className="blog-heading-anchor" />

## Your own file format

Svelte and Vue routes aren't `.tsx` files, so I wanted to know whether a renderer can bring its own file type too. I gave leaf one:

```svelte
<!-- src/app/page.leaf -->
<script module>
// Runs once per file. Farm reads these exports.
export const hydrate = true;
</script>

<script>
// Runs on every render.
import { useState } from "leaf";
import Badge from "../components/badge.leaf";

const [count, setCount] = useState(0);
</script>

<section>
  <Badge label="compiled by farm-leaf/vite" />
  <button onClick={() => setCount((n) => n + 1)}>Clicked {count} times</button>
</section>
```

It looks like Svelte because I copied Svelte. **It doesn't have to.** Farm asks two things of a file format:

1. Its extension in the descriptor: `componentExtensions: [".leaf", ".tsx"]`. That's how Farm's route scanner knows `page.leaf` is a page. The Svelte and Vue renderers register `.svelte` and `.vue` the same way.
2. A compiler in the Vite module that turns each file into an ordinary module before Farm reads it:

```ts
// What the Vite module has to turn page.leaf into
export const hydrate = true; // optional: hydrate, metadata, dynamic, generateStaticParams
export default function Page(props) {
  // required: the component, returning your library's elements
}
```

leaf's compiler is 24 lines of string handling. It pulls out the two script blocks and wraps the markup in a function component. A template language, Markdown, or a syntax nobody has invented yet would work the same way, as long as it compiles to that shape. With it, `.leaf` files work as pages, layouts, dynamic segments, statically generated routes, and error and not-found pages, next to `.tsx` routes in the same app.

There's one exception to Farm not reading your file. Farm decides whether a page hydrates before your compiler runs, by reading the `hydrate` export from the file as written. Any declaration with a literal `true` or `false` works: `const`, `let`, or `var`, with or without a type annotation, or through an export list. A value Farm can't read without running your code, like `!0` or an import, fails the build with an error that names the file. When I first wrote this post, `!0` made the page render on the server and silently never hydrate, with the official Svelte renderer as well as leaf.

The file format also turned up three bugs in how Farm handled a renderer's extensions. A new `page.leaf` wasn't served until you restarted `farm dev`, and new `.svelte` and `.vue` pages had the same bug. A parallel-route slot like `@modal/page.leaf` was served as a page. And `farm explain` didn't find `.leaf` routes. All three fixes shipped in 0.1.79. The silent `hydrate` failure is fixed in 0.1.81.

<span id="components-for-leaf" className="blog-heading-anchor" />

## Components for leaf

Sooner or later a UI library wants a component library, and component libraries ship one adapter per framework. Nobody else is going to write one for leaf.

[ui-sdk](https://ui-sdk.dev) splits the work in a useful place. Its behaviors, from toggles and menus to dialogs and keyboard focus, live in a framework-free core. Each component there is a primitive: it holds the state and says which attributes and event handlers each part needs. ui-sdk's adapters for React, Vue, Svelte, and Solid build on that core, and one more build ships the same components as web components. That gives leaf two ways in.

### The leaf way

Write the adapter yourself, one component at a time. A leaf `Toggle` creates the primitive once, re-renders when it changes, and spreads its attributes and handlers onto a button:

```tsx
// src/ui/toggle.tsx
import { useMemo, useStore } from "leaf";
import { toggle } from "@ui-sdk/core/toggle";
import { attrs, handlers } from "@ui-sdk/core/renderer";

type ToggleProps = { id: string; defaultPressed?: boolean; children?: unknown };

export function Toggle(props: ToggleProps) {
  // One primitive per component, kept across renders.
  const t = useMemo(() => toggle({ id: props.id, defaultPressed: props.defaultPressed }));
  // Re-render when its state changes.
  useStore(useMemo(() => ({ getSnapshot: t.get, subscribe: t.subscribe })));

  const part = t.part("root");
  const on = handlers(part);
  return (
    <button {...attrs(part)} onClick={on.click} onKeyDown={on.keydown} onKeyUp={on.keyup}>
      {props.children}
    </button>
  );
}
```

The primitive has `get()` and `subscribe()`, so it plugs into the same `useStore` hook leaf's bindings use for Farm's router. The page passes an `id` because ui-sdk needs one for every primitive and leaf has no `useId`. A fixed id also means the server and the browser agree on it:

```tsx
<Toggle id="bold" defaultPressed>
  Bold
</Toggle>
```

The primitive runs while Farm renders the page on the server, so the ARIA is in the first HTML, with no plugin and nothing written by hand:

```html
<button data-slot="toggle" type="button" aria-pressed="true" data-pressed="">Bold</button>
```

I ran it in a production build and in `farm dev`, in Chrome. Hydration keeps the button the server rendered, a click sets `aria-pressed` to `"false"`, a re-render of the page leaves it there, and Space and Enter each toggle it once.

The catch is where `attrs` and `handlers` come from. `@ui-sdk/core/renderer` is the entry ui-sdk's own adapters build on, and its source says: "It isn't documented, it may change with any release, and nothing here is public API." The toggle is also the easy case. ui-sdk's adapters hand each primitive its DOM element, which the toggle uses for its `focus()` method, toggle groups, and disabled fieldsets. leaf has no refs yet, so this `Toggle` skips that, and a standalone button works without it. One component is 21 lines. A whole library is ui-sdk's adapter work done again for leaf, and yours to keep current.

### Or ditch the adapter: web components

The other way is to write no adapter at all. **A custom element is just a tag, so any renderer that can write HTML can use it.** The page writes the element and imports its module:

```tsx
// src/app/editor/page.tsx
"use client";

import "@ui-sdk/web/toggle";

export const hydrate = true;

export default function Editor() {
  return (
    <ui-toggle default-pressed>
      <button type="button" aria-pressed="true">
        Bold
      </button>
    </ui-toggle>
  );
}
```

Three things make it work:

1. The renderer writes `<ui-toggle>` into the server HTML like any other tag.
2. `export const hydrate = true` sends the page module to the browser. The import registers the tag there, and the browser upgrades the element that's already on the page.
3. The same import also runs on the server while Farm renders the page. That's safe: every ui-sdk element registers through one helper that does nothing when `customElements` doesn't exist.

The catch here is ARIA. The web component computes `aria-pressed` in the browser, after the upgrade. The HTML your server sends, which is what a screen reader or an agent reading the page gets first, only has what you wrote. That's why the example writes `aria-pressed="true"` to match `default-pressed`.

Farm can write it for you. A plugin's `render.html` hook gets the finished HTML from any renderer, in development and in production:

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { definePlugin } from "@farm.js/core/plugin";
import { leaf } from "farm-leaf";

const toggleAria = definePlugin({
  name: "demo:ui-toggle-aria",
  render: {
    html(html) {
      // A demo. A real plugin parses the HTML and asks the primitive for its attributes.
      return html.replace(
        /(<ui-toggle[^>]*\bdefault-pressed\b[^>]*>\s*<button type="button")>/g,
        '$1 aria-pressed="true">',
      );
    },
  },
});

export default defineConfig({ renderer: leaf(), plugins: [toggleAria] });
```

I ran both versions on leaf and on Preact, in a production build in Chrome. I also ran the plugin version, in development and production, with the smallest renderer in Farm's own tests, which renders to a string and never touches the DOM in the browser. On leaf and Preact:

```txt
                   pressed  aria-pressed
server HTML        -        "true"
after upgrade      true     "true"
after a click      false    "false"
after a re-render  false    "false"
```

The last line matters. When the page re-renders, leaf and Preact compare their new props with their old ones, not with the DOM, so they leave the attribute ui-sdk changed alone.

The plugin has a price. Farm holds the whole page before it can rewrite it, so with the plugin installed a streaming renderer stops streaming. leaf renders to a string anyway, so it pays nothing. And the regex is a demo. A real plugin has to ask the primitive for its attributes, and today the only way to ask is the same undocumented entry the leaf way uses. So for now I write simple ARIA by hand, and I'll build the plugin once ui-sdk makes that step public.

ui-sdk's web build also ships its agent bridge, `@ui-sdk/web/agent`. I haven't tried that on Farm yet.

### Which one

|                         | The leaf way                           | Web components         |
| ----------------------- | -------------------------------------- | ---------------------- |
| Adapter code            | A component per primitive              | None                   |
| ARIA in the server HTML | From the primitive                     | By hand, or a plugin   |
| Depends on              | `@ui-sdk/core/renderer` (undocumented) | `@ui-sdk/web` (public) |

Either way, ui-sdk is a beta (`0.1.0-beta.13`). Both ways get better the day it makes its renderer entry public: the leaf way stops depending on internals, and the plugin can ask the primitive instead of matching a regex.

<span id="what-still-needs-work" className="blog-heading-anchor" />

## What still needs work

"You can bring your own renderer" is true for the core path: routes, layouts, SSR, hydration, navigation, server functions called from server code, and production output. It is not true for everything Farm does, and I would rather say so here than in an issue later.

- **Some features are still React-oriented.** React Server Components are React-only today. The [feature table](/docs/renderers#feature-support) says which features each official renderer gets, and a custom renderer gets the same as Solid, Vue, and Svelte. Markdown pages, generated metadata images, and programmatic UI routes were on this list when the post went up. All three work with any renderer since 0.1.81.
- **Browser code can't import a server function yet.** Importing a `createServerFn` or `createServerQuery` module into a client component needs Farm's server-actions transform, which today comes only with React Server Components or islands, and both are React-only. Until that changes, browser code calls an API route through the typed API client, the way the example's "Plant barley" button does.
- **One renderer per app.** You choose a renderer; you can't mix leaf on one page and React on the next.

<span id="write-your-own" className="blog-heading-anchor" />

## Write your own

The quickest start is [`examples/custom-renderer`](https://github.com/farming-labs/farm.js/tree/main/examples/custom-renderer). Copy `farm-leaf/`, point it at your library instead of leaf, and keep its tests: they run the conformance suite and type-check each module against Farm's contract types. The suite is on npm as `@farm.js/renderer-tests`. Outside the Farm repo, replace the `workspace:*` versions in the copied `package.json` with published ones:

```bash
npm install -D @farm.js/core @farm.js/renderer-tests vitest jsdom
```

If your library can build an element tree, render it to a string, and patch or hydrate the DOM, it can be a Farm renderer. If it has its own file format, list the extensions in `componentExtensions` and compile those files in the Vite module. Write the descriptor, write the three modules, and check them against the types Farm imports:

```ts
import type {
  FarmRendererClientRuntime,
  FarmRendererViteModule,
  FarmServerRendererRuntime,
} from "@farm.js/core/renderer";
import * as client from "./client";
import * as server from "./server";
import * as vite from "./vite";

// Each line fails type-checking when a module drifts from what Farm imports.
export const serverContract: FarmServerRendererRuntime = server;
export const clientContract: FarmRendererClientRuntime = client;
export const viteContract: FarmRendererViteModule = vite;
```

To stream, export `renderToPipeableStream()` or `renderToReadableStream()` from the server module and turn on `node` or `web` under `capabilities.streaming`. leaf doesn't stream, so after this post went up I added a test renderer that is nothing but the contract. It stops halfway through a page until the test lets it continue, and the test checks that the first half reaches the browser first. It streams through both primitives, in development and in production builds. Writing it turned up one more bug: with only `renderToReadableStream()`, development buffered the whole page. That's fixed in 0.1.81 too.

The full contract, including the optional exports and how route updates reach an existing root, is in [Renderer modules](/docs/renderers#renderer-modules) and the [renderer capability contract](/docs/renderers#renderer-capability-contract). If you build one and something breaks, that's exactly the bug report I want.
