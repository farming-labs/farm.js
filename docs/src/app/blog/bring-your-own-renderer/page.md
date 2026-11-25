---
title: "Build your own renderer, build your own full-stack framework"
description: "How to plug any UI library into Farm, one piece at a time: a descriptor, three small modules, a few hooks, islands, and two ways to use a component library. The working example is farming-labs/leaf."
---

# Build your own renderer, build your own full-stack framework

KinfeMichael Tariku · Nov 2026

Farm ships five renderers: React, Preact, Solid, Vue, and Svelte. This post is about the sixth, the one you write.

To find out what that takes, I wrote leaf, a small UI library Farm had never heard of, and plugged it in. It now runs a whole Farm app: server rendering, hydration, islands, client navigation, server functions, its own file format, and components from a component library. Every snippet below comes from that app, and you can run it:

```bash
git clone https://github.com/farming-labs/leaf
cd leaf
pnpm install
pnpm dev
```

**A renderer is one descriptor and three small modules. Farm does the rest.**

<BlogFigure kind="renderer-seams" caption="A renderer is three modules. Farm compiles routes with the Vite module, renders them to HTML with the server module, and hydrates that HTML with the client module." />

<span id="what-farm-does-and-what-you-do" className="blog-heading-anchor" />

## What Farm does, and what you do

Farm owns routing, layouts, data loading, server functions, caching, navigation, and deployment. A renderer never sees a URL.

For each request, Farm builds the route as one element tree. It calls your library's `createElement()` for the root layout, each nested layout, and the page. Then it asks your library for two things:

- On the server, turn that tree into HTML.
- In the browser, adopt that HTML, and render the next tree when the user navigates.

That's the whole job. The leaf repo has three parts:

- **`packages/leaf`** is the UI library: elements, hooks, a DOM patcher, and an HTML renderer that can stream. It's about 1,000 lines of TypeScript, and your library replaces it.
- **`packages/farm-leaf`** is the adapter between leaf and Farm. This post builds it, one step at a time.
- **`app`** is a Farm app that uses it.

You probably have the library already. The adapter is what you write.

<span id="step-1-the-descriptor" className="blog-heading-anchor" />

## Step 1: the descriptor

The descriptor tells Farm where your three modules are and what your library can do. It's the only thing an app imports:

```ts
// packages/farm-leaf/src/index.ts
import { defineRenderer, type FarmRenderer } from "@farm.js/core/renderer";

export function leaf(): FarmRenderer {
  return defineRenderer({
    name: "leaf",
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    componentExtensions: [".leaf"],
    capabilities: {
      streaming: { node: false, web: true },
      reconcilesRerenders: true,
      functionComponents: true,
      hydrationFallback: true,
    },
  });
}
```

- **`vite`, `server`, `client`** are package specifiers, not functions. That keeps `farm.config.ts` serializable, and each module resolves from the app's own `node_modules`. Give each one an entry in your package's `exports`.
- **`jsxImportSource`** is where `.tsx` files get their JSX runtime. Your library needs a `jsx-runtime` entry that exports `jsx`, `jsxs`, and `Fragment`, as React's does.
- **`componentExtensions`** adds file types that can be routes. It's optional, and [step 7](#step-7-optional-your-own-file-format) covers it.
- **`capabilities`** says what your library can do:
  - `reconcilesRerenders: true` means a re-render patches the DOM that's already there, so a layout keeps its state across navigation.
  - `functionComponents: true` means a plain function that returns elements is a component. Farm checks it before rendering integration providers.
  - `hydrationFallback: true` means that when hydration throws in production, Farm may render the page again with your `createRoot()`, as it always does in development. [Step 3](#step-3-the-client-module) shows why that needs a `createRoot()` that replaces what is already on the page.
  - `streaming` is covered in [step 8](#step-8-optional-streaming).

The app picks the renderer in its config:

```ts
// app/farm.config.ts
import { defineConfig } from "@farm.js/core";
import { leaf } from "farm-leaf";

export default defineConfig({ renderer: leaf() });
```

<span id="step-2-the-server-module" className="blog-heading-anchor" />

## Step 2: the server module

The server module renders routes to HTML. If your library already has these exports, it's a re-export:

```ts
// packages/farm-leaf/src/server.ts
import {
  renderToReadableStream as renderLeafToReadableStream,
  type RenderToReadableStreamOptions,
} from "leaf/server";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { renderToString } from "leaf/server";

/** leaf's stream, typed the way Farm calls it: with the route tree its createElement built. */
export const renderToReadableStream = renderLeafToReadableStream as (
  element: unknown,
  options?: RenderToReadableStreamOptions,
) => ReadableStream<Uint8Array>;

export const name = "leaf";
export const capabilities = { streaming: { node: false, web: true } } as const;
```

`renderToReadableStream` and `capabilities` are optional, and [step 8](#step-8-optional-streaming) covers them. The cast is only for TypeScript: Farm hands the stream the route tree as `unknown`, so the re-export takes `unknown` too. It's the same function. Farm reads six named exports:

- **`name`** names the renderer in errors.
- **`createElement(type, props, ...children)`** builds the route tree: layouts wrapped around the page.
- **`Fragment`** wraps what an async page returns when it isn't a single element.
- **`isValidElement(value)`** tells an element apart from other values, such as an async page's result.
- **`Suspense`** wraps a page that has a `loading` file. leaf's renders its children, and its stream sends what came before it early.
- **`renderToString(element)`** returns the HTML, or a promise of it.

Two things you don't have to build. Farm awaits an `async` page itself and hands your library what it returned, so your library doesn't need async components to have async pages. And no default export is needed: Farm imports every module by name. If one of the six is missing, `farm dev` and `farm build` stop at startup with an error that names each missing export.

<span id="step-3-the-client-module" className="blog-heading-anchor" />

## Step 3: the client module

The client module runs in the browser. It's mostly a re-export:

```ts
// packages/farm-leaf/src/client.ts
import { createRoot as createLeafRoot } from "leaf/dom";

export { Fragment, Suspense, createElement, isValidElement } from "leaf";
export { hydrateRoot } from "leaf/dom";

// A leaf root renders next to what's already in its container, so empty it first.
export function createRoot(container: Element) {
  container.replaceChildren();
  return createLeafRoot(container);
}
```

Farm needs four of these: `createElement` and `Suspense` build the same tree in the browser, and the other two make roots:

- **`hydrateRoot(container, element)`** adopts the HTML the server sent. The button the server rendered should be the button the user clicks, not a copy.
- **`createRoot(container)`** makes a root that replaces whatever is in the container. Farm uses it when there's no server HTML to adopt, and when hydration throws (in production, only with `hydrationFallback: true`). A failed hydration leaves the server's HTML in place, so the wrapper empties the container: without it, the page shows up twice.

Both return a root with two methods:

```ts
const root = hydrateRoot(container, tree);
root.render(nextTree); // every client navigation
root.unmount();
```

On a client navigation, Farm builds the next route's tree and calls `render()` on the root it already has. Because leaf patches in place, the layout's DOM and state survive. A fine-grained library like Solid or Svelte can't diff a new tree, so it can also give its root a `renderRoute()` method that keeps the layouts mounted and swaps only the page. leaf doesn't need one.

<span id="step-4-the-vite-module" className="blog-heading-anchor" />

## Step 4: the Vite module

The Vite module exports one function, `createFarmRendererPlugin()`. Farm adds the plugin it returns to the app's server and browser builds, in development and in production. At minimum, it points JSX at your runtime:

```ts
// packages/farm-leaf/src/vite.ts (the JSX part)
import type { Plugin } from "vite";

export function createFarmRendererPlugin(): Plugin {
  return {
    name: "farm-leaf",
    config() {
      return { oxc: { jsx: { runtime: "automatic", importSource: "leaf" } } };
    },
  };
}
```

It can also return an array of plugins, or a promise of one. Farm passes options such as `ssr`, for a library that compiles differently for each side.

That's all eleven required exports: six on the server, four in the client, and one in Vite. Before you run anything, have TypeScript check your modules against the types Farm imports:

```ts
// packages/farm-leaf/test/contract.ts
import type {
  FarmRendererClientRuntime,
  FarmRendererViteModule,
  FarmServerRendererRuntime,
} from "@farm.js/core/renderer";
import * as client from "../src/client.js";
import * as server from "../src/server.js";
import * as vite from "../src/vite.js";

// Each line fails type-checking when a module drifts from what Farm imports.
export const serverContract: FarmServerRendererRuntime = server;
export const clientContract: FarmRendererClientRuntime = client;
export const viteContract: FarmRendererViteModule = vite;
```

Now `pnpm dev` serves leaf pages. A page or layout that starts with `"use client"` hydrates in the browser. One without it stays plain server HTML.

<span id="step-5-hooks-over-farms-stores" className="blog-heading-anchor" />

## Step 5: hooks over Farm's stores

Pages want the router: the current path, and `push()` for navigation. Farm keeps that client state in renderer-neutral stores from `@farm.js/core/renderer-client`. Each one has `getSnapshot()` and `subscribe()`, the same shape as React's `useSyncExternalStore`.

Write one hook that turns a store into your library's state. The rest are thin wrappers:

```ts
// packages/farm-leaf/src/bindings.ts (abridged)
import { useEffect, useState } from "leaf";
import { createRendererRouter, type FarmClientStore } from "@farm.js/core/renderer-client";

export function useFarmStore<T>(store: FarmClientStore<T>): T {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  useEffect(() => {
    setSnapshot(() => store.getSnapshot()); // catch a change before we subscribed
    return store.subscribe(() => setSnapshot(() => store.getSnapshot()));
  }, [store]);
  return snapshot;
}

export function useRouter() {
  const [router] = useState(() => createRendererRouter());
  return { ...useFarmStore(router), push: router.push, replace: router.replace };
}
```

A page uses it like any hook. leaf's pages are `.leaf` files, which [step 7](#step-7-optional-your-own-file-format) covers:

```vue
<!-- app/src/app/page.leaf (abridged) -->
<script module>
export const hydrate = true;
</script>

<script>
import { useRouter } from "farm-leaf/bindings";
import { useState } from "leaf";

const [count, setCount] = useState(0);
const router = useRouter();
</script>

<section>
  <p>path: {{ router.pathname }}</p>
  <button @click="setCount((n) => n + 1)">Clicked {{ count }} times</button>
  <button @click="router.push('/about')">Go to about</button>
</section>
```

`createRendererTheme()` and `createRendererI18n()` wrap the same way. The action and query stores get their own hooks in [step 6](#step-6-server-functions). For links, `resolveLinkAttributes()` returns the attributes Farm's router looks for. A `Link` component only has to render an `<a>` with them, and Farm handles the click. leaf's bindings, all five hooks and `Link`, are 77 lines.

One rule for apps without React: **import from core's subpaths**, such as `@farm.js/core/api`, `@farm.js/core/server-fn`, and `@farm.js/core/renderer-client`. The root `@farm.js/core` entry imports React. Type-only imports from it are fine, and so is `defineConfig` in `farm.config.ts`. `notFound()` and `redirect()` from `@farm.js/core/navigation` work with any renderer. That module's React hooks don't, so use your own bindings for those.

<span id="step-6-server-functions" className="blog-heading-anchor" />

## Step 6: server functions

A server function runs on the server, and browser code calls it like a function. With a custom renderer, turn it on with one flag:

```ts
// app/farm.config.ts
export default defineConfig({
  renderer: leaf(),
  experimental: { serverActions: true },
});
```

Define server functions in their own module. A query reads data, and a function that changes it invalidates the query's key:

```ts
// app/src/server/plant.ts (abridged)
import { invalidate } from "@farm.js/core/cache";
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

let planted = 0;

export const plantedCount = createServerQuery({
  key: () => ["planted"],
  async handler() {
    return { planted };
  },
});

export const plantCrop = createServerFn({
  input: z.object({ name: z.enum(["wheat", "barley", "rye"]) }),
  async handler({ input }) {
    planted += 1;
    invalidate(["planted"]);
    return { message: `Planted ${input.name} on the server.` };
  },
});
```

Browser code can import `plantCrop` and `await` it like any function. To render its pending state and result, wrap Farm's action and query stores the way step 5 wrapped the router:

```ts
// packages/farm-leaf/src/bindings.ts (continued, return types abridged)
import { createRendererAction, createRendererQuery } from "@farm.js/core/renderer-client";
import type { ServerFn } from "@farm.js/core/server-fn";
import type { ServerQuery } from "@farm.js/core/server-query";

export function useAction<TInput, TResult>(target: ServerFn<TInput, TResult>) {
  const [action] = useState(() => createRendererAction(target));
  return { ...useFarmStore(action), submit: action.submit, reset: action.reset };
}

export function useServerQuery<TInput, TData>(query: ServerQuery<TInput, TData>, input: TInput) {
  // The input is posted to the server, so its JSON identifies a new read.
  const observer = useMemo(
    () => createRendererQuery(query, input),
    [query, JSON.stringify(input ?? null)],
  );
  useEffect(() => () => observer.dispose(), [observer]);
  return { ...useFarmStore(observer), refetch: observer.refetch };
}
```

Then a page uses both:

```vue
<!-- app/src/app/page.leaf (abridged) -->
<script>
const plant = useAction(plantCrop);
const total = useServerQuery(plantedCount, undefined);
// A failed call lands in plant.error, which the page renders.
const plantBarley = () => plant.submit({ name: "barley" }).catch(() => {});
</script>

<section>
  <button disabled="{{ plant.pending }}" @click="plantBarley">Plant barley</button>
  <p>{{ plant.data?.message ?? "Nothing planted yet." }}</p>
  <leaf:if test="plant.error">
    <p role="alert">{{ plant.error.message }}</p>
  </leaf:if>
  <p>Planted so far: {{ total.data?.planted ?? "…" }}</p>
</section>
```

The browser gets references, not handlers. Each call posts its input to the current page, and the server validates it, runs the handler, and sends back the result. The query reads after hydration, and Farm keeps its result in the same browser cache React's `useServerQuery` uses. When `plantCrop` invalidates `["planted"]`, the query reads again, and "Planted so far" goes up without a reload. Your renderer does none of this. Without the flag, a browser import of a server function stops the build with `CLIENT_SERVER_FUNCTION`.

<span id="step-7-optional-your-own-file-format" className="blog-heading-anchor" />

## Step 7 (optional): your own file format

Svelte and Vue routes aren't `.tsx` files, and yours don't have to be either. leaf has `.leaf` files:

```vue
<!-- app/src/app/notes/page.leaf -->
<script module>
// Module scope: Farm reads these exports.
export const hydrate = true;
export const metadata = { title: "Notes in a .leaf file" };
</script>

<script>
// Runs on every render.
import { useState } from "leaf";
import Badge from "../../components/badge.leaf";

const [notes, setNotes] = useState(0);
const crops = ["wheat", "barley", "rye"];
</script>

<section>
  <Badge label="compiled by farm-leaf/vite" />
  <button @click="setNotes((n) => n + 1)">Notes: {{ notes }}</button>
  <leaf:if test="notes >= 3">
    <p>That's a lot of notes.</p>
  </leaf:if>
  <leaf:else>
    <p>Click to add a note.</p>
  </leaf:else>
  <ul>
    <leaf:for each="crop" in="crops">
      <li>{{ crop }}</li>
    </leaf:for>
  </ul>
</section>
```

The markup is HTML. `{{ }}` holds a value, `@click` an event handler, and `<leaf:if>` and `<leaf:for>` hold conditions and lists. The format is leaf's to choose. Farm asks two things of it:

1. **List the extension** in `componentExtensions`. That's how Farm's route scanner knows `page.leaf` is a page.
2. **Compile each file** in your Vite plugin into an ordinary module, whose default export is the component:

```ts
// packages/farm-leaf/src/vite.ts (the .leaf part)
async transform(code, id) {
  const file = id.split("?")[0]!;
  if (!file.endsWith(".leaf")) return null;
  // compileLeaf() turns the markup into JSX: imports, module exports, and
  // `export default function Page(props) { ...; return (<>jsx</>); }`
  const result = await transformWithOxc(compileLeaf(code, componentName(file), file), `${file}.tsx`, {
    lang: "tsx",
    jsx: JSX,
    sourcemap: true,
  });
  return { code: result.code, map: result.map };
},
```

leaf's compiler is 429 lines. It parses the markup, writes the JSX, and turns a mistake, such as JSX's `onClick={...}`, into a build error with the file, the line, and the `.leaf` spelling. A template language, Markdown, or something nobody has invented yet works the same way, as long as it compiles to that shape. `.leaf` files then work as pages, layouts, dynamic segments, and error and not-found pages, next to `.tsx` routes in the same app.

There's one exception: Farm reads `hydrate` from the file as written, before your compiler runs. So `hydrate` must be the literal `true` or `false`. A value Farm can't read without running your code, like `!0`, stops the build with an error that names the file.

<span id="step-8-optional-streaming" className="blog-heading-anchor" />

## Step 8 (optional): streaming

Without streaming, Farm renders the whole page with `renderToString()` and sends it. To stream, export one of these from the server module, and turn on its flag in the descriptor's `capabilities.streaming` (and in the server module's `capabilities`, if it exports one):

- **`renderToReadableStream(element, options)`** returns a Web `ReadableStream` of HTML. Turn on `web`.
- **`renderToPipeableStream(element, callbacks)`** returns an object with `pipe(destination)`, for Node streams. Turn on `node`.

leaf uses the first. Its HTML renderer is a generator: it yields strings, a marker where a `<Suspense>` starts, and the promise an async component returns. `renderChunks()` joins the strings into one chunk per marker and waits on each promise in order. The stream sends each chunk as it's ready:

```ts
// packages/leaf/src/server.ts (the stream)
export function renderToReadableStream(
  element: Children,
  options?: RenderToReadableStreamOptions,
): ReadableStream<Uint8Array> {
  const chunks = renderChunks(renderChildren(element));
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let result: IteratorResult<string, void>;
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
    async cancel() {
      await chunks.return();
    },
  });
}
```

The `catch` is the rule that matters. If rendering fails before any output, error the stream, so Farm can answer with the error's status: leaf's `/broken` page still gets its `error.tsx` and a 500. After output has started, call `options.onError(error)` and close the stream. Erroring a stream that has already sent bytes resets the connection.

Now a page can stream past slow data:

```tsx
// app/src/app/streaming/page.tsx (abridged)
import { Suspense } from "leaf";
import { loadCropsSlowly } from "../../server/slow-crops";

async function SlowCropList() {
  const crops = await loadCropsSlowly(); // takes 400 ms
  return (
    <ul>
      {crops.map((crop) => (
        <li>{crop}</li>
      ))}
    </ul>
  );
}

export default function StreamingPage() {
  return (
    <section>
      <p>This arrives first. The list below waits 400 ms for its data.</p>
      <Suspense>
        <SlowCropList />
      </Suspense>
    </section>
  );
}
```

The layout and the paragraph reach the browser at once, and the list follows when its data does. Three limits are leaf's, not Farm's:

- It streams in order. React streams out of order, showing `fallback` and swapping the content in with a script. leaf never shows `fallback`.
- Its browser renderer can't run an async component, so a page that has one stays server HTML.
- Its `renderToString()` rejects an async component with an error that says to stream it. Farm's conformance suite expects that from a renderer that can't wait.

<span id="step-9-optional-islands" className="blog-heading-anchor" />

## Step 9 (optional): islands

A page that hydrates hydrates as one tree: all of its components ship to the browser, including the ones that never change. With islands, a server page stays HTML, and only its client components hydrate, each on its own and when it's needed. Since 0.1.84, that works with any renderer that opts in.

The app turns islands on:

```ts
// app/farm.config.ts
export default defineConfig({
  renderer: leaf(),
  experimental: {
    serverComponents: { mode: "islands" },
  },
});
```

The descriptor adds `islands: true` to `capabilities`, and the server module exports one more function. Farm wraps each export of a `"use client"` module with `withIsland()` in the server graph. `resolveFarmIsland()` from `@farm.js/core/renderer` works out what to write for the props the component got: the scripts that carry them, Farm's island element, and the script that starts it. The renderer writes those around the component:

```ts
// packages/farm-leaf/src/server.ts (abridged)
export function withIsland(component: unknown, reference: FarmIslandReference): unknown {
  if (typeof component !== "function") return component;
  const Inner = component as Component<Props>;
  function Island(props: Props) {
    const island = useContext(ClientGraph) ? undefined : resolveFarmIsland(props, reference);
    if (!island) return createElement(Inner, withoutClientAttributes(props));
    return createElement(
      Fragment,
      null,
      ...island.values.map(script),
      createElement(
        island.element.tag,
        island.element.attributes,
        createElement(Inner, island.props),
      ),
      script(island.script),
    );
  }
  return Island;
}
```

There's no browser half to write. Farm's island runtime hydrates each island with the client module's `createElement()` and `hydrateRoot()` from step 3, and unmounts it when a navigation removes it.

`ClientGraph` is a leaf context. Under a `"use client"` layout, the route hydrates as one root, and a client component inside it is part of that root, not an island. Farm marks that tree with `wrapClientGraph()`, and a server page under it with `isolateServerPageGraph()`, where client components are islands again. leaf's two exports set the context.

A page uses client components as usual, and says when each one starts:

```tsx
// app/src/app/islands/page.tsx (abridged)
<p id="islands-static">This text ships no JavaScript.</p>
<Counter name="load" label="Starts at once" since={since} crops={crops} client:load />
<Counter name="idle" label="Starts when the browser is idle" since={since} crops={crops} />
```

`Counter`'s module exports `island = "idle"`, and `client:load` overrides it where it's used. The other strategies are `visible` and `interaction`. `since` is a `Date` and `crops` a `Map`, and the browser gets a `Date` and a `Map`: props go through the same codec as Farm's React islands, and a value several islands share is sent once.

<span id="step-10-test-it" className="blog-heading-anchor" />

## Step 10: test it

The official renderers share a conformance suite, and it's on npm:

```bash
npm install -D @farm.js/core @farm.js/renderer-tests vitest jsdom
```

One call per module:

```ts
// packages/farm-leaf/test/server.test.ts
import {
  defineRendererDescriptorConformance,
  defineRendererServerConformance,
} from "@farm.js/renderer-tests";
import { leaf } from "../src/index.js";
import * as server from "../src/server.js";

defineRendererDescriptorConformance({
  name: "leaf",
  createDescriptor: leaf,
  expected: {
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    capabilities: { reconcilesRerenders: true, functionComponents: true },
  },
});

defineRendererServerConformance(server);
```

```ts
// packages/farm-leaf/test/client.test.ts
// @vitest-environment jsdom
import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as client from "../src/client.js";
import * as server from "../src/server.js";

defineRendererClientConformance({ name: "leaf", client, server, reconcilesRerenders: true });
```

The suite checks the exports, renders and hydrates real trees, and checks that a re-render keeps the DOM when you say it does.

Unit tests don't prove the build works, so the repo also runs one Playwright spec against `farm dev` and against a production build. It covers hydration keeping the server's DOM, islands, client navigation, a server function call, `<leaf:if>` and `<leaf:for>`, and 404 and 500 pages:

```bash
pnpm test          # conformance and unit tests
pnpm test:e2e      # the production build in a browser
pnpm test:e2e:dev  # the same spec against farm dev
```

<span id="components-the-ui-sdk-way" className="blog-heading-anchor" />

## Components: the ui-sdk way

Sooner or later, your library wants a component library. Most ship one adapter per framework, and nobody is going to write one for yours.

[ui-sdk](https://ui-sdk.dev) splits the work in a useful place. Its behaviors, from toggles and menus to dialogs and focus handling, live in a framework-free core. Each component there is a **primitive**: it holds the state and says which attributes and event handlers each part needs. That gives your library two ways in.

### Way 1: build on the primitive

Write a small component per primitive. leaf's `Toggle` creates the primitive once, re-renders when it changes, and spreads its attributes and handlers onto a button:

```tsx
// app/src/ui/toggle.tsx
import { attrs, handlers } from "@ui-sdk/core/renderer";
import { toggle } from "@ui-sdk/core/toggle";
import { useFarmStore } from "farm-leaf/bindings";
import { type Children, useMemo } from "leaf";

type ToggleProps = { id: string; defaultPressed?: boolean; children?: Children };

export function Toggle(props: ToggleProps) {
  // One primitive per component, kept across renders.
  const primitive = useMemo(
    () => toggle({ id: props.id, defaultPressed: props.defaultPressed }),
    [],
  );
  // Re-render when its state changes, with the same hook the router uses.
  useFarmStore(
    useMemo(() => ({ getSnapshot: primitive.get, subscribe: primitive.subscribe }), [primitive]),
  );

  const root = primitive.part("root");
  const on = handlers(root);
  return (
    <button {...attrs(root)} onClick={on.click} onKeyDown={on.keydown} onKeyUp={on.keyup}>
      {props.children}
    </button>
  );
}
```

The primitive has `get()` and `subscribe()`, so it's a store like Farm's, and the hook from [step 5](#step-5-hooks-over-farms-stores) works unchanged. The `id` is fixed, so the server and the browser agree on it:

```tsx
<Toggle id="bold" defaultPressed>
  Bold
</Toggle>
```

The primitive runs during server rendering too, so the ARIA is in the first HTML:

```html
<button data-slot="toggle" type="button" aria-pressed="true" data-pressed="">Bold</button>
```

Click, Space, and Enter each toggle it, in `farm dev` and in a production build.

The catch is where `attrs` and `handlers` come from. `@ui-sdk/core/renderer` is the entry ui-sdk's own adapters use, and it isn't documented or public API yet. It can change in any release. leaf also has no refs, so this `Toggle` skips what ui-sdk does with the DOM element, like its `focus()` method. A standalone button doesn't need it.

### Way 2: use the web components

Or write no adapter at all. **A custom element is just a tag, so any renderer that can write HTML can use it.**

```tsx
// app/src/app/ui/web/page.tsx
"use client";

import "@ui-sdk/web/toggle";

export default function WebComponentPage() {
  return (
    <ui-toggle default-pressed>
      <button type="button" aria-pressed="true">
        Bold
      </button>
    </ui-toggle>
  );
}
```

leaf writes `<ui-toggle>` into the server HTML like any other tag. `"use client"` sends the page to the browser, where the import registers the element and the browser upgrades the one already on the page. The import also runs on the server, which is safe because ui-sdk skips registration when `customElements` doesn't exist.

The catch here is ARIA. The web component sets `aria-pressed` in the browser, after the upgrade. The HTML the server sends, which is what an agent fetching the page reads, only has what you wrote. That's why the page writes `aria-pressed="true"` to match `default-pressed`.

### Which one

|                         | On the primitive                       | Web components         |
| ----------------------- | -------------------------------------- | ---------------------- |
| Adapter code            | A component per primitive              | None                   |
| ARIA in the server HTML | From the primitive                     | Written by hand        |
| Depends on              | `@ui-sdk/core/renderer` (undocumented) | `@ui-sdk/web` (public) |

ui-sdk is a beta (`0.1.0-beta.13`). The first way stops depending on internals the day it makes its renderer entry public.

<span id="what-a-custom-renderer-doesnt-get" className="blog-heading-anchor" />

## What a custom renderer doesn't get

Routes, layouts, SSR, hydration, navigation, server functions, and production output work with any renderer. Some things don't:

- **React Server Components are React-only.** Islands were too, until 0.1.84: now a renderer that opts in gets them, as [step 9](#step-9-optional-islands) shows. Of the built-in renderers, only React uses them so far. The [feature table](/docs/renderers#feature-support) lists what else each renderer gets.
- **One renderer per app.** You can't render one page with leaf and the next with React.
- **leaf's own gaps are leaf's.** It streams only in order, and it has no keys and no refs. Those are missing from the library, not from Farm's contract.

<span id="what-building-leaf-fixed-in-farm" className="blog-heading-anchor" />

## What building leaf fixed in Farm

leaf was a test of the contract, and the contract had gaps. Each one is fixed and has a regression test:

- Farm imported renderer modules with a default import that only the official renderers happened to have. It imports them by name since 0.1.79.
- The development client loaded React through its router, so a Solid app without React installed never hydrated in `farm dev`. The router has its own entry since 0.1.79, and the React production client entry stayed 249,086 bytes.
- A new `page.leaf` wasn't served until `farm dev` restarted, and `.svelte` and `.vue` pages had the same bug. Fixed in 0.1.79.
- `notFound()` and `redirect()` pulled in React, and browser code couldn't import server functions outside React. Both work with any renderer since 0.1.81.
- A `hydrate` value Farm couldn't read silently skipped hydration. Since 0.1.81 it stops the build.

The full contract, with every optional export, is in [Renderer modules](/docs/renderers#renderer-modules). Start from [farming-labs/leaf](https://github.com/farming-labs/leaf): keep `farm-leaf`'s tests, and point the three modules at your library. If something breaks, that's exactly the bug report I want.
