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
  its props. Server output passed to a client component renders once, inside it.
- **Browser.** Farm's client entry hands every `<f-island>` to islx's hydration runtime, which
  imports the island's module when its strategy is due and hydrates it in place. A page whose
  islands all wait loads a 1.7 KB boot script instead of the runtime.
- **Layouts.** A layout that needs one React root (a client provider around the pages) renders as
  an islx server tree: the browser rebuilds it from the HTML, so its module stays on the server,
  and a navigation keeps the provider's state.
- **Actions.** `"use server"` functions compile to islx action references. A form posts its action
  without a page load, or without JavaScript, and the page refreshes with its islands' state kept.
- **Navigation.** A navigation fetches the page's HTML, streamed, with only the layouts the
  browser does not keep, and hydrates the islands it brings.

## Libraries written for React Server Components

Islands mode runs libraries written for RSC the way their docs show it. Farm shims the RSC-only
parts:

| Pattern                                                                                                                                 | Works | How islands mode does it                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A package that ships a `react-server` build (react-tweet's server `Tweet`, react-i18next, react-hook-form, swr, `@apollo/client/react`) | yes   | A server module's import resolves to that build, and so do the packages it imports. Names it takes from a `"use client"` module stay client components. React itself keeps one build for server and client components. |
| `import "server-only"` in server code                                                                                                   | yes   | Server builds get an empty module. A browser build that imports it fails, naming the importer.                                                                                                                         |
| `import "client-only"`                                                                                                                  | yes   | A client component gets its empty build; a server component gets its `react-server` build, which throws, as RSC rejects it.                                                                                            |
| A package client component in a server component (`next-themes`, `sonner`'s `Toaster`, Radix parts, jotai's `Provider`, `SWRConfig`)    | yes   | Farm writes a client reference module for each export (`.farm/client-references/`) and server code imports that, so the export renders as an island, as RSC renders a client reference.                                |
| A package provider around server content                                                                                                | yes   | Client components inside it are its descendants and read its context.                                                                                                                                                  |
| A package provider in a layout                                                                                                          | yes   | The layout renders as a server tree; the provider keeps its state across navigations.                                                                                                                                  |
| `useFormStatus` in a client component inside a server `<form>`                                                                          | yes   | Farm points the import at islx's `useFormStatus`, which reports the server form's submit.                                                                                                                              |
| `useId` in client components                                                                                                            | yes   | Ids match the server HTML and are unique across islands.                                                                                                                                                               |
| `cache` from `react` in server code, or `React.cache`                                                                                   | yes   | Farm points them at a request-scoped `cache`, as RSC memoizes it, in app server code and in the `react-server` builds it reaches.                                                                                      |
| `cacheSignal()` from `react` in server code                                                                                             | yes   | It returns the request's `AbortSignal`, which aborts when the response ends, as RSC's does after a render.                                                                                                             |
| A namespace import passed around as a value (`const { Close } = Dialog`)                                                                | yes   | Its components become client references; its other exports (`createDialogScope`) come from the package.                                                                                                                |

`tests/e2e-server-components/compat.spec.ts` runs these against both engines.

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
