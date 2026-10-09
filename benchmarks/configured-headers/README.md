# Configured response header matching

Production resolves `headers()` at build time. This diagnostic measures preparing those immutable
patterns once per server module and decoding each request pathname once, using the existing page
matcher's fixed-segment descriptors. Wildcard/catch-all patterns keep the complete backtracking
matcher. Header order, additive cookies/links, and lazy response copying are unchanged.

## Reproduce

From the repository root, with dependencies installed:

```sh
pnpm --filter @farm.js/core exec vitest run src/__tests__/configured-header-runtime.test.ts src/__tests__/universal-build-router-runtime.test.ts src/__tests__/route-matcher-parity.test.ts src/__tests__/config-route-plugins.test.ts
pnpm --filter @farm.js/core build:runtime
pnpm --filter @farm.js/core exec vitest run src/__tests__/production-prebuilt-ssr.test.ts -t 'boots standalone Node output'
node benchmarks/configured-headers/run.mjs > /tmp/configured-headers-first.json
node benchmarks/configured-headers/run.mjs > /tmp/configured-headers-second.json
```

Run timings sequentially, without local builds/tests competing for CPU. The runner extracts the
actual generated matcher/header source. The baseline restores the original per-rule string matcher
and removes preparation; all header application code is identical. No package build is needed for
the helper measurements. The standalone production test is a separate real Node HTTP check.

Each scenario uses five alternating fresh-process pairs, 2,000 warmups, and five 10,000-call batches
per process. JSON preserves every sample and reports the median of process means in microseconds.
It also records environment/load and source/runner hashes. No timing threshold is used as a test.
The empty, single-rule, already-set-header, 32-rule hit/miss, and catch-all controls are separate.
Malformed percent encoding has its own scenario because repeatedly catching decoding errors can
dominate it; do not present that exceptional case as typical valid-URL performance.

Assertions outside timing compare expected headers, status, body identity, and no-op response
identity for both arms. The focused tests additionally compare each rule against the complete
matcher across encoded slashes, double encoding, malformed encoding, Unicode, trailing/repeated
slashes, ambiguous patterns, and overlapping rules. They cover cookie order/deduplication, additive
Link values, null bodies, and unmodified input responses. A deterministic work-count test proves
patterns are prepared once and requests are not decoded once per rule.

## Costs and limits

Preparation retains O(total configured pattern segments) state per server-module instance, not
per request. There is no pathname/result cache. Setup is measured separately using 20 warmups and
1,000 factory calls; those timings exclude JavaScript parsing/compilation and are not a complete
cold-start measurement. The runner reports minified/gzip matcher-plus-header source sizes, not an
application/client bundle. Inspect setup and size costs alongside request gains.

These are helper measurements, not full HTTP/SSR throughput or cross-framework rankings. The
maintained framework benchmark fixtures and published result files must remain unchanged. This
optimization affects production header matching only; development already prepares its configured
patterns, and neither development code nor the prerender/header contract is changed.
