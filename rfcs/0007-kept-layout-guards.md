# Kept layouts that cannot decide a request

Status: Implemented (islands mode, experimental).

## Problem

A client navigation in islands mode tells the server which layouts the browser still shows
(`f-layouts`). The server leaves their markup out of the response, but it still renders them
first, because a layout can be a guard: `redirect()`, `notFound()`, or an auth check that throws
decides the request, and the header is browser input, so a client could name any layout to skip
its guard (`renderPageElement` in `packages/farm/src/nitro/universal-build.ts`, and the dev
renderer). A kept layout that fails renders whole, so the control answers as on any other
request.

That render costs a full React server render of the layout chain whose HTML is thrown away. On
`benchmarks/server-components-payload`, docs section (a layout with a 300-entry sidebar), server
time per navigation, unloaded, curl, 299 requests after 200 warm-up, macOS, after #2899:

| Request                                        | Median  |
| ---------------------------------------------- | ------- |
| React Server Components, `/docs/pN.rsc`        | 1.22 ms |
| Islands navigation                             | 1.63 ms |
| Islands navigation, kept-layout render removed | 1.25 ms |

The whole remaining gap to React Server Components is this render. #2899 already removed its
island encoding. What is left is React rendering the layout's host elements.

Most layouts are not guards. A layout that renders navigation, a header and a sidebar from
constants and its params answers every request the same way.

## Prior behavior elsewhere

- **Next.js App Router** does not re-render layouts above the changed segment on navigation, and
  its docs tell apps not to rely on a layout for auth checks.
- **Farm's React Server Components mode** renders the full tree in Flight on every navigation, so
  every layout runs (and its output is sent: 12.0 KB per docs navigation vs 2.5 KB in islands).
- **Farm islands mode** runs kept layouts as guards and sends nothing for them. This RFC keeps
  that contract.

## Decision

**The build marks each layout that cannot decide a request. A kept layout so marked is not
rendered on navigation. Every other kept layout runs as it does today.** No configuration and no
new export: the result is a per-layout boolean in the route manifest the build already writes,
read by the production server and by `farm dev` from the same analysis.

A layout "cannot decide a request" when nothing it runs can throw or read per-request state.
The build proves it over the layout's **server module graph**: the layout file and every module
it imports, transitively, as resolved by the bundler (`this.getModuleInfo(id).importedIds`),
including client components, which also render during the guard pass. The proof fails closed: a
layout is marked only when every module in that graph passes, and any module the analysis cannot
read fails it.

A module fails the proof when it contains any of:

- `throw`, `await`, an `async` function, a generator, or `use(`
- an import of a request or control API: `@farm.js/core` server entry points, `redirect`,
  `notFound`, `forbidden`, `unauthorized`, `headers`, `cookies`, `getCurrentRequest*`, `draftMode`
- an import of a package outside a short allowlist of packages with no I/O and no request access
  (React and its JSX runtimes, Farm's client components such as `Link`, and asset or CSS
  imports). An auth SDK, a database client, an integration package or anything unknown fails it.
- a dynamic `import()`, `require`, `fetch`, `process`, `globalThis`, `Date`, `Math.random`,
  `crypto`
- a top-level side effect other than declarations (module state could change between requests)

A layout that only reads `params` passes: params are part of the layout's key, and a layout that
cannot throw renders for any params.

## Why this is safe against a forged `f-layouts`

Skipping a marked layout only skips work whose result is known: it cannot throw, so it cannot
redirect, 404 or refuse, for any request and any params. A client that names a marked layout it
does not show gets the page without that layout's markup, which is the same response it gets
today when the guard passes. An unmarked layout keeps today's behavior exactly.

## Costs

- **Build time.** One AST pass per module in layout graphs, reusing the parse cache
  (`memoizeInFarmSourceSnapshot`) that client-boundary analysis already fills. To be measured on
  `examples/server-components` and farmjs.dev before implementing.
- **No runtime cost** when no layout is marked: the server reads one boolean per kept layout.
- **Silent fallback.** A layout that fails the proof just keeps rendering, so an app gets no
  speedup without knowing why. The islands build report lists each layout and the first module
  and reason that failed it, the same place RFC 0006 reports grown containers.

## Alternatives

- **Skip every kept layout, as Next.js does.** Fastest, but it changes a shipped guarantee:
  apps that guard in a layout would serve protected pages to a client that forges the header.
  Rejected.
- **Cache a passed guard per layout key and params.** A layout that reads a database (`notFound()`
  when a record is gone) would answer from stale state. Farm's shared caches are opt-in with
  explicit revalidation; a default cache here would not be. Rejected.
- **Use the runtime request-read counter (`_getRequestReadCount`).** It sees `headers()` and
  `cookies()` but not I/O or randomness, so it cannot tell a database guard from a pure layout.
  Rejected as the sole signal.
- **Sign the kept-layout keys** so the server knows the browser was really shown the layout for
  these params. It removes the forged-params concern, but a guard that reads per-request state
  still has to run, so it saves nothing on its own and adds key management.
- **Analyze only the layout file**, as the static-route suggestion does (`analyzeStaticRouteCandidate`
  in `ssg.ts`). That analysis only suggests, because "request-bound work can live in a transitive
  import". Following the module graph is what makes this one sound enough to act on.

## Implementation

- `packages/farm/src/islands-kept-layouts.ts` runs the proof (`explainFarmKeptLayoutRender`
  returns the first module and reason that fails it). It follows imports with the same resolver
  the hydration planner uses (`resolveImportedModule`), and parses with the planner's AST cache.
- The production build writes `skipKeptRender: true` on a proven layout's entry in the server's
  layout table. `farmKeptLayoutsRender` returns at once when every kept layout carries it, and
  otherwise renders the whole kept chain as before: a proven layout can still provide context to
  one that is not.
- `farm dev` asks the same function on each navigation, and keeps the answer until a file it read
  changes size or mtime.
- Payload benchmark, docs navigation server time, medians of two rounds after a warm-up: islands
  1.28 to 1.32 ms with the skip, 1.76 to 1.77 ms on the same build with the flag cleared; React
  Server Components `.rsc` 1.31 to 1.32 ms.

Decisions on the questions this RFC left open:

1. **The allowlist starts minimal:** `react`, its JSX runtimes, and `Link` from
   `@farm.js/core/client`. Adding a package is a one-line change once it is shown to do no I/O.
2. **Client components are held to the same proof.** They render during the guard pass too.
3. **React Server Components mode is unchanged.**

Not implemented yet: the islands build report does not list which layouts were proven and why
the others were not.

Not a guard: a layout that throws by accident (a `TypeError` on a missing param) is not a
construct the proof sees. Skipping it for a forged `f-layouts` header only leaves out markup; it
cannot let a request through that a control would have stopped.

## Verification plan

- Unit tests for the proof over fixture graphs: pass for a static sidebar layout; fail for each
  disqualifier, including one buried two imports deep and one in an unknown package.
- Production and dev e2e: a guard layout still redirects a navigation that forges `f-layouts`;
  a marked layout's navigation response is unchanged byte for byte apart from timing.
- The payload benchmark's navigation server time, before and after, with the A/A noise run.
