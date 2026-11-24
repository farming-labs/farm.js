---
title: "Custom Renderers"
description: "Render Farm pages with a UI library of your own: the renderer descriptor, its server, client, and Vite modules, streaming, client hooks over Farm's stores, a Link, file formats, route files, hydration, and the conformance suite."
section: "Core"
---

# Custom Renderers

Farm renders pages through a renderer: a descriptor and three modules. React, Preact, Solid, Vue,
and Svelte are written against the same contract, and so is any UI library you want to bring. This
page covers the whole contract in the order you'd build one.

[`examples/custom-renderer`](https://github.com/farming-labs/farm.js/tree/main/examples/custom-renderer)
is a complete renderer to copy from. It renders an app with leaf, a small UI library Farm has no
code for, through an adapter written in plain JavaScript. Most snippets on this page come from it.

## What the renderer owns

Farm keeps the parts of an app that don't depend on the UI library:

- Route discovery, layouts, loading, error, and not-found files, and route metadata
- API routes, server functions and queries, middleware, cache, and storage
- Client navigation, prefetching, the query cache, theme, and i18n state
- Production builds and every deployment target

The renderer does the rest:

- **Compiling components**, through a Vite plugin.
- **Building and rendering element trees on the server**, to a string or a stream.
- **Hydrating that markup in the browser**, and rendering the next route on a client navigation.
- **Hooks or bindings** that let components read Farm's client state.

A custom renderer gets the same Farm features as Solid, Vue, and Svelte. The
[feature table](/docs/renderers#feature-support) lists them. React Server Components and islands
are React-only.

## How Farm uses a renderer

1. `farm.config.ts` sets `renderer` to a descriptor. The descriptor names modules by package
   specifier; it holds no functions, so the config stays serializable.
2. `farm dev` and `farm build` import the Vite module and add its plugin to the browser graph and
   the server graph.
3. On a request, Farm imports the server module, builds the route tree with its `createElement()`
   (layouts around the page, a `Suspense` boundary where a loading file applies), and renders it:
   through a stream when the renderer declares one, otherwise with `renderToString()`.
4. In the browser, Farm builds the same tree with the client module's `createElement()` and hands it
   to `hydrateRoot()`, for pages and layouts that hydrate.
5. On a client navigation, Farm loads the next route's modules and builds its tree. When a hydrating
   layout stays on screen, Farm hands the tree to the existing root's `render()`, or `renderRoute()`
   when the root has one. Otherwise it unmounts the old root and renders into a new one.
6. Components read the router, server queries, actions, theme, and i18n through stores from
   `@farm.js/core/renderer-client`. The renderer turns those stores into hooks.

## Package layout

A renderer is a package with one entry per module:

```text
farm-leaf/
  package.json
  src/index.js      the descriptor           farm-leaf
  src/server.js     the server module        farm-leaf/server
  src/client.js     the client module        farm-leaf/client
  src/vite.js       the Vite module          farm-leaf/vite
  src/bindings.js   hooks and a Link         farm-leaf/bindings
```

```json
{
  "name": "farm-leaf",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": { "types": "./src/index.d.ts", "default": "./src/index.js" },
    "./server": { "types": "./src/server.d.ts", "default": "./src/server.js" },
    "./client": { "types": "./src/client.d.ts", "default": "./src/client.js" },
    "./vite": { "types": "./src/vite.d.ts", "default": "./src/vite.js" },
    "./bindings": { "types": "./src/bindings.d.ts", "default": "./src/bindings.js" }
  },
  "peerDependencies": {
    "@farm.js/core": "*",
    "leaf": "*",
    "vite": "*"
  }
}
```

- Make `@farm.js/core` and the UI library peer dependencies, so the adapter uses the app's copies.
  The router and the query cache are module state, so a second copy of core would hold a second
  router and cache.
- Farm resolves each module from the app's `package.json`, so the specifiers must resolve from the
  app, not only from inside the renderer package.
- Import from `@farm.js/core/renderer` and `@farm.js/core/renderer-client`, never from the
  `@farm.js/core` root. The root entry imports React, which an app on another renderer doesn't
  install.

## The descriptor

The descriptor is what an app passes to `renderer`. Export a function that returns one, so each app
gets its own copy:

```js
// src/index.js
import { defineRenderer } from "@farm.js/core/renderer";

export function leaf() {
  return defineRenderer({
    name: "leaf",
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    componentExtensions: [".leaf"],
    capabilities: {
      streaming: { node: false, web: false },
      reconcilesRerenders: true,
      functionComponents: true,
      hydrationFallback: true,
    },
  });
}
```

```ts
// farm.config.ts in the app
import { defineConfig } from "@farm.js/core";
import { leaf } from "farm-leaf";

export default defineConfig({
  renderer: leaf(),
});
```

`defineRenderer()` returns its argument and types it as `FarmRenderer`. Farm checks the descriptor
when it resolves the config, and reports every bad field at once.

The module specifiers are what the app's server and browser code import. `routes()` and
`hydration` are different: they're build-time hooks that run in Node while Farm scans the app, and
never reach the browser.

- **`name`** (required): the renderer's id in errors and generated manifests.
- **`vite`**, **`server`**, **`client`** (required): the three module specifiers. Each must be a
  non-empty string, or the config fails with ``Farm renderer `server` must be a non-empty string.``
- **`jsxImportSource`**: the package your JSX imports its runtime from. In development Farm passes it
  to Vite's dependency scan. Without it, the scan compiles JSX as React unless the app's tsconfig
  names a source, and an app with no React installed fails the scan and reloads on its first visit.
- **`componentExtensions`**: extensions of your own file format, such as `[".leaf"]`. Route files
  with them become pages and layouts, next to `.ts`, `.tsx`, `.js`, and `.jsx`. See
  [Your own file format](#your-own-file-format).
- **`routes(context)`**: which files are routes and the URL each one serves, for a library with a
  convention other than Farm's folders. See [Route files](#route-files).
- **`hydration`**: which pages and layouts hydrate when they say nothing, and a reader for your
  format's own syntax for it. See [Hydration](#hydration).
- **`dedupe`**: packages that must resolve to one copy in the app, passed to Vite's
  `resolve.dedupe`. List a runtime whose hooks keep module-level state.
- **`optimizeDeps`**: packages Vite pre-bundles in development before the first page load. Farm adds
  the `client` module itself when it names a package.
- **`buildConcurrency`**: `"parallel"` (the default) or `"serial"`. A production build compiles the
  browser and server graphs at the same time. Set `"serial"` when your compiler plugin keeps
  process-global mutable caches; the official Vue renderer does, because `@vitejs/plugin-vue` shares
  them between plugin instances.
- **`capabilities`**: what the renderer supports: `streaming`, `reconcilesRerenders`,
  `functionComponents`, and `hydrationFallback`. Each defaults to off. Streaming is covered under
  [Streaming](#streaming); the next two under [Components](#components) and
  [Route updates](#route-updates); `hydrationFallback` under [The client module](#the-client-module).
- **`options`**: serializable options your Vite module receives as `rendererOptions`. Use them for
  compiler modes, so the descriptor function can take options from the app.
- **`appSetup`**: a module path, relative to the project root, that configures each app instance
  your renderer creates (Vue's `app.use()`, for example). Farm imports it in the server and browser
  entries and passes its default export to `configureApp()`, which both runtime modules must then
  export.

## The server module

Farm imports the server module by name in development and in the production server bundle. It
needs no default export. Six exports are required:

```js
// src/server.js
export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToString } from "leaf/server";

export const name = "leaf";
export const capabilities = { streaming: { node: false, web: false } };
```

- **`name`**: a non-empty string, usually the descriptor's `name`.
- **`createElement(type, props, ...children)`**: Farm composes every route tree with it. `type` is a
  tag name, `Fragment`, `Suspense`, or a component. Layouts get the page as `children`, and the
  route's params as `params`.
- **`isValidElement(value)`**: whether a value is one of your elements, as opposed to a string, a
  promise, or a plain object.
- **`Fragment`** and **`Suspense`**: the values `createElement()` accepts as types. Farm wraps a page
  that has a loading file in `Suspense`, with the loading component as `fallback`.
- **`renderToString(element, options)`**: renders a tree to HTML. It may return a promise. Farm
  uses it when the renderer doesn't stream, and for documents it sends whole: the not-found and
  error pages with their layouts.

`farm dev` and `farm build` check these exports when they load the module, and fail with one error
that names every missing export.

Farm's own components pass React-style props: `className`, `htmlFor`, event handlers such as
`onClick`, and numeric `style` values in pixels. Map them to what your library expects. Escape text
and attribute values in the HTML you write: Farm passes route params and query strings through as
props.

`options.nonce` is the CSP nonce of the response being rendered. Put it on every inline `<script>`
your renderer writes, such as hydration data or streaming reveals: under `security.csp.nonce`, the
browser blocks a script without it.

### Optional server exports

- **`renderToReadableStream()`** and **`renderToPipeableStream()`**: streaming. See
  [Streaming](#streaming).
- **`renderToStringWithHead(element, options)`**: for a library whose components write head markup
  during render, like Svelte's `<svelte:head>`. Return `{ html, head }`: `html` exactly as
  `renderToString()` renders it, and `head` for the document's `<head>`. A `<title>` in `head`
  replaces Farm's fallback title, and a route's metadata title still wins over it.
- **`generateHydrationScript()`**: markup your browser runtime needs before it hydrates, such as
  Solid's hydration bootstrap. Farm puts it in the document head. It must return the same string on
  every call.
- **`markFunctionComponent(component)`**: tags a plain function component Farm creates, so a
  renderer whose own components are functions can tell the two apart. See [Components](#components).
- **`findStaticShellBoundary(chunk)`**: where a streamed chunk stops being static. Partial
  prerendering caches the HTML before that point as the page's shell. Return the index to cut at, or
  `-1` when the chunk is all static. Without this export, the renderer gets no static shell: Farm
  doesn't guess where your dynamic markers start.
- **`configureApp(setup)`**: receives the descriptor's `appSetup` module. Required when the
  descriptor sets `appSetup`.
- **`capabilities`**: a copy of the descriptor's capabilities. Farm checks that what the module
  declares covers what the descriptor declares.

`wrapClientGraph()`, `isolateServerPageGraph()`, and `renderServerTreePage()` serve React Server
Components; leave them out. Farm no longer reads an `ErrorBoundary` export: a page that throws under
an `error.*` file renders that file as the route's error page.

## The client module

Farm's browser entries import the client module by name. Four exports are required:

```js
// src/client.js
import { createRoot as createLeafRoot } from "leaf/dom";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { hydrateRoot } from "leaf/dom";

// A leaf root renders next to what's already in its container, so empty it first.
export function createRoot(container) {
  container.replaceChildren();
  return createLeafRoot(container);
}
```

- **`createElement()`** and **`Suspense`**: build the route tree in the browser. They must build the
  same tree the server module built from the same calls, or hydration fails to match.
- **`createRoot(container)`**: a root whose first render replaces what's in `container`, as React's
  does. Farm uses it for a route with no server markup to adopt, after a navigation that replaces
  the root, and when `hydrateRoot()` throws. The last two leave markup in the container, so a root
  that renders next to it shows the page twice.
- **`hydrateRoot(container, element, routeState)`**: a root that adopts the server's markup in
  `container`: the elements already there stay, and gain their event listeners and state. The third
  argument is the route state described under [Route updates](#route-updates).
- **`configureApp(setup)`**: required when the descriptor sets `appSetup`.

If `hydrateRoot()` throws in development, Farm logs
`[Farm.js] Hydration error; rendering the page on the client instead:` with the error and renders
the route with `createRoot()`. A production build does the same only when the descriptor sets
`capabilities.hydrationFallback: true`; otherwise the page keeps the server's markup without event
listeners. With the fallback the page works, but the server's DOM, focus, and typed input are
replaced. Set it once your `createRoot()` replaces what's in its container, as farm-leaf's does
above.

Both functions return a root:

```ts
interface FarmRendererClientRoot {
  render(element: unknown): void;
  renderRoute?(state: FarmRendererRouteState): void;
  unmount(): void;
}
```

`render()` renders a new tree into the root. Farm calls it with the next route's tree on a client
navigation. `unmount()` removes what the root rendered and stops its updates.

## The Vite module

The Vite module exports one function. Farm calls it for each graph it builds and adds what it
returns to Vite's plugins:

```js
// src/vite.js
import { transformWithOxc } from "vite";
import { compileLeaf, componentName } from "./compile.js";

const JSX = { runtime: "automatic", importSource: "leaf" };

export function createFarmRendererPlugin() {
  return {
    name: "farm-leaf",
    config() {
      // Compile JSX against leaf's runtime.
      return { oxc: { jsx: JSX } };
    },
    async transform(code, id) {
      const file = id.split("?")[0];
      if (!file.endsWith(".leaf")) return null;
      const result = await transformWithOxc(compileLeaf(code, componentName(file)), `${file}.tsx`, {
        lang: "tsx",
        jsx: JSX,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}
```

`createFarmRendererPlugin(options)` may return a plugin, an array of plugins, or a promise of
either. `options` holds:

- **`ssr`**: whether the plugin serves a server graph. A production build creates one plugin for the
  browser graph (`ssr: false`) and one for the server graph (`ssr: true`). Development runs one Vite
  server for both and passes `ssr: true`, so pick server or browser output per module from the
  `ssr` option Vite passes to `transform()`.
- **`rendererOptions`**: the descriptor's `options`.
- **`buildLifetime`**: an `AbortSignal` shared by every graph of one production build, aborted once
  they all close. Tie a cache shared between the graphs to it, and clear it on `abort`. Development
  doesn't pass it.

### Hot updates in development

The renderer contract has no hot-update hook: hot updates belong to your Vite plugin. The official
renderers get them from their library's plugin: `@vitejs/plugin-vue`, `vite-plugin-solid`,
`@sveltejs/vite-plugin-svelte`, and `@preact/preset-vite`. Each accepts an edited component module
and swaps it in place, so the page and its layouts keep their state.

Without that, Vite reloads the page when you save a component, and all component state resets,
including the layout's. The leaf example works this way. Production builds aren't affected.

To add hot updates, have the plugin's `transform()` append an `import.meta.hot.accept()` handler to
component modules in the browser graph (`ssr` false in the transform options) that swaps the new
component into the instances your runtime has mounted. Vite's
[HMR API](https://vite.dev/guide/api-hmr) describes the handler.

## Streaming

Without streaming, Farm renders a page with `renderToString()` and sends it once the whole page is
ready. With it, the response starts with the first chunk your renderer emits.

Declare each primitive in the descriptor, and export the matching function from the server module:

- **`web: true`**: export `renderToReadableStream(element, options)`. It returns a
  `ReadableStream` of `Uint8Array` or string chunks, or a promise of one.
- **`node: true`**: export `renderToPipeableStream(element, callbacks)`. It returns
  `{ pipe(writable), abort?(reason) }`. Call `callbacks.onShellReady()` once Farm may start piping,
  `onShellError(error)` when the render fails before then, and `onError(error)` for a later error.

```js
capabilities: {
  streaming: { node: false, web: true },
  reconcilesRerenders: true,
  functionComponents: true,
},
```

Farm checks both sides when the development server starts and again in the production server: a
descriptor that declares a primitive the server module doesn't export fails with an error that names
it. A renderer that exports only `renderToReadableStream()` streams in development as well as in
production builds.

The descriptor's top-level `node` and `web` apply to every runtime. When a package's exports change
between runtimes, as React DOM's do between Node and edge builds, override them per runtime:

```js
streaming: {
  node: true,
  web: false,
  runtimes: { edge: { node: false, web: true } },
},
```

Development resolves as `node`. A production build resolves the runtime from its deployment preset,
and an unknown preset uses the top-level values.

### Errors in a stream

The response status goes out with the first chunk, so a render error is handled by when it happens:

- **Before any output**: fail the stream. Error the `ReadableStream`, or call `onShellError()`.
  Farm answers with the error's status.
- **After output has started**: the status is sent. Report the error through `options.onError()` or
  `callbacks.onError()`, then end the stream. Farm logs it, and the response ends with what was
  sent. Erroring a Web stream after output resets the connection in a production build.

Here is a Web stream over a renderer that yields HTML chunks as an async iterator:

```js
// src/server.js
const encoder = new TextEncoder();

export function renderToReadableStream(element, options) {
  // renderChunks() is your renderer: an async iterator of HTML strings.
  const chunks = renderChunks(element);
  let started = false;
  return new ReadableStream({
    async pull(controller) {
      let result;
      try {
        result = await chunks.next();
      } catch (error) {
        // Before any output, the error decides the status. After it, the status is already
        // sent, so report the error and end the document.
        if (!started) return controller.error(error);
        options?.onError?.(error);
        return controller.close();
      }
      if (result.done) return controller.close();
      started = true;
      controller.enqueue(encoder.encode(result.value));
    },
    cancel() {
      return chunks.return?.();
    },
  });
}
```

What a `Suspense` boundary does in a stream is up to the renderer. A renderer can flush the HTML
before a boundary and then wait for the content inside it, or send the fallback first
and the content later with a script that swaps it in, as React does.

## Client state and hooks

Farm keeps its client state in stores any renderer can read. Each implements `FarmClientStore`:

```ts
interface FarmClientStore<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(listener: () => void): () => void;
}
```

`@farm.js/core/renderer-client` creates them:

- **`createRendererRouter(options)`**: `pathname`, `searchParams`, `params`, `pageState`, and
  `navigation`, with `push`, `replace`, `refresh`, `prefetch`, `back`, `forward`, `pushState`, and
  `replaceState`.
- **`createRendererAction(serverFn, options)`**: a server function call's `pending`, `status`,
  `data`, and `error`, with `submit(input)` and `reset()`.
- **`createRendererQuery(query, input, options)`**: a server query's `data`, `error`, `status`,
  `pending`, `fetching`, and `stale`, from Farm's shared browser cache, with `refetch()` and
  `dispose()`.
- **`createRendererTheme()`**: the theme preference and resolved theme, with `setTheme()` and
  `toggleTheme()`.
- **`createRendererI18n()`**: the locale state, a translator `t`, and `setLocale()`.
- **`createStore(state, actions)`**: the app's own state. See
  [Shared client state](/docs/renderers#shared-client-state).

The official bindings are one function that turns a store into the library's own state, plus thin
wrappers. For a library with React-style hooks:

```js
// src/bindings.js
import { useEffect, useMemo, useState } from "leaf";
import {
  createRendererAction,
  createRendererQuery,
  createRendererRouter,
} from "@farm.js/core/renderer-client";

export function useFarmStore(store) {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  useEffect(() => {
    // Catch a change between the first render and the subscription.
    setSnapshot(() => store.getSnapshot());
    return store.subscribe(() => setSnapshot(() => store.getSnapshot()));
  }, [store]);
  return snapshot;
}

export function useRouter(options) {
  const [router] = useState(() => createRendererRouter(options));
  return { ...useFarmStore(router), push: router.push, replace: router.replace };
}

export function useAction(target, options) {
  const [action] = useState(() => createRendererAction(target, options));
  return { ...useFarmStore(action), submit: action.submit, reset: action.reset };
}

export function useServerQuery(query, input, options) {
  // The browser posts the input, so it's serializable and its JSON identifies a new read.
  const observer = useMemo(
    () => createRendererQuery(query, input, options),
    [query, JSON.stringify(input ?? null)],
  );
  useEffect(() => () => observer.dispose(), [observer]);
  return { ...useFarmStore(observer), refetch: observer.refetch };
}
```

- Create a store once per component, not on every render, and unsubscribe when the component
  unmounts.
- `getSnapshot()` returns the same value until the state changes, so an identity check is enough to
  skip an update.
- Call `dispose()` on a query store when its component unmounts.
- On the server, the router store reads the request's URL, so a component renders the same path,
  search params, and route params there as in the browser. This ships in the release after 0.1.81;
  in 0.1.81 the server snapshot is `/` with no params.
- On the server, a query store returns an idle snapshot and starts no request. The browser loads the
  query after hydration.
- A query that is still on the page reads again when an action invalidates its key with
  `invalidate()` from `@farm.js/core/cache`.

A component then reads them like any other state:

```tsx
"use client";

import { useAction, useServerQuery } from "farm-leaf/bindings";
import { plantCrop, plantedCount } from "../server/plant";

export default function PlantButton() {
  const plant = useAction(plantCrop);
  const total = useServerQuery(plantedCount, undefined);

  return (
    <section>
      <button type="button" disabled={plant.pending} onClick={() => plant.submit({ name: "rye" })}>
        Plant rye
      </button>
      {plant.error && <p role="alert">{plant.error.message}</p>}
      <p>Planted so far: {total.data?.planted ?? "…"}</p>
    </section>
  );
}
```

`plant.submit()` returns a promise that rejects when the call fails, and the error also lands in
`plant.error`.

### Server functions in the browser

A component imports server functions and queries from their server module, as above. With any
renderer but React, turn that on in the app's config:

```ts
export default defineConfig({
  renderer: leaf(),
  experimental: { serverActions: true },
});
```

The browser then gets a reference for each server function instead of its code, and a call posts
its input to the current page, whose server runs it. Without the flag, the import stops the build
with `CLIENT_SERVER_FUNCTION`. See
[Native client bindings](/docs/renderers#native-client-bindings).

### Action forms

To give an action a form, call `submitRendererActionForm(action, event)` from the form's `submit`
listener. It cancels the browser's own submission, sends the form's fields and the button that
submitted it as `FormData`, and resets the form when the call succeeds. A failure leaves the fields
as they were and the error in the action's `error`. A listener that already cancelled the submission
keeps it cancelled.

`submitRendererActionForm` is newer than the other stores: it ships in the release after 0.1.81.

## Links

Farm's router handles a click on any anchor with a `data-farm-link` attribute, and prefetches as its
attributes say. A `Link` only renders those attributes, which `resolveLinkAttributes()` computes from
the same options React's `Link` takes:

```js
// src/bindings.js
import { createElement } from "leaf";
import { FARM_LINK_OPTION_KEYS, resolveLinkAttributes } from "@farm.js/core/renderer-client";

export function Link(props) {
  const options = {};
  const anchor = {};
  for (const [name, value] of Object.entries(props)) {
    if (FARM_LINK_OPTION_KEYS.includes(name)) options[name] = value;
    else anchor[name] = value;
  }
  return createElement("a", { ...anchor, ...resolveLinkAttributes(options) });
}
```

`resolveLinkAttributes()` applies route params, `query`, `hash`, the locale, the trailing-slash
preference, and the base path to `href`, and adds the prefetch, `replace`, `scroll`, and
`viewTransition` attributes. Type the props with `FarmLinkOptions` from the same entry to check
`href` against the app's routes.

## Your own file format

A renderer with its own component format, like `.vue` or `.svelte`, does two things:

1. Lists the extension in `componentExtensions`, so Farm discovers `page.leaf` and `layout.leaf` as
   routes.
2. Compiles the format to a JavaScript module in its Vite plugin, with the component as the default
   export, as the Vite module above does.

Farm decides whether a page or layout hydrates before your compiler runs: it reads `"use client"` or
a `hydrate` export from the file as written. So in any format, `hydrate` must be the literal `true`
or `false`:

```html
<script module>
  export const hydrate = true;
</script>
```

To give the format a syntax of its own instead, read it in `hydration.resolve()`. See
[Hydration](#hydration).

## Route files

Farm's folders decide routes by default: `about/page.leaf` is `/about`, and `layout.leaf` lays out
its folder. When your library has another convention, give the descriptor a `routes()` method. It
returns a resolver, and Farm calls it once per file:

```js
// src/index.js, in defineRenderer({ ... })
routes({ defaults }) {
  const url = (segments) => `/${segments.join("/")}`;
  return {
    resolve(file) {
      // Farm's folders keep working next to the flat files.
      const folderRoute = defaults.resolve(file);
      if (folderRoute || file.segments[0] !== "guides" || file.extension !== ".leaf") {
        return folderRoute;
      }
      if (file.name === "_layout") return { kind: "layout", pattern: url(file.segments) };
      if (file.name.startsWith("_")) return null;
      const name = file.name.replace(/\.client$/, "");
      return {
        kind: "page",
        pattern: url(name === "index" ? file.segments : [...file.segments, name]),
        ...(name === file.name ? {} : { hydrate: true }),
      };
    },
  };
},
```

```text
src/app/guides/
  _layout.leaf           layout of /guides
  index.leaf             /guides
  [crop].leaf            /guides/[crop]
  watering.client.leaf   /guides/watering, hydrates
  _tip.leaf              not a route: a component index.leaf imports
```

`routes(context)` may be async. Farm calls it when `farm dev` starts and again when a file under
its directory is added or removed, in every `farm build`, and in `farm generate`. It gets:

- **`root`**: the project root, or a layer's root when the app extends one. Farm scans each.
- **`defaults`**: Farm's folder rules as a resolver over the same directory. Return
  `defaults.resolve(file)` for a file to keep them.

It returns:

- **`dir`**: the directory to scan, relative to `root`. Defaults to `src/app` (`<srcDir>/app`), and
  must stay inside the project.
- **`resolve(file)`**: called for each file under `dir` with a component extension (`.ts`, `.tsx`,
  `.js`, `.jsx`, and yours), `.md`, or `.mdx`, in sorted order. Return a route, or `null` when the
  file isn't one.

The file Farm passes, for `src/app/guides/watering.client.leaf`:

| Field       | Value                                                     |
| ----------- | --------------------------------------------------------- |
| `path`      | `"guides/watering.client.leaf"`, with `/` on every system |
| `segments`  | `["guides"]`                                              |
| `name`      | `"watering.client"`                                       |
| `extension` | `".leaf"`                                                 |

The route you return:

| Field      | Value                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| `kind`     | `"page"`, `"layout"`, `"loading"`, `"error"`, or `"not-found"`                  |
| `pattern`  | The URL in Farm's folder syntax: `"/"`, `"/blog/[slug]"`, `"/docs/[...path]"`   |
| `hydrate`  | Optional. Whether the file hydrates; see [Hydration](#hydration)                |
| `strategy` | Optional. When it hydrates: `"load"`, `"idle"`, `"visible"`, or `"interaction"` |

A rule Farm can't serve fails the scan with the file's path and the fix:

- `pattern` must start with `/`, and can't have an empty, `.`, `..`, or `@name` segment, or a `\`,
  `?`, or `#`.
- `not-found` only takes `pattern: "/"`. Farm renders one not-found page.
- Two files can't map to the same kind and pattern. The error names both.
- A `resolve()` that throws fails the scan, naming the file it was resolving.

Some files stay with Farm. It finds `route.ts` handlers, `middleware`, `instrumentation`, metadata
files (`sitemap`, `robots`, `manifest`, `llms`, `opengraph-image`, `twitter-image`), and named slots
(`@name` folders) in `src/app` as before, and never passes them to `resolve()`.

Generated route types follow the same rules, so `farm generate` lists `/guides/watering` and a
`Link` to it type-checks.

## Hydration

Farm decides whether each page and layout hydrates before your compiler runs. The descriptor's
`hydration` sets what applies when a file says nothing, and can read your format's own syntax:

```js
// src/index.js, in defineRenderer({ ... })
hydration: {
  pages: false, // the default: a page that says nothing renders on the server only
  layouts: false,
  strategy: "visible", // when a hydrating page or layout loads, unless it says
  // `// @hydrate`, `// @hydrate idle`, or `// @hydrate false` in a .leaf file's module script.
  resolve(source) {
    const pragma = /^\s*\/\/ @hydrate(?: (load|idle|visible|interaction|false))?\s*$/m.exec(source);
    if (!pragma) return undefined;
    if (pragma[1] === "false") return { hydrate: false };
    return pragma[1] ? { hydrate: true, strategy: pragma[1] } : { hydrate: true };
  },
},
```

For each page and layout, the most specific setting wins:

1. **The file.** `"use client"`, `export const hydrate`, `export const island`, or what
   `hydration.resolve()` reads. `"use client"` always hydrates.
2. **Its route rule.** The `hydrate` and `strategy` that `routes()` returned for it.
3. **The renderer's defaults.** `hydration.pages` or `hydration.layouts`, and `hydration.strategy`.
4. Otherwise the file renders on the server only.

`resolve(source, file)` gets the file as written, and only for files with your
`componentExtensions`. `.tsx` and the other built-in extensions keep Farm's reading. Return
`{ hydrate?, strategy? }`, or nothing to leave the file to Farm. When a file both exports `hydrate`
or `island` and uses your syntax, and the two disagree, the scan fails and names the file: keep one.

A route's page and the hydrating layouts above it hydrate as one root, so they share one strategy.
When they declare different ones, or a hydrating layout declares none, the route hydrates on
`"load"`.

## Components

### Plain function components

Some components Farm renders aren't written for your library, such as integration provider
components. They're plain functions: they take props and return an element tree. Set
`capabilities.functionComponents: true` once your renderer calls such a function and renders what
it returns, on the server and in the browser. Farm renders
integration provider components only when the renderer declares it, and otherwise fails with an
error that names the renderer.

If your library's own components are functions too, as compiled Vue and Svelte components are,
export `markFunctionComponent(component)` from the server module. Farm calls it on those plain
functions; call the marked ones, and instantiate every other function as one of your own
components.

### Async components

Farm awaits an async page itself with every renderer but React, in development and in production
builds, and renders the elements it returns. That's how `page.md` pages render with every renderer.

Inside the tree, async components are the renderer's choice. A renderer that doesn't support them
must reject them with an error that says so, instead of rendering a promise, an empty string, or
`[object Object]`. A streaming renderer can wait for them in the stream and still reject them in
`renderToString()`.

## Route updates

`capabilities.reconcilesRerenders` states what `root.render(nextTree)` does to what's mounted:

- **`true`**: the root compares the new tree with the live DOM, like React, Preact, and Vue. A client
  navigation that keeps the same layout keeps its DOM nodes, focus, and component state.
- **`false`** (the default): the root rebuilds the tree. Farm doesn't rely on reconciliation it
  won't get.

A fine-grained renderer with no virtual DOM can keep layouts mounted another way: give the root a
`renderRoute(state)` method. Farm calls it instead of `render()` on a client navigation, and passes
the same state as the third argument of `hydrateRoot()`:

```ts
interface FarmRendererRouteState {
  element: unknown; // the whole tree, for a root that only implements render()
  layouts: readonly { pattern: string; Component: unknown }[]; // outermost first
  page: unknown; // what goes in the innermost layout's slot
  params: Readonly<Record<string, string>>;
  wrap?: (element: unknown) => unknown; // Farm's outer wrappers, such as integration providers
}
```

The official Solid renderer keeps the layouts whose `pattern` matches mounted and updates the page
slot and params through signals. See [Re-render behavior](/docs/renderers#re-render-behavior).

## Test a renderer

### Type-check the modules

Assign each module to its contract type. A module that drifts from what Farm imports then fails
type-checking:

```ts
// test/contract.ts
import type {
  FarmRendererClientRuntime,
  FarmRendererViteModule,
  FarmServerRendererRuntime,
} from "@farm.js/core/renderer";
import * as client from "../src/client.js";
import * as server from "../src/server.js";
import * as vite from "../src/vite.js";

export const serverContract: FarmServerRendererRuntime = server;
export const clientContract: FarmRendererClientRuntime = client;
export const viteContract: FarmRendererViteModule = vite;
```

### Run the conformance suite

`@farm.js/renderer-tests` is the suite Farm runs against its official renderers. It calls your
modules the way Farm does, in Node and jsdom, and fails where your renderer behaves differently:

```bash
pnpm add -D @farm.js/renderer-tests vitest jsdom
```

```ts
// test/server.test.js
// @vitest-environment node
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { leaf } from "../src/index.js";
import * as server from "../src/server.js";

defineRendererDescriptorConformance({
  name: "leaf",
  createDescriptor: leaf,
  expected: { vite: "farm-leaf/vite", server: "farm-leaf/server", client: "farm-leaf/client" },
});

defineRendererServerConformance(server);
```

```ts
// test/client.test.js
// @vitest-environment jsdom
import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as client from "../src/client.js";
import * as server from "../src/server.js";

defineRendererClientConformance({
  name: "leaf",
  client,
  server,
  // The value the descriptor declares in capabilities.reconcilesRerenders.
  reconcilesRerenders: true,
});
```

- **`defineRendererDescriptorConformance`**: the descriptor names all three modules and returns
  fresh arrays on each call.
- **`defineRendererServerConformance`**: element primitives, escaping, React-style props, function
  components, async components, error boundaries, and shell errors in each stream you export.
- **`defineRendererClientConformance`**: the exports Farm imports, mounting and updating a root,
  events, and hydrating in place.
- **`defineRendererServerQueryConformance`**: a server render never shares the browser query cache
  between visitors.
- **`defineRendererNativeTreeConformance`**: the mobile native tier reads your server markup like any
  other renderer's.

The suite doesn't start an app. Run one on your renderer in `farm dev` and in a production build
too: the example's Playwright tests run the same checks against both.

## Limits

- **One renderer per app.** `renderer` is app-wide, so every page and layout uses the same one.
- **Route rules cover pages, layouts, and their boundaries.** API routes, middleware, metadata
  files, and named slots stay in `src/app` folders.
- **React Server Components and islands are React-only.**
- **Some UI integrations are React-oriented.** The docs adapter and most integration UI providers
  render React components today.
- **No static shell without `findStaticShellBoundary()`.** Partial prerendering needs it to know
  where the dynamic part of a streamed page begins.
- **React hooks from core throw.** `useRouter()`, `usePathname()`, and `useSearchParams()` from
  `@farm.js/core/navigation` are React hooks. Read the route through your bindings instead.
  `notFound()`, `redirect()`, and `permanentRedirect()` from the same entry work with every
  renderer.
