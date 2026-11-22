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

It wasn't leaf's bug. The official Solid renderer, in an app without React installed, failed the same way. The Farm monorepo couldn't catch it because core's own `node_modules` has React, so every test resolved it. I haven't checked whether a fresh `create-farm-app` Solid project gets React through some other dependency. The import was wrong either way.

The fix moves the router behind its own entry, `@farm.js/core/internal/spa-router`, whose graph has no React, and points the development entry at it. The test for this one doesn't trust the monorepo. It loads the generated entry, follows every static import through the built files the browser would link, and fails if any of them reaches `react`.

<span id="what-the-fixes-cost" className="blog-heading-anchor" />

## What the fixes cost

My first fix for the second break was simpler: re-export the router from the production client runtime, which the development entry already imported. It worked. It also grew the production client entry of every React app from 249,086 bytes to 249,665, for a router React apps already had. That's 579 bytes to fix a development-only problem.

So I threw it out. With the separate entry, the React production client entry is 249,086 bytes before and after. React apps pay nothing, and the development entry of every other renderer stops loading a library it doesn't use.

With both fixes in a packed `@farm.js/core`, leaf runs with no React anywhere in the app. The production build serves server-rendered HTML, the browser hydrates it in place (the button the server rendered is the button you click), the counter counts, and `router.push("/about")` navigates without a document reload. Development does the same.

That's the answer I wanted. **Farm's renderer contract is real: three modules and eleven named exports, and the core path no longer needs React installed.** Both fixes are on `main` and ship in the next release.

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

The file format also turned up three bugs in how Farm handled a renderer's extensions. A new `page.leaf` wasn't served until you restarted `farm dev`, and new `.svelte` and `.vue` pages had the same bug. A parallel-route slot like `@modal/page.leaf` was served as a page. And `farm explain` didn't find `.leaf` routes. All three, and the silent `hydrate` failure, are fixed on `main` and ship in the next release.

<span id="what-still-needs-work" className="blog-heading-anchor" />

## What still needs work

"You can bring your own renderer" is true for the core path: routes, layouts, SSR, hydration, navigation, server functions, and production output. It is not true for everything Farm does, and I would rather say so here than in an issue later.

- **Some features are still React-oriented.** React Server Components are React-only today. The [feature table](/docs/renderers#feature-support) says which features each official renderer gets, and a custom renderer gets the same as Solid, Vue, and Svelte. Markdown pages, generated metadata images, and programmatic UI routes were on this list when the post went up. All three now work with any renderer on `main`.
- **The conformance suite isn't on npm yet.** It's `@farm.js/renderer-tests` on `main` and ships in the next release. Until then, the type-check below is how a third-party renderer checks itself.
- **One renderer per app.** You choose a renderer; you can't mix leaf on one page and React on the next.

<span id="write-your-own" className="blog-heading-anchor" />

## Write your own

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

To stream, export `renderToPipeableStream()` or `renderToReadableStream()` from the server module and turn on `node` or `web` under `capabilities.streaming`. leaf doesn't stream, so after this post went up I added a test renderer that is nothing but the contract. It stops halfway through a page until the test lets it continue, and the test checks that the first half reaches the browser first. It streams through both primitives, in development and in production builds. Writing it turned up one more bug: with only `renderToReadableStream()`, development buffered the whole page. That's fixed on `main` too.

The full contract, including the optional exports and how route updates reach an existing root, is in [Renderer modules](/docs/renderers#renderer-modules) and the [renderer capability contract](/docs/renderers#renderer-capability-contract). If you build one and something breaks, that's exactly the bug report I want.
