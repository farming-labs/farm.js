# Preload scanning

Run from the repository root with Node 24:

```sh
node benchmarks/preload-scanning/run.mjs
```

The benchmark loads the checked-out `packages/farm/src/preload.ts` and the same
module from baseline commit `5a23cc145da41fd75b7224b1697b9adfdeb7f855`, using native
TypeScript stripping. It does not build packages, edit sources, or depend on stale
`dist` output. An alternative baseline Git revision can be passed as the first
argument; that revision must contain the standalone preload module.

It measures documents with 120, 1,200, and 12,000 list items, including ordinary
stylesheet/modulepreload links, in three cases:

- no budgeted hints;
- HTTP Link-header font hints only;
- budgeted HTML image hints at the end of the document (the parser fallback).

Both variants must produce identical HTML, headers, and warnings, and the expected
budget removals are asserted independently. Each variant warms up for 100 calls.
Seven measured rounds alternate order with 1,000 / 100 / 20 calls per round for
the three document sizes. The JSON output includes every round's elapsed and
process-CPU time per call, revision/source hashes, runtime, hardware, and host load.

This is a CPU microbenchmark, not an SSR or network-latency claim. Use an idle host
and retain the raw JSON when comparing results. The optimization only avoids
normalization/tag parsing when no standalone `preload` token exists. Possible
matches, including ordinary text and inert content, retain the existing parser;
header budgets always remain active. Response buffering and streaming are unchanged.
