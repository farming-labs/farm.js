# In-flight page-data prefetch reuse

This is a deterministic request-count benchmark, not a wall-clock latency claim. It covers the
development/page-data SPA router. The generated production HTML-navigation router is unchanged.

## Workload and correctness control

Start one prefetch, hold its JSON response, then start navigation from the same document. Release
the response only after navigation enters the data loader. Count network requests and verify one
render, the destination URL, and title. No arbitrary delay determines the overlap.

```sh
pnpm --filter @farm.js/core exec vitest run src/__tests__/spa-router-prefetch-navigation.test.ts
pnpm exec playwright test --config playwright.config.ts tests/e2e/prefetch-navigation.spec.ts
```

The browser case uses the real Basic example and Vite page-data endpoint; it gates delivery without
mocking the payload. The unit suite also controls refresh, changed layout/interception context,
cancelled navigation, transport/HTTP/JSON failures, deferred streams, cache clearing, and teardown.

On macOS arm64, Node 24.21.0, pnpm 8.12.1:

| Work per overlapping JSON prefetch/navigation | Before (`f920c090`) | After |
| --------------------------------------------- | ------------------: | ----: |
| Page-data network requests                    |                   2 |     1 |
| Destination renders                           |                   1 |     1 |

The request-count regression fails on the baseline with `expected 1, received 2`. The Chrome
development browser test passes with the fix. The reduction applies only when compatible work
overlaps; it is not a claim that all navigation is twice as fast.

## Runtime cost

Bundling `packages/farm/src/client/spa-router.ts` with esbuild 0.28.0, browser platform, ESM,
bundling and minification enabled, without externalizing dependencies:

| Standalone module bundle | Before |  After |
| ------------------------ | -----: | -----: |
| Minified bytes           | 61,304 | 63,193 |
| gzip bytes               | 18,797 | 19,535 |

The standalone measurement includes transitive dependencies and is not a full app transfer-size
measurement. The added cancellation helper may already be shared with other client code in an app.
Each active prefetch retains one pending result record; settlement, cache clearing, and teardown
release joinable entries. Normal navigation without a matching prefetch does not create a record.

## Limits

Only successful, completely decoded JSON responses are shared. Deferred streams retain separate
requests and abort ownership; a waiting navigation falls back as soon as response headers identify
a deferred stream. This can wait for prefetch headers before dispatching the independent request.
Failed prefetches retry through navigation's existing recovery path. Refreshes and different
interception/layout contexts deliberately bypass sharing. Production HTML prefetch coalescing is
outside this change.
