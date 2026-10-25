# RFC 0002: Owned page responses and a Node response fast path

- Status: Implemented in 0.1.29 (see [Outcome](#outcome))
- Tracking issue: none yet
- Scope: production page responses in Farm's generated server (all renderers; the fast Node
  response applies to Node presets only)

## Summary

After a page renders, Farm's production server passes its `Response` through several header
steps. Each step copies the headers into a new `Headers` and wraps the body in a new `Response`,
even when it adds a single header. On Node, the finished Web `Response` is then converted back
into a Node response, and a fully rendered page is sent with `Transfer-Encoding: chunked` because
its body travels as a `ReadableStream`.

This RFC proposes two changes:

1. **Owned responses.** Responses Farm creates for the current request (page documents, error
   documents, PPR shells) are marked as owned. Header steps edit an owned response's headers in
   place and return the same object. Every other response (from API routes, middleware, plugins,
   or user code) keeps today's copy-on-write behavior.
2. **A Node response fast path.** On Node presets, owned responses with a buffered body are
   created as srvx's `FastResponse`, the lazy response Nitro's Node server already sends
   natively. A string body is written directly with `Content-Length`, with no Web `Response`,
   `Headers` or `ReadableStream` in between.

User-facing APIs do not change: middleware, API routes, server functions and plugins still
receive and return standard Web `Request` and `Response` objects.

## Motivation

Server CPU per request on the framework benchmark app (`benchmarks/frameworks`, one dynamic page
rendering a 120-item list, 4000 sequential keep-alive requests, CPU of the server process):

| Framework            | CPU per request |
| -------------------- | --------------- |
| SvelteKit 3.1        | 255-270 µs      |
| Farm (main)          | 355-412 µs      |
| TanStack Start 1.169 | 512-517 µs      |
| Nuxt 4.6             | 752-762 µs      |
| Next.js 16.4         | 2335-2405 µs    |

A CPU profile of Farm's request splits it roughly into React rendering (about 100 µs), Node's
HTTP layer (about 100 µs), Farm's routing and document assembly (about 85 µs), garbage
collection (about 50 µs) and Web `Request`/`Response`/`Headers` objects (about 38 µs). Most of the
last item, and part of the garbage collection, comes from the response pipeline described here.

For a buffered page the generated server currently runs:

1. `new Response(html, { headers })` for the rendered document
2. `applyProductionMiddlewareHeaders`: copy
3. `applyConfiguredResponseHeaders` and `applyFarmCspNonceToResponse`: copy when they apply
4. `applyFarmPreloadBudget`: copy, to remove its internal marker headers
5. `applyMarkdownNegotiationHeaders`: copy, to add `Link` and `Vary: Accept`
6. `compressFarmResponse`: copy, to add `Vary: Accept-Encoding` for identity responses
7. srvx converts the Web `Response` back into a Node response and streams the body chunk by
   chunk

`benchmarks/response-pipeline/bench.mjs` isolates steps 1 to 7 for the benchmark page (8 KB),
against one owned `FastResponse` edited in place and sent through the same `sendNodeResponse`:

| Pipeline                       | CPU per request (median of 5) |
| ------------------------------ | ----------------------------- |
| Today: rebuilt Web `Response`  | 81.8 µs                       |
| Proposed: owned `FastResponse` | 55.1 µs                       |

That is about 27 µs per request, or 7 to 8 percent of Farm's total on the benchmark app. Both
pipelines send the same body and headers; the proposal adds `Content-Length`.

This does not close the gap to SvelteKit on its own. Most of the remaining difference is React's
renderer compared with Svelte's compiled output, and Farm's document assembly (head, metadata,
JSON-LD, theme bootstrap). Those are separate follow-ups (see [Future work](#future-work)).

## Design

### Ownership

A small internal module keeps a `WeakSet` of owned responses, stored on a `Symbol.for` key so the
generated server and core modules share it:

```ts
const OWNED = Symbol.for("farm.ownedResponses");

export function _markFarmOwnedResponse<T extends Response>(response: T): T;
export function _isFarmOwnedResponse(response: Response): boolean;
```

The generated server marks a response at the point it constructs it for the current request:
page documents, error documents, the not-found document and PPR shells (built from cached
strings, never from a cached `Response`). Nothing else is marked. A response returned by user code
is never owned, so a module-level `Response` reused across requests can never accumulate headers.

### In-place header steps

One helper replaces the copy in each step:

```ts
function withFarmResponseHeaders(response: Response, edit: (headers: Headers) => void): Response {
  if (_isFarmOwnedResponse(response)) {
    edit(response.headers);
    return response;
  }
  // Today's behavior for responses Farm does not own.
  const headers = new Headers(response.headers);
  edit(headers);
  return _markFarmOwnedResponse(
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}
```

`applyProductionMiddlewareHeaders`, `applyConfiguredResponseHeaders`, the CSP header part of
`applyFarmCspNonceToResponse`, `applyFarmPreloadBudget`, `applyMarkdownNegotiationHeaders` and the
compression `Vary` step use it. A copy made for an unowned response is owned from then on, so
later steps in the same request edit it in place. Steps that change the body (the CSP nonce
rewrite, compression, plugins) still create a new response.

### Node fast path

On Node presets (`node-server` and the Node function targets), an owned response with a buffered
string body is created as srvx's `FastResponse` instead of the global `Response`. srvx is already
the server Nitro runs on these presets, and `sendNodeResponse` writes a `FastResponse` string body
in one call with `Content-Length`.

`FastResponse` is a `Response` (`instanceof Response` holds and its prototype inherits from it).
Reading `.body`, `.text()`, `.clone()` or `.arrayBuffer()` materializes a standard `Response`
transparently, so plugins and hooks that read the body keep working; they only lose the fast path
for that request.

Farm's buffered-HTML tracking (`rememberFarmBufferedHtml`) is keyed by `response.body`, which would
materialize the body. It moves to a `WeakMap` keyed by the owned response, with the same
invalidation rule: any step that replaces the body creates a new response and drops the entry.

Streaming pages keep their `ReadableStream` body. They still benefit from in-place headers.

Edge and worker presets (Cloudflare, Netlify Edge, Vercel Edge) keep the global `Response`; only
the ownership and in-place header changes apply there.

## Compatibility and safety

- **HTTP semantics.** Buffered pages gain `Content-Length` and lose `Transfer-Encoding: chunked`.
  The body and all other headers are unchanged. HEAD responses keep their headers and send no
  body, as srvx already handles.
- **User code.** Middleware, API routes, server functions and plugins see standard Web objects.
  Responses they return are never owned and are copied exactly as today.
- **Caches.** ISR, PPR and the data cache store strings or their own entries, not owned `Response`
  objects. A test pins this: serving a cached page twice must not repeat any header.
- **Header guards.** An owned response is always constructed by Farm, so its headers are mutable;
  an immutable `Headers` (from `fetch`) can only belong to an unowned response, which is copied.
- **Disabled features.** With no markdown mirrors, no preload budget, no compression and no
  configured headers, the pipeline does no header work at all, as today.

## Acceptance

- Full `@farm.js/core` suite, renderer tests and `pnpm test:deploy-runtimes` on Linux and Windows.
- Production Playwright suites (`playwright.production*.config.ts`) and the RSC suite.
- New tests: an unowned response returned by an API route is not mutated; a module-level `Response`
  served twice keeps its headers; a cached page served twice has no repeated `Link` or `Vary`; a
  plugin that reads the body still receives the full document; HEAD keeps headers.
- `benchmarks/frameworks`: before and after CPU per request and latency, at least 3 alternating
  rounds, plus `benchmarks/response-pipeline/bench.mjs`.

## Rollout

Three pull requests, each shippable on its own:

1. Ownership module and `withFarmResponseHeaders` in every header step (all presets).
2. `FastResponse` for owned buffered responses on Node presets.
3. Buffered-HTML tracking keyed by the owned response.

No configuration flag: the change is internal and the acceptance tests cover the observable
behavior. If a regression appears, reverting PR 2 restores today's Node sending.

## Outcome

Shipped in 0.1.29 as four pull requests instead of the three above:

1. [#2118](https://github.com/farming-labs/farm.js/pull/2118): ownership and in-place header
   steps, as designed. About 9% less server CPU per page request (375 to 342 µs).
2. [#2120](https://github.com/farming-labs/farm.js/pull/2120): on `node-server`, the Nitro entry
   turns the final response into a `FastResponse` when its body is still the string Farm built.
   About 3% less CPU and 5% lower latency.
3. [#2122](https://github.com/farming-labs/farm.js/pull/2122): use srvx's own `Request` instead
   of copying it to swap the abort signal. About 1%.
4. [#2124](https://github.com/farming-labs/farm.js/pull/2124): buffered pages are built as
   `FastResponse` from the start (`farmOwnedHtmlResponse`), so the HTML is never encoded twice.
   About 6% less CPU for both identity and brotli responses.

Together, page requests on the benchmark app went from about 375 to about 310 µs of server CPU.
The runs were on different builds and machine loads, so treat the total as an estimate.

Differences from the design above:

- **Where `FastResponse` is created.** Only `node-server` registers it
  (`useFarmNodePageResponse`). Other Node function targets keep the Web `Response`.
- **Buffered-HTML tracking.** Pages built as `FastResponse` are tracked by the response object.
  Every other response keeps the existing tracking by `response.body`, so the planned third pull
  request was not needed.
- **Steps that only checked for a body.** The preload budget and compression's eligibility check
  read `response.body` just to know a body exists. They now skip that read when the HTML is
  already known, and compression takes a `lazyBody` flag so it does not create a body only to
  cancel it.
- **Nitro route rules.** `routeRules.headers` are applied after the handler returns, and h3 then
  rebuilds the response from its body. Pages with route-rule headers keep the chunked path. They
  stay correct, only without the speedup.
- **Compressed bodies.** Sending compressed pages in one write was built and measured, and showed
  no difference beyond noise, so it was not shipped. Compression itself (about 86 µs for brotli
  on an 8 KB page) dominates that path.

## Alternatives considered

- **Patching the global `Response`** (srvx's `patchGlobalRequest` style) would speed up every
  response, including user code, but changes behavior Farm does not own. Rejected.
- **Mutating every response in place** is simpler but unsafe: a response object reused across
  requests (a module-level constant, or a future cache) would accumulate headers. Ownership limits
  in-place edits to responses Farm created for this request.
- **`renderToString` for pages that do not suspend** would avoid stream bridging, but deciding
  that before rendering is not possible without changing Suspense semantics.

## Future work

- Precompute the static parts of each route's document head at build time and assemble the
  document in one pass, instead of the current prefix, root and head string scans. Measured after
  the rollout, those scans cost about 8 to 9 µs per request, and only 2 to 3 µs can be removed
  without changing how unusual documents are handled.
- Skip creating the Web `Request` for page requests on Node when no middleware, plugin or route
  needs it. srvx builds a native `Request` (about 15 µs), and Farm and user code call
  `new Request(request, ...)`, which needs one, so this is not a small change.
- Most of the remaining cost is React's renderer (rendering, then encoding its output to bytes)
  and Node's HTTP layer. A server compiler that emits HTML strings from JSX would be the next
  large step.

## Open questions

- Should owned responses be exposed to plugins as a documented contract, or stay internal?
- Do any first-party integrations hold on to a page `Response` after returning it?
