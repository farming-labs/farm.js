---
title: "Islands and islx"
description: "How Farm's islands mode renders server components on islx instead of React's Flight protocol, and how it runs libraries written for React Server Components."
section: "Core"
---

# Islands and islx

**Islands mode renders server components without React's Flight protocol.** Farm uses
[islx](https://github.com/farming-labs/islx) as its wire format end to end: the HTML a page
sends, the props and values its client components receive, its server actions, and its client
navigations. You write the same server and client components as for React Server Components.

```ts filename="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: { serverComponents: { mode: "islands" }, serverActions: true },
});
```

## What replaces Flight

With `{ mode: "rsc" }`, the server renders a Flight payload (`react-server-dom-webpack`), and the
browser rebuilds the whole page from it. With `{ mode: "islands" }`, there is no Flight payload.
The page is ordinary server HTML, and islx marks the parts the browser hydrates.

|                                    | RSC (`mode: "rsc"`)                                                | Islands (`mode: "islands"`)                                                                            |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Server output                      | Flight payload, rendered to HTML                                   | HTML only, with islx markers                                                                           |
| What the browser hydrates          | the whole page, as one React root                                  | each client component, as its own root                                                                 |
| A client component's props         | inside the Flight payload                                          | `<script type="f/props">` after it                                                                     |
| Server output passed as `children` | inside the Flight payload                                          | kept as HTML in `<f-slot>`, or as a server tree when it holds client components                        |
| Large shared values                | inside the Flight payload                                          | sent once, keyed by content (`f/value`); a navigation leaves out values the browser holds (`F-Values`) |
| Server actions                     | Flight action references                                           | islx references, captured values sealed with AES-GCM                                                   |
| Client navigation                  | a Flight payload for the page                                      | the page's HTML, and only the layouts that changed (`F-Layouts`)                                       |
| Packages it needs                  | `react-server-dom-webpack`, `@vitejs/plugin-rsc` (pinned versions) | `@farm.js/islx` (a dependency of `@farm.js/core`)                                                      |

A client component's server HTML looks like this:

```html
<f-island src="/src/components/counter.tsx" export="Counter" props="_R_a_" strategy="load">
  <button>Count: 5</button>
</f-island>
<script type="f/props" for="_R_a_" ids="_R_ba_">
  {"start":5}
</script>
```

`strategy` is when the island hydrates (`load`, `idle`, `visible` or `interaction`), and `ids`
lets the browser give `useId` the ids in the HTML. The full contract is islx's
[SPEC.md](https://github.com/farming-labs/islx/blob/main/SPEC.md).

## How Farm uses islx

- **Server.** Farm renders the page once, on its normal server pipeline. Farm's compiler wraps
  every `"use client"` export in islx's island component, which writes the `<f-island>` element and
  its props. Server output passed to a client component renders once, inside it. Props take what
  RSC sends: promises, `ReadableStream`s and async iterables stream in after the page, a value
  that refers to itself arrives with the same cycle, and a plain function fails the render with an
  error that names the component and the prop.
- **Browser.** Farm's client entry hands every `<f-island>` to islx's hydration runtime, which
  imports the island's module when its strategy is due and hydrates it in place. A page whose
  islands all wait loads a 1.7 KB boot script instead of the runtime.
- **Layouts.** A layout that needs one React root (a client provider around the pages) renders as
  an islx server tree: the browser rebuilds it from the HTML, so its module stays on the server,
  and a navigation keeps the provider's state.
- **Actions.** `"use server"` functions compile to islx action references. A form posts its action
  without a page load, or without JavaScript, and the page refreshes with its islands' state kept,
  including islands in Suspense content that streams in after the page.
  An action called from a client component can return elements, promises and streams, as under
  RSC: elements render on the server, and promises and streams settle in the browser after the
  call returns. Its arguments and result can refer to themselves.
- **Navigation.** A navigation fetches the page's HTML, streamed, with only the layouts the
  browser does not keep, and hydrates the islands it brings.

## How it compares with React Server Components

**Islands mode sends far less JavaScript on pages that do not hydrate at load, and costs about the
same or less everywhere else, except for a few milliseconds on some navigations.** These are the
numbers for one app built in both modes (`benchmarks/server-components-payload`), each cell `"rsc"`
then `"islands"`.

| Measure                    | Docs page       | Shop page      | Blog post      |
| -------------------------- | --------------- | -------------- | -------------- |
| First-load JavaScript      | 69.9 to 1.7 KB  | 69.9 to 1.7 KB | 69.9 to 1.7 KB |
| HTML document              | 16.3 to 15.9 KB | 5.5 to 5.7 KB  | 17.9 to 8.9 KB |
| Data per navigation        | 12.0 to 2.5 KB  | 3.8 to 2.0 KB  | 10.8 to 8.9 KB |
| First-load main thread     | 163 to 86 ms    | 143 to 74 ms   | 216 to 99 ms   |
| Navigation until painted   | 44 to 46 ms     | 46 to 50 ms    | 71 to 69 ms    |
| Server requests per second | 434 to 458      | 682 to 769     | 48 to 349      |

Sizes are brotli at quality 5. Times are medians with Chrome at 4x CPU throttling. Requests per
second are the median of 8 rounds alternating between the modes, on one Node process. Measured
2026-11-08 on an Apple M1 with other work running, at commit `55fb3580c`.

- **First load.** 41 times less JavaScript and about half the main-thread work, because these pages'
  client components wait for a click.
- **Server.** 6% and 13% more requests per second on docs and shop pages, within the spread of a
  busy machine, and 7.3 times more on a long blog post, where Flight serializes every token.
- **Navigation data.** A fifth of the data on docs pages, half on shop pages, and slightly less on
  blog posts.

Where islands mode does not win:

- **The runtime still has to arrive.** It is about 87 KB, and it loads on the first navigation or
  interaction, so a visitor who navigates has downloaded more JavaScript in total than with
  `"rsc"`. The savings are in what a visit pays before the page can be used.
- **A client component that hydrates at load** starts the runtime at once, so that page sends more
  JavaScript than `"rsc"`, not less: about 77 to 80 KB against 69.5 KB on a small app. The
  production build keeps navigation code in a separate 8 KB chunk, loaded on the first link hover,
  focus, tap, or navigation.
- **Navigations paint 2 to 4 ms later** on docs and shop pages. Blog posts are 2 ms faster.

To measure it yourself, see the benchmark's
[README](https://github.com/farming-labs/farm.js/tree/main/benchmarks/server-components-payload).

## Libraries written for React Server Components

Islands mode runs libraries written for RSC the way their docs show it. Farm shims the RSC-only
parts:

| Pattern                                                                                                                                         | Works | How islands mode does it                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A package that ships a `react-server` build (react-tweet's server `Tweet`, react-i18next, react-hook-form, swr, `@apollo/client/react`)         | yes   | A server module's import resolves to that build, and so do the packages it imports. Names it takes from a `"use client"` module stay client components. React itself keeps one build for server and client components. |
| `import "server-only"` in server code                                                                                                           | yes   | Server builds get an empty module. A browser build that imports it fails, naming the importer.                                                                                                                         |
| `import "client-only"`                                                                                                                          | yes   | A client component gets its empty build; a server component gets its `react-server` build, which throws, as RSC rejects it.                                                                                            |
| A package client component in a server component (`next-themes`, `sonner`'s `Toaster`, Radix parts, jotai's `Provider`, `SWRConfig`)            | yes   | Farm writes a client reference module for each export (`.farm/client-references/`) and server code imports that, so the export renders as an island, as RSC renders a client reference.                                |
| A workspace package's server component in a monorepo, rendering client components of its own dependencies                                       | yes   | Its server code is app code, as the bundler compiles it. A client reference resolves a package as the importer does, so a dependency the app does not have, or has at another version, still loads.                    |
| A package provider around server content                                                                                                        | yes   | Client components inside it are its descendants and read its context.                                                                                                                                                  |
| A package provider in a layout                                                                                                                  | yes   | The layout renders as a server tree; the provider keeps its state across navigations.                                                                                                                                  |
| `useFormStatus` in a client component inside a server `<form>`                                                                                  | yes   | Farm points the import at islx's `useFormStatus`, which reports the server form's submit.                                                                                                                              |
| `useActionState` with a server action, in a form posted before JavaScript loads                                                                 | yes   | The page renders with the action's result, and its island hydrates with that state, as under React Server Components.                                                                                                  |
| `useId` in client components                                                                                                                    | yes   | Ids match the server HTML and are unique across islands.                                                                                                                                                               |
| `cache` from `react` in server code, or `React.cache`                                                                                           | yes   | Farm points them at a request-scoped `cache`, as RSC memoizes it, in app server code and in the `react-server` builds it reaches.                                                                                      |
| `cacheSignal()` from `react` in server code                                                                                                     | yes   | It returns the request's `AbortSignal`, which aborts when the response ends, as RSC's does after a render.                                                                                                             |
| A namespace import passed around as a value (`const { Close } = Dialog`)                                                                        | yes   | Its components become client references; its other exports (`createDialogScope`) come from the package.                                                                                                                |
| A package that mixes client components and server code in one entry (TanStack Query's `HydrationBoundary` beside `QueryClient` and `dehydrate`) | yes   | Only exports that come from a `"use client"` module become client references; the rest stay ordinary server imports, as in RSC.                                                                                        |
| Lowercase client components (`motion.div` from `motion/react-client`)                                                                           | yes   | They render as islands like any other client reference.                                                                                                                                                                |

A server module that imports a package reaching `client-only` without `"use client"` (React Aria
Components) fails with the import chain, in development and in the build, as RSC does. Import such
packages from a `"use client"` module.

Packages that Node cannot load as a bundler does, because their files import stylesheets
(react-tweet's CSS modules) or their ES module build is only a `module` field beside a CommonJS
`main` (react-wrap-balancer), are bundled into the server graph (`ssr.noExternal`) in every mode,
so development renders them as the production build does. In development, Farm also pre-bundles
the `module`-field packages that have no dependencies of their own with Vite's SSR dependency
optimizer, so a barrel package such as lucide-react loads as one module instead of one per icon.
The bundle is cached in `node_modules/.vite/deps_ssr` and rebuilt when the lockfile or config
changes.

`tests/e2e-server-components/compat.spec.ts` runs these against both engines, including TanStack
Query, Motion, react-tweet, react-hook-form, react-wrap-balancer, lucide-react, react-markdown,
recharts, React Aria Components and cmdk.

### Known differences

- **A module both server and client components import** is one module in islands mode, where RSC
  has a copy in each graph. Farm treats a module that any `"use client"` module reaches as client
  code, so its imports keep the packages' default builds, and a server component that uses it gets
  those too. Modules only server code imports get the `react-server` builds.
- **Package code that calls React's `cache`** outside a `react-server` build keeps React's own,
  which calls the function every time outside RSC.
- **`cacheSignal()` outside a request** (at module scope, in a build step) returns `null`. In RSC
  its signal aborts when the render finishes; in islands mode, when the response ends.
- **A namespace passed around as a value** carries the package's non-component exports
  (`createDialogScope`) as the real functions. RSC gives client references that throw when called.
- **Package client components always hydrate,** including ones that only render markup (icons),
  as RSC sends them as client components too. Each one is an island.
