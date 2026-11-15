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

## Candidate-present tag scanning

The next scanner change replaces three anchored expressions over `html.slice(start)`
with equivalent sticky expressions at `lastIndex = start`. The expressions are local
to one synchronous scan and reset before each match. Recognition stays anchored;
comment/raw-text handling, quoted attributes, tag ends, budgets and output editing
are unchanged. The no-candidate guard still runs before allocating these expressions.
This does not change response buffering, streaming, public APIs, or rendering.

Compare against the immediate pre-change source, not the original no-candidate
optimization's default baseline:

```sh
node benchmarks/preload-scanning/verify.mjs 74551c17b7d609cc88b3dd8b3b43a050e313f5c8
node benchmarks/preload-scanning/run.mjs 74551c17b7d609cc88b3dd8b3b43a050e313f5c8
```

The baseline commit must be available locally. `verify.mjs` compares 600 deterministic
documents in both public HTML-manager entry points across enforce/warn modes, budgets
0/1/2, and three Link-header inputs: 14,400 output comparisons. Cases include mixed
case, quoted attributes, malformed tags, comments, every existing raw-text category,
self-closing SVG, Unicode (including case expansion), and truncated documents.
This proves equivalence for that corpus, not correctness of every legacy parser edge
case. The unit work-count regression fails on the baseline: 1,443 remaining-document
slices instead of only the final output tail. Separate unit cases preserve anchored
recognition and repeated-call behavior.

### Local diagnostic (2026-10-07)

Apple M1, macOS arm64, Node 24.21.0. Three fresh benchmark processes, each using the
seven alternating rounds and correctness checks described above. Median of the three
run-median process-CPU measurements for documents with two HTML image hints:

| HTML bytes | Baseline CPU/call | Candidate CPU/call |
| ---------- | ----------------: | -----------------: |
| 7,448      |         0.0821 ms |          0.0596 ms |
| 72,248     |         0.7704 ms |          0.5436 ms |
| 720,248    |         7.5432 ms |          5.5326 ms |

Candidate-present CPU was lower in all 63 round pairs (three sizes × seven rounds ×
three processes). Wall time was lower in 61/63. This is scanner-only evidence, not
HTTP/SSR latency or a cross-framework score. The shared host was heavily loaded
(one-minute load approximately 18–48); no-candidate/header-only controls were mixed,
and quiet-runner confirmation is required before a release performance claim.

The standalone module, transformed with esbuild `loader: "ts", format: "esm",
minify: true`, grows from 5,293 to 5,319 bytes; gzip from 2,158 to 2,189 bytes. These
are isolated helper sizes, not an application bundle measurement. No browser entry
point or renderer changes are required. Production verification uses the existing
`production-prebuilt-ssr.test.ts` case `enforces final preload budgets after HTML
transforms`, both with and without a plugin, exercising a built Node server, final
HTML/Link budgets, priority selection, cookies and internal-marker cleanup.

## Bounded candidate scan

Candidates can only appear in a `<link>` tag that contains a standalone `preload`
token, so no link that starts after the last token can be budgeted. The scanner now
finds that last token, stops walking tags once a tag starts past it, and case-folds
only the prefix it can reach. A raw-text element that opens before the last token
but closes after it folds the rest of the document on demand, so inert text keeps
its existing handling. Non-candidate links after the bound only contributed position
indexes, and the remaining indexes keep their relative order, so budgets, priority
selection and output editing are unchanged. Documents without a token still return
before any normalization.

This targets the common Farm shape: Farm fonts and the docs handler emit font
preloads in `<head>`, so every page of a font-using app previously walked and
lowercased the entire body. The `head-font-hints` workload measures that shape.
`html-hints` (hints at the end of the body) is the control: its bound is the end of
the document, so it should not change.

```sh
node benchmarks/preload-scanning/verify.mjs <baseline>
node benchmarks/preload-scanning/run.mjs <baseline>
```

`verify.mjs` now includes raw-text fragments whose element closes well past the last
token, for every raw-text category, so the on-demand folding path is compared too.
