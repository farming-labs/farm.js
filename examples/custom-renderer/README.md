# Custom renderer example

**A Farm app rendered by leaf, a UI library Farm has no code for, through an adapter you can copy.**

`leaf/` is the library. It knows nothing about Farm: elements, function components, hooks, a DOM
patcher that hydrates server markup, and an HTML renderer that streams. `farm-leaf/` is the adapter that
plugs it into Farm:

| File                        | What Farm gets from it                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `farm-leaf/src/index.js`    | The descriptor `renderer: leaf()` selects, from `defineRenderer()`                                             |
| `farm-leaf/src/server.js`   | `createElement`, `renderToString`, `renderToReadableStream`, `withIsland`, and the rest of the server contract |
| `farm-leaf/src/client.js`   | `createRoot` and `hydrateRoot` for the browser entry                                                           |
| `farm-leaf/src/vite.js`     | The Vite plugin: compiles `.leaf` files, and JSX in `.tsx` files, against leaf's runtime                       |
| `farm-leaf/src/compile.js`  | The `.leaf` compiler: markup in, a module whose default export is the component out                            |
| `farm-leaf/src/bindings.js` | `useRouter`, `useTheme`, `useAction`, `useServerQuery`, and `Link`, over Farm's client stores                  |

Both packages are plain JavaScript with `.d.ts` files, the shape a published renderer has, so
neither needs a build step. `farm-leaf/test/` runs the conformance suites from
`@farm.js/renderer-tests` and type-checks the modules against Farm's contract types.

The app's routes are `.leaf` files: HTML with `{{ values }}`, `@click` handlers, and `<leaf:if>`
and `<leaf:for>` tags, plus a `<script>` that runs on every render and a `<script module>` for
exports such as `hydrate`:

```vue
<script module>
  export const hydrate = true;
</script>

<script>
  import { useState } from "leaf";
  const [count, setCount] = useState(0);
</script>

<button @click="setCount((n) => n + 1)">Clicked {{ count }} times</button>
```

A mistake fails the build with the file, the line, and the fix. `src/app/recovers/page.tsx` and
`src/app/islands/page.tsx` are JSX, which works next to them.

The app covers a hydrating layout that keeps its state across client navigation, a counter page,
a page that ships no JavaScript, a dynamic route with metadata, conditions and lists in `.leaf`
markup, an API route, a button that calls a validated `createServerFn` imported
straight into the page (`experimental.serverActions`) through `useAction`, a `useServerQuery` that
reads again when that function invalidates its key, a page that streams past an async component
inside `<Suspense>`, a server page whose client components hydrate as islands, each when its
`client:*` attribute says (`experimental.serverComponents: { mode: "islands" }`), the same with `.leaf` client
components in a `.leaf` page (`src/app/islands/leaf`), not-found and error pages, and a page whose
hydration throws, which Farm renders in the browser instead. The descriptor's `compile()` lets Farm
read a `.leaf` file as the module it compiles to, so it finds a component's `"use client"`.

`src/app/guides/` uses flat files instead of folders. farm-leaf's `routes()` maps them: `_layout.leaf`
is the folder's layout, `index.leaf` is its page, `[crop].leaf` is a dynamic page, other `_` files
are components, and `watering.client.leaf` hydrates. Its `hydration.resolve()` reads leaf's own
`// @hydrate` pragma, which `harvest.leaf` uses.

```bash
pnpm --filter farm-custom-renderer-example dev
pnpm --filter farm-leaf test
pnpm test:e2e:custom-renderer
```

## Use it outside this repo

This copy runs against Farm's source in CI. To start your own renderer, clone
[farming-labs/leaf](https://github.com/farming-labs/leaf) instead. It's the same adapter and app
on published packages, plus ui-sdk components. [Build your own renderer, build your own full-stack
framework](https://farmjs.dev/blog/bring-your-own-renderer) walks through it step by step.

## What it does not do

- leaf streams in order: a `<Suspense>` boundary sends what came before it, then waits for the
  async components inside. It never shows `fallback`, and async components render on the server
  only, so a page that has one doesn't hydrate.
- leaf matches children by position and has no keys, so reordering a list re-renders its items.
- TypeScript doesn't check `.leaf` files. Their scripts may use TypeScript syntax, which the
  compiler strips.

See [Renderer modules](https://farmjs.dev/docs/renderers#renderer-modules) for the full contract.
