# File middleware matcher benchmark

```sh
pnpm --filter @farm.js/core exec vitest bench src/__benchmarks__/file-middleware.bench.ts --run
```

The preserved control is the file-route matcher from `1307b964`, with only its
import path and export visibility changed. Every result is checked against that
control before timing. Both implementations match the same 100 dynamic file
middleware entries; production and development must visit all applicable entries
because middleware cascades rather than selecting only one route.

The optimized path prepares exact and descendant patterns once per middleware
entry, sharing the existing config matcher compiler. The WeakMap follows entry
lifetime, and compares the live path on every call to preserve path edits. HMR
replacement entries get new patterns. No request-path cache is retained.

Observed on macOS arm64, Node 24.21.0, Vitest 3.2.7 (mean ms per 100-entry scan):

| Request | Previous | Prepared |
| --- | ---: | ---: |
| `/missing` | 0.2357 | 0.0262 |
| `/resource-99/value/nested` | 0.4841 | 0.0308 |
| `/resource-99/%2541BC` | 0.4484 | 0.1456 |

Relative margin of error was 4–6% except the previous nested-match case (21%).
These are warmed matcher CPU measurements, not whole-request latency claims.
The deterministic regression counts 200 regular-expression constructions before
and zero after on a warmed miss in both development and production runners.
Startup retains two patterns per non-root middleware entry; request work still
scans the middleware list and canonicalizes encoded pathnames.

An esbuild-minified Node ESM bundle of `src/middleware/production-runtime.ts`
measured 32,235 → 31,263 bytes, or 10,629 → 10,545 gzip bytes, because duplicate
compiler implementations were removed. These are isolated bundle sizes, not
complete application sizes. No public API or dependency changes are required.
