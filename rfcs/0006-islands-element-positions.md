# Client components where `<f-island>` cannot go

Status: Implemented (islands mode, experimental).

## Problem

Islands mode (RFC 0003) wraps each client component in `<f-island>`, the element its React root
hydrates. Some positions cannot hold that element:

| Server JSX                                 | What the browser gets                                                    | Today                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `<ul><Item /></ul>`, `Item` renders `<li>` | `ul > f-island > li`: `ul > li` selectors and `:nth-child` stop matching | Renders; layout and CSS differ from React Server Components                                     |
| `<table><tbody><Row /></tbody></table>`    | The parser moves `<f-island>` out of the table (foster parenting)        | Build refuses: "renders inside `<table>`, where the HTML parser relocates its hydration marker" |
| `<select><Option /></select>`              | The parser drops `<f-island>`                                            | Build refuses                                                                                   |
| `<svg><Shape /></svg>`                     | `<f-island>` becomes an SVG element with no layout                       | Build refuses                                                                                   |

React Server Components have none of these limits: the whole page hydrates as one React root, so
a client component's `<li>` is a direct child of the server's `<ul>`. The battle suite pins the
list case (`tests/e2e-server-components/battle.spec.ts`, `test.fail` for islands), and the
checker tests pin the refusals (`packages/farm/src/__tests__/islands-mode.test.tsx`).

React only hydrates into an element: a root cannot own a range of sibling nodes, so a marker made
of comments, as React uses for Suspense, is not an option without a React change.

## Decisions

- **The island grows to the nearest element that can hold it.** When the checker finds a client
  component inside `ul`, `ol`, `table`, `thead`, `tbody`, `tfoot`, `tr`, `select`, `optgroup`,
  `datalist` or `svg`, that container (the whole `<table>`, the whole `<ul>`) becomes the
  island instead of the client component. Its server-rendered parts hydrate as static server tree
  nodes, the same mechanism `createServerTreeElement` uses for layouts that hydrate as one root;
  its client components are ordinary components inside that root.

## Implementation

- `farm:island-containers` (`packages/farm/src/vite.ts`) runs before JSX compiles. In a server
  module it wraps the outermost container around a client component in `FarmIslandContainer`, a
  generated client module (`.farm/client-references/farm.js+core/__island-container.tsx`) that
  renders its children. `islands-containers.ts` finds the containers on the module's AST.
- The container is an ordinary island whose `children` hold client components, so islx sends them
  as a slot server tree and the browser rebuilds them in the container's root (islx's
  `renderSlotTree`). No islx change was needed.
- The hydration plan selects the container module where it used to refuse the page, and leaves
  every other page alone: the plugin returns the module unchanged when it has no container
  around a client component.
- **Same output as React Server Components.** The browser gets `ul > li`, a table the parser keeps
  intact, and real `<option>` and SVG children. `<f-island>` goes around the container, where it
  is valid.
- **The checker's refusal becomes this fallback**, the way RFC 0001's isolated hydration falls back
  to hydrating the route. The build reports which container grew and why
  in its islands report, since the island now ships the container's server HTML as a tree. (Not
  implemented yet: the build grows the container silently.)
- **Opt-out stays explicit.** Moving `"use client"` up to a component that renders the whole
  container keeps working and stays the cheapest choice; the docs say so.

## Alternatives

- **Comment markers instead of `<f-island>`.** Needs a React root over a node range. React 19.2's
  `createRoot` and `hydrateRoot` take an element, a document or a fragment (`isValidContainer`),
  not a comment.
- **`display: contents` on `<f-island>`.** Fixes boxes, not the parser (tables, select) or
  selectors (`ul > li`).
- **Hydrate the whole route as one root on any such position.** Correct but gives up islands for
  the page; the container is the smallest root that works.

## Scope and acceptance criteria

- The four rows above render like React Server Components in production and dev, on Node,
  Cloudflare and Vercel: the battle list test runs without `test.fail`, and new battle tests cover
  a table row, a select option and an SVG shape, each with state that survives a client
  navigation.
- A page without such positions builds byte-identical output.
- The grown island's extra bytes are measured on the payload benchmark (docs, shop, blog) and
  reported in the PR.

## Verification plan

- `pnpm test:e2e:server-components:run` (every mode, target and server combination).
- `pnpm --filter @farm.js/core test` for the checker.
- `node benchmarks/server-components-payload/measure.mjs` before and after.
