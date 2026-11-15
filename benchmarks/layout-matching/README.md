# Prepared production layout matching

Production layout descriptors are private, immutable and already depth-ordered. Previously, every
non-root layout called `isFarmRouteActive` on every request, repeating pattern validation/parsing and
URL normalization. The internal selector now prepares those patterns once per server-module instance
and normalizes each request once, lazily. Empty/root-only tables do not parse URLs.

The public router and production selector share the original parser, URL normalization, decoding and
segment matcher. Public router exports and behavior are unchanged. Stable layout order, descriptor
identity and fresh result arrays are preserved. No request URLs/results are cached; memory is bounded
by the fixed layout manifest. Invalid patterns fail during preparation instead of the first request.
Client navigation, development route selection, page-route matching and configuration are unchanged.

## Reproduce

From the repository root, with the same Node version for both arms:

```sh
pnpm --filter @farm.js/core build:runtime
pnpm --filter @farm.js/core exec vitest run src/__tests__/production-layout-order.test.ts src/__tests__/router.test.ts src/__tests__/star-optional.test.ts
node benchmarks/layout-matching/run.mjs > /tmp/farm-layout-matching-first.json
node benchmarks/layout-matching/run.mjs > /tmp/farm-layout-matching-second.json
```

Do not run builds/tests alongside timing. The baseline is the selector from main at `b9897677`, after
the redundant sort was already removed. It uses the unchanged public router. The candidate executes
the current emitted selector and built internal helper. Each run uses seven alternating fresh-process
pairs, 1,000 warmups and 5,000 measured lookups per scenario. Correctness assertions run outside
timing. Setup is measured separately (20 warmups, 100 creations), including retained pattern arrays.
These setup times are factory work, not total process startup or module-import latency.

JSON includes all pairs, wall/CPU times, source hashes, Git revision, host load and environment.
Helper-size comparisons bundle the complete transitive matcher, not just the selector wrapper.
They are not application bundle measurements. `benchmarks/layout-order/run.mjs` remains a separate
sorting-only diagnostic with the same current matcher in both arms.

## Local evidence

Apple M1, macOS, Node 24.21.0; base `b9897677` plus this change. Two runs, no concurrent builds/tests
in this checkout. One-minute host load was 6.20 → 5.34 and 4.58 → 3.86; other host activity is not
controlled. Median wall milliseconds per lookup:

| Scenario                              |  Run 1 before → after |  Run 2 before → after |
| ------------------------------------- | --------------------: | --------------------: |
| Root only                             | 0.0000912 → 0.0000695 | 0.0000889 → 0.0000700 |
| 16 nested layouts                     |   0.138923 → 0.016269 |   0.136732 → 0.016236 |
| 100 layouts, nested hit               |   0.397165 → 0.026701 |   0.393064 → 0.026472 |
| 100 layouts, root-only match          |   0.286628 → 0.014155 |   0.283096 → 0.014050 |
| Mixed dynamic/catch-all/encoded paths |   0.017315 → 0.004120 |   0.017391 → 0.004134 |

The non-root workloads reduce selection time by approximately 76–95%, with lower wall and CPU time
in all 14 pairs for each non-root scenario. Root-only timings are mixed (10/14 wall and 10/14 CPU wins);
the median savings are only about 19–22 ns, not a meaningful application-performance claim. The basic framework benchmark
has one root layout, so these results do not establish an improvement against another framework.
No full SSR, HTTP latency, throughput, hydration or benchmark-publication claim is made.

Tradeoffs: preparing 100 layouts costs approximately 0.224 ms once per server-module instance in
these runs; the baseline creates only a closure. Parsed segments and descriptor references remain
for that instance's lifetime (O(total pattern segments)), without growth per URL or request.
The isolated minified helper bundle is 3,916 → 3,953 bytes; gzip is 1,535 → 1,551 bytes.
Separately bundling the complete public router for the browser against `b9897677` with esbuild gives
6,700 → 6,702 minified bytes and 2,557 → 2,544 gzip bytes: no material public-router size increase.

Deterministic regression control: with 16 non-root layouts, the new allocation test fails before the
fix with 16 URL constructions, 16 RegExp constructions and 16 Sets per request. After the fix it
observes one URL and no pattern-validation RegExp/Set constructions. It also checks zero URL work
for root-only/empty manifests, invalid-pattern rejection, stable ties, frozen descriptor identity,
independent manifests and encoded/malformed URL parity with the public matcher. The production
fixture covers repeated requests to a built Node server, dynamic and optional catch-all layouts,
encoded params and the Node adapter's existing HTTP 400 rejection of malformed escapes.

## Verification scope

On the same macOS/Node 24 environment:

- 305 tests across 14 core routing, URL/security, generated-client, i18n and SSR suites passed.
- `pnpm test:renderers`: 133 renderer tests and the renderer type checks passed. The first attempt
  stopped at missing core declarations after `build:runtime`; the full core build resolved that
  prerequisite and the complete command passed on retry.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @farm.js/core build` and
  `pnpm --filter @farm.js/core type-check` passed, including declaration generation.
- Three selected tests in `production-prebuilt-ssr.test.ts` passed: nested layout selection,
  configured base-path routing, and isolated client hydration/shared roots across navigation.
  The browser test used installed Playwright Chromium headless shell 1208 through
  `FARM_TEST_CHROMIUM_EXECUTABLE_PATH`; it did not skip browser assertions.
- `production-middleware.test.ts` passed its built Vercel/Nitro runtime fixture. This is not a
  hosted Vercel deployment check.
- Focused formatting and lint checks passed (one existing unused-variable warning in
  `universal-build.ts`). Both matching diagnostics and the updated sorting diagnostic completed.

Cross-platform CI and an end-to-end framework benchmark remain separate validation. No release,
published benchmark numbers, generated fixture sources, configuration or public API were changed.
