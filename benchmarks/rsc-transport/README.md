# RSC transport benchmark

This benchmark compares five ways to deliver the same content-heavy UI:

1. React Server Components serialized as a production Flight payload.
2. An RSC payload containing a server-rendered, host-only opaque HTML subtree.
3. Server-rendered HTML parsed directly by the browser.
4. A compact semantic UI representation rendered by a reusable JavaScript renderer.
5. The same UI representation rendered by a reusable Rust/WebAssembly renderer.

The released `@farming-labs/strata` native package, the JavaScript renderer, and the benchmark's
Rust/Wasm renderer must produce byte-for-byte identical HTML. Flight renders the same semantic blocks
as React host elements. The fixture intentionally includes headings, inline markup, lists, callouts,
and syntax-highlighted code so the result is more representative than a flat list of text nodes.

## Metrics

- Raw, gzip, and Brotli payload bytes for UI IR, HTML, element-tree Flight, and opaque-HTML Flight.
- Incremental JavaScript renderer and Rust/Wasm asset bytes.
- Warm server render/serialization CPU for JavaScript HTML, the released Strata N-API package, and
  Flight.
- Browser fetch, decode/render, synchronous DOM/React commit, and total navigation time.
- Cold JavaScript module load and Wasm fetch/compile/instantiate time.
- Warm navigation results after both reusable renderers are loaded.
- Preservation of a stateful client shell while both Flight representations change beneath it.

This is a controlled content workload, not a universal framework ranking. It does not model database
latency, authorization, CDN latency, nested Client Components, Suspense waterfalls, or every browser
and device class.

See [DESIGN.md](./DESIGN.md) for the architectural interpretation and proposed Farm/RSC integration.
The latest checked-in measurements are in [results/latest.md](./results/latest.md).

## Reproduce

Install the isolated benchmark workspace:

```sh
corepack pnpm --dir benchmarks/rsc-transport install --frozen-lockfile
```

Generate fixtures, build the Wasm renderer and browser fixture, and record server results using the
installed Strata native package:

```sh
corepack pnpm --dir benchmarks/rsc-transport benchmark:server
```

Start the production benchmark server:

```sh
corepack pnpm --dir benchmarks/rsc-transport serve
```

Open `http://127.0.0.1:4179` and click **Run browser benchmark**, or run:

```js
await window.runTransportBenchmark();
```

The browser result is posted to `generated/browser-results.json`. Run the server benchmark again to
produce the combined Markdown and JSON report.
