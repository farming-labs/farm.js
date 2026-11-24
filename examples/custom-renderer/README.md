# Custom renderer example

**A Farm app rendered by leaf, a UI library Farm has no code for, through an adapter you can copy.**

`leaf/` is the library. It knows nothing about Farm: elements, function components, hooks, a DOM
patcher that hydrates server markup, and an HTML renderer that streams. `farm-leaf/` is the adapter that
plugs it into Farm:

| File                        | What Farm gets from it                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `farm-leaf/src/index.js`    | The descriptor `renderer: leaf()` selects, from `defineRenderer()`                               |
| `farm-leaf/src/server.js`   | `createElement`, `renderToString`, `renderToReadableStream`, and the rest of the server contract |
| `farm-leaf/src/client.js`   | `createRoot` and `hydrateRoot` for the browser entry                                             |
| `farm-leaf/src/vite.js`     | The Vite plugin: JSX against leaf's runtime, and the `.leaf` compiler                            |
| `farm-leaf/src/bindings.js` | `useRouter`, `useTheme`, `useAction`, `useServerQuery`, and `Link`, over Farm's client stores    |

Both packages are plain JavaScript with `.d.ts` files, the shape a published renderer has, so
neither needs a build step. `farm-leaf/test/` runs the conformance suites from
`@farm.js/renderer-tests` and type-checks the modules against Farm's contract types.

The app covers a hydrating layout that keeps its state across client navigation, a counter page,
a page that ships no JavaScript, a dynamic route with metadata, a page and component in leaf's own
`.leaf` file format, an API route, a button that calls a validated `createServerFn` imported
straight into the page (`experimental.serverActions`) through `useAction`, a `useServerQuery` that
reads again when that function invalidates its key, a page that streams past an async component
inside `<Suspense>`, not-found and error pages, and a page whose hydration throws, which Farm renders
in the browser instead.

```bash
pnpm --filter farm-custom-renderer-example dev
pnpm --filter farm-leaf test
pnpm test:e2e:custom-renderer
```

## Use it outside this repo

This copy runs against Farm's source in CI. To start your own renderer, clone
[farming-labs/leaf](https://github.com/farming-labs/leaf) instead. It's the same adapter and app
on published packages, plus ui-sdk components. [Bring your own
renderer](https://farmjs.dev/blog/bring-your-own-renderer) walks through it step by step.

## What it does not do

- leaf streams in order: a `<Suspense>` boundary sends what came before it, then waits for the
  async components inside. It never shows `fallback`, and async components render on the server
  only, so a page that has one doesn't hydrate.
- leaf matches children by position and has no keys, so reordering a list re-renders its items.

See [Renderer modules](https://farmjs.dev/docs/renderers#renderer-modules) for the full contract.
