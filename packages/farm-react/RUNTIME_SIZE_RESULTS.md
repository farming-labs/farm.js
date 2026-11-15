# Compiler runtime size results

The runtime-size benchmark builds fixed React fixtures with Vite's production minifier and reports
raw, gzip level 9, and Brotli byte counts. It also inspects the generated bundles so a direct-only
component cannot silently retain conditional, keyed, range, or component-island runtimes.

Run and update the recorded result:

```bash
pnpm --filter @farm.js/react benchmark:runtime-size
```

Run the persisted regression gate without rewriting the result:

```bash
pnpm --filter @farm.js/react test:runtime-size
```

The React compiler compatibility CI runs this command for the React 19 lane, so the checked budget
is enforced on every pull request instead of serving only as a manually recorded benchmark.

## Recorded fixture result

| Fixture                                           | Compiler off gzip | Compiler on gzip | Compiler premium |
| ------------------------------------------------- | ----------------: | ---------------: | ---------------: |
| Direct text, attribute, style, and event bindings |          60,104 B |         63,833 B |          3,729 B |
| Keyed rows, LIS, scalar, Set, and Map targeting   |          60,253 B |         72,504 B |         12,251 B |
| Keyed rows without directed binding targets       |          60,182 B |         70,347 B |         10,165 B |
| Keyed rows with append hints                      |          60,145 B |         72,826 B |         12,681 B |
| Keyed rows with prepend hints                     |          60,146 B |         73,145 B |         12,999 B |
| Keyed rows with removal + prepend hints           |          60,171 B |         74,545 B |         14,374 B |
| Keyed rows with filter hints                      |          60,143 B |         73,475 B |         13,332 B |
| Keyed rows with slice hints                       |          60,132 B |         73,512 B |         13,380 B |
| Keyed rows with known-position hints              |          60,133 B |         73,433 B |         13,300 B |
| Keyed rows with batch-position hints              |          60,147 B |         73,614 B |         13,467 B |
| Keyed rows with exact-window hints                |          60,185 B |         75,273 B |         15,088 B |
| Keyed rows with reverse hints                     |          60,113 B |         73,239 B |         13,126 B |
| Keyed rows with sort hints                        |          60,133 B |         73,279 B |         13,146 B |
| Keyed rows with rolling-window hints              |          60,175 B |         74,405 B |         14,230 B |

The isolated compatibility runtime contributes 27,041 B gzip over the React control. The
compiler-selected core contributes 3,769 B, an **86.1% reduction**. This comparison uses the same
hand-authored compiled definition and changes only the runtime entry used to create it.

The keyed fixture retains `FarmCompiledKeyedRows` plus compiler-emitted `identityTarget`,
`membershipTarget`, and `mapLookupTarget` metadata, plus Set/Map producer-delta helpers. It rejects
the optional row-conditional and keyed-update runtimes. The plain keyed fixture proves that a
component without directed binding targets drops those helpers, reducing the compiler premium by
2,086 B gzip and 1,821 B Brotli in the same run. Separate append, prepend, and filter
fixtures prove that recognized functional updates retain only the matching hinted runtime. The
removal-plus-prepend fixture retains its composed capability without changing the prepend-only or
structural-append bundles. Slice reuses the filter removal capability. Position-only, batch-position, exact-window, and
rolling-window modules select separate hint runtimes only when the compiler emits those update
shapes. Reverse and sort share the optional reorder capability; the direct and isolated core still
omit that optional code. Over the target-capable keyed fixture, position pays 1,049 B
gzip, batch-position pays 1,216 B, exact-window pays 2,837 B, reverse pays 875 B, sort pays 895 B,
slice pays 1,129 B, and rolling-window pays 1,979 B. The exact-window figure includes fresh-key
replacement, atomic same-key binding refresh, fixed- and variable-length window-local keyed reuse
with LIS movement, queued same-key window composition, disjoint queued fresh-key replacement, and
queued disjoint variable-length local-key reuse.
Unrelated bundles reject the optional position and reorder runtime markers, and the direct fixture
rejects every structural runtime marker. The checked machine-readable result is
[`RUNTIME_SIZE_RESULTS.json`](./RUNTIME_SIZE_RESULTS.json).

## Target-free reverse and sort hints

The same target-runtime comparison also builds `keyed-reorder.tsx` and `keyed-sort.tsx` against
controls selecting the existing target-capable reorder runtime. With Node 24.21.0, React 19.2.8,
and Vite 8.3.4 on macOS arm64:

| Fixture | Control raw / gzip / Brotli | Plain reorder raw / gzip / Brotli | Gzip saved |
| ------- | --------------------------: | --------------------------------: | ---------: |
| Reverse | 239,220 / 73,936 / 63,613 B |       233,098 / 72,503 / 62,270 B |    1,433 B |
| Sort    | 239,315 / 73,971 / 63,684 B |       233,193 / 72,546 / 62,381 B |    1,425 B |

`pnpm --filter @farm.js/react test:runtime-size` reproduces the comparison, requires at least
512 B gzip savings per fixture plus a Brotli reduction, and checks that unused Set/Map target
helpers are absent. Map and append hints and complete reconciliation remain available; target
bindings in any sibling keyed plan retain the broader runtime. The old feature export remains
available to previously compiled modules. These are payload measurements, not CPU timing or
benchmark-rank gains. The upstream benchmark entry's compiled output and production bundle were
byte-identical before and after this specialization in the same environment.

## Identity selection with filter hints

`test:runtime-size` also compares `keyed-identity-filter.tsx` with an otherwise identical build
that selects the existing combined-target filter runtime. With Node 24.21.0, React 19.2.8, and
Vite 5.4.20 on macOS arm64, the control is 239,427 B raw / 73,565 B gzip and the specialized build
is 234,393 B raw / 72,501 B gzip: **1,064 B gzip saved**. The gate requires at least 512 B savings
and verifies both builds retain their intended filter capability. This is a bundle-size comparison,
not a browser operation or first-paint timing result. Mixed targets and structural row extensions
continue to use their existing capabilities.

## Empty keyed cleanup registries

Keyed-row cleanup skips building an active-key Set when its event-handler or conditional-listener
registry is empty. For 10,000 active keys with both registries empty, this removes two Set
allocations and 20,000 key insertions per cleanup pair. Populated registries retain their existing
pruning behavior, including removal of stale entries and preservation of live callback identity.
The allocation regression covers 0, 1,000, and 10,000 keys and re-registration after cleanup:
`pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-keyed-cleanup.test.ts`.
These are allocation counts, not a browser-latency claim. With the
[upstream benchmark application pinned at `bf894b6`](https://github.com/krausest/js-framework-benchmark/blob/bf894b681fb56433ccb6efb4a3c93e35eda2b20d/frameworks/keyed/farm-react/src/main.tsx),
React 19.2.0, and Vite 5.4.21, the two guards add 83 raw bytes and 14 gzip bytes. Both production
builds pass the same create, select, update, swap, append, remove, clear, and row-identity controls
in Chromium 151; no browser timing improvement is claimed.

## Owned filtered-row Maps

Filter and slice fast paths commit their freshly prepared row Map directly instead of copying it
a second time. Removing one row from 10,000 eliminates one Map allocation and 9,999 copied entries;
the survivor Map, validation, DOM updates, event indexing, and cleanup remain unchanged. This is an
allocation reduction, not a browser-latency claim.

The regression covers removal, keep-all filters, queued removals, slices, empty results, and
independent mounted lists across clear/reset cycles in both complete and identity-filter runtimes:
`pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-keyed-array-filter-hints.test.tsx`.

With the pinned upstream application, React 19.2.0, and Vite 5.4.21 described above, this change
reduces raw JS from 238,454 to 238,445 bytes. Gzip stays at 73,691 bytes; Brotli changes from 62,992
to 63,076 bytes (+84 bytes). Both builds pass the same production-browser correctness controls;
these payload measurements do not establish a browser-timing improvement.

## Owned position and prepend Maps

Position, batch-insert, exact-window, and prepend fast paths commit their runtime-owned row Maps
without cloning them. Binding-only position/window updates retain the original Map and still skip
the element-index rebuild. Validation, fallback eligibility, DOM updates, event indexing, and
cleanup are unchanged; there is no public API or compiler-selection change.

The deterministic allocation regression is reproducible with:

```bash
pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-keyed-owned-maps.test.tsx
```

It counts only Map-to-Map row-instance copies during updates and checks order, text, retained DOM
identity, and event indexes. With 1,000 initial rows, a single insert/prepend previously copied
1,001 entries, removal copied 999, and fresh-key replacement copied 1,000; all now copy zero.
Preparing the result Map is still required. Against baseline `10daf746`, 21 of the 26 tests fail
on the copy assertion; all 26 pass with this change. Same-key controls already avoided copies.
Coverage includes complete/specialized runtimes, queued windows, empty results, structural/mapped
prepends, and independent lists through repeated clear/refill cycles. Non-delegated events exercise
the existing React-owned fallback, not the optimized path.

On macOS 26.2 arm64 / Node 24.21.0, the pinned upstream application described above
(React 19.2.0 / Vite 5.4.21) changes from 236,081 to 236,063 B raw, 73,081 to 73,077 B gzip,
and 62,498 to 62,513 B Brotli: **-18 B raw, -4 B gzip, +15 B Brotli**. Source, compiler,
dependencies, minification, and compression are held fixed; only the baseline/current built
runtime differs. Direct-binding and isolated-core controls remain unchanged; runtime-size gates pass.

Both production builds pass the same 12 upstream browser controls in Chrome 154.0.8037.99.
That application does not emit position/prepend hints, so these controls establish compatibility,
not an operation speedup. The maintained `keyed-position`, `keyed-batch-position`,
`keyed-window-position`, `keyed-prepend`, `keyed-structural-prepend`, and
`keyed-structural-prepend-map` runtime-size fixtures were also compiled to production bundles
(React 19.2.8 / Vite 5.4.21). Real button clicks pass exact text/order and retained-DOM-identity
checks on both builds, with no page/console errors. These are allocation, payload, and correctness
results, not browser CPU, first-paint, or framework-ranking claims.

## Filter-only identity runtime

Plain identity-targeted rows with compiler-emitted filter/slice hints, but no map or append hints,
now select a separate filter-only runtime. It omits the unused map/append fast paths while keeping
the same validated removal path and full keyed reconciliation for other updates. Capability
selection considers every keyed list in the component; mixed updates, mixed target kinds, host
blocks, and conditional rows retain their existing runtimes. The previous identity/filter export
is unchanged for previously generated code. No compiler option or public app API changes.

`pnpm --filter @farm.js/react test:runtime-size` compares the same `keyed-identity-filter.tsx`
fixture against both the legacy identity/filter runtime and the combined-target filter runtime.
With Node 24.21.0, React 19.2.8, and Vite 5.4.20 on macOS arm64:

| Runtime                        |       Raw |     Gzip |
| ------------------------------ | --------: | -------: |
| Legacy identity/filter         | 234,467 B | 72,515 B |
| Filter-only identity           | 232,103 B | 71,927 B |
| Combined-target filter control | 239,501 B | 73,577 B |

The new runtime saves **588 B gzip** against the legacy identity/filter control. A separate gate
requires at least 512 B of incremental savings; the existing combined-target gate remains active.
The direct-binding and isolated-core runtime-size controls are unchanged.

In the pinned upstream application described above (React 19.2.0 / Vite 5.4.21), selecting the
legacy export as the before control yields 238,445 B raw / 73,691 B gzip / 63,076 B Brotli. The new
compiler-selected export yields 236,081 B raw / 73,081 B gzip / 62,498 B Brotli: **610 B gzip saved**.
Both production builds pass the same 12 browser controls in Chromium 151.0.7922.34: create/select,
update every tenth label, swap, append, remove, clear/recreate, and 10,000-row operations, including
surviving DOM identity and selection after removal. There are no page or console errors. These
are payload and correctness results, not browser CPU, first-paint, or framework-ranking results.

Regression coverage includes hybrid/static compiler selection, same-list and sibling-list mixed
hints, queued map/filter and append/filter updates, legacy exports, HMR capability changes,
hydration, Strict Mode, randomized removals, and unexpected map/append updates followed by removals.

## Target-free append-only runtime

Plain keyed rows whose only accepted update hints are appends now omit the unused map-update and
keyed-target fast paths. All keyed plans in the component participate in selection. Mixed hints,
targeted bindings, host blocks, and conditional rows retain their existing runtime; opaque updates
and rejected append hints retain complete reconciliation. The legacy hinted export is unchanged.

`pnpm --filter @farm.js/react test:runtime-size` builds the same `keyed-append.tsx` fixture twice,
substituting the legacy hinted export only for the control. With Node 24.21.0, React 19.2.8, and
Vite 5.4.20 on macOS arm64, the legacy control is **239,210 B raw / 73,526 B gzip** and the
append-only runtime is **231,660 B raw / 71,661 B gzip**: **1,865 B gzip saved**. Compiler-off output
is unchanged at 60,145 B gzip, so compiler-added gzip overhead falls from 13,381 B to 11,516 B
(13.9%). The paired gate requires at least 1 KiB gzip savings and rejects retained Set-membership
and Map-lookup guards. Every other runtime-size fixture has unchanged raw, gzip, and Brotli counts
against commit `9d43ca34607cdedba839005d09a867de84e1d92c`.

These are production payload measurements, not browser CPU, first-paint, or framework-ranking
claims. No compiler option, public app API, or release version changes.

The production-browser row-event-index diagnostic also passes against that commit with 10,000
rows, 35 alternating pairs, five warm-ups, and Chrome 155.0.8059.40. Both append modes preserve DOM
identity, focus, and delegated clicks; the no-event append median remains 0.30 ms. The existing
mixed-operation dashboard produces byte-identical JavaScript (70,829 B gzip) and passes create,
update, select, swap, append, remove, and clear controls on both builds and uncompiled React.
Shared-host load makes the timing results diagnostic only.

## Committed row membership during cleanup

Keyed-row cleanup now checks the already-committed row Map directly. It no longer snapshots all
live keys after filter, position, structural reorder, or rolling-window updates, or constructs a
temporary Set for each populated event-handler/conditional-listener registry. Adoption and full
reconciliation use the same committed Map. Empty registries still return immediately, removed
callbacks are pruned, and retained callback identity and unsubscribe ownership are unchanged.

Removing one of 10,000 rows avoids a 9,999-key cleanup array, even when both registries are empty.
With 10,000 live keys and both registries populated, a cleanup pair also avoids two Sets and
20,000 key insertions. These are deterministic allocation reductions, not operation-time claims.
The two focused regression files cover all six cleanup call sites, empty/populated registries,
1,000/10,000-key membership, callback identity, independent lists, failed adoption, and stale
unsubscribe after re-registration:

```bash
pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-keyed-cleanup.test.ts src/__tests__/compiler-runtime-keyed-cleanup-commits.test.ts
```

Against merged commit `10daf746`, using the pinned upstream application and identical React
19.2.0 / Vite 5.4.21 build settings described above, the actual source change measures:

| Build  |       Raw |     Gzip |   Brotli |
| ------ | --------: | -------: | -------: |
| Before | 236,081 B | 73,081 B | 62,498 B |
| After  | 235,879 B | 73,028 B | 62,487 B |
| Saved  |     202 B |     53 B |     11 B |

Both builds pass the same 12 production-browser controls in Chrome 154.0.8037.99 on macOS arm64
with Node 24.21.0, including 10,000-row removal, DOM identity, and selection after removal; neither
logs page/console errors. The runtime-size and target-specialization gates pass, with direct-binding
and isolated-core controls unchanged. No public API, eligibility rules, native method evaluation,
React fallback, other renderer, or compiler-disabled path changes. Browser CPU, first paint, and
framework-ranking improvements have not been measured.

## Plain prepend key validation

The plain prepend fast path now checks each incoming key against the committed row Map and a Set
of incoming keys only. It no longer copies every committed key into a temporary Set before
validation. Prepending one row to 10,000 avoids a 10,000-key copy; the remaining Set holds only the
prefix. The committed Map is read, not mutated, during validation. Retained-row validation,
preparation before DOM mutation, and complete fallback are unchanged. Structural and mapped
structural prepend still reject any committed key, including removed rows, and keep their existing
validation.

The regression counts `keys()` calls on the committed Map while a hinted prepend runs on 256 and
2,048 rows. It covers the complete runtime and the compiler-selected `prepend-hinted` and
`filter-prepend-hinted` runtimes. It fails on the previous implementation (`expected 1 to be +0`)
and passes with this change. The same file covers reused committed keys, duplicate keys within one
prefix and across queued prefixes, empty prefixes, and late key, descriptor, and binding failures.
Each of those cases takes the complete fallback with an unchanged DOM at the point of failure and
retained row identity:

```bash
pnpm --filter @farm.js/react exec vitest run src/__tests__/compiler-runtime-keyed-array-prepend-hints.test.tsx
```

The `test:runtime-size` fixtures were built before (`b405c215`) and after the source change with Node
24.21.0, React 19.2.8, and Vite 5.4.20 on macOS 26.2 arm64. The raw size of every fixture is
unchanged; the minified code differs, so compressed sizes move by a few bytes:

| `keyed-prepend.tsx`, compiler on |       Raw |     Gzip |   Brotli |
| -------------------------------- | --------: | -------: | -------: |
| Before                           | 238,108 B | 73,112 B | 62,575 B |
| After                            | 238,108 B | 73,111 B | 62,529 B |

The structural-prepend fixtures also keep identical raw sizes, with gzip within 2 B and Brotli
within 73 B. The runtime-size gate passes without a baseline update. These are deterministic
allocation counts, not browser CPU, first-paint, or framework-ranking results. The pinned upstream
application was not rebuilt for this change because it does not retain prepend hints.

## Target-free removal-only runtime

Plain keyed rows whose only accepted update hints are `filter()` and/or `slice()` now select
`keyedRowsFilterOnlyRuntimeFeature`. This reuses the existing target-free core and filter-only
update primitive; it does not change the removal algorithm. Selection considers every keyed plan
in the component. Mixed hints, targeted bindings, conditional rows, and host blocks retain their
existing capabilities; opaque updates and rejected hints still use complete reconciliation.

Measured against main `ac736ba99a8020e01ecb686d5ff42e3d1b4652e0` on 2026-10-13 with Node 24.21.0,
React/React DOM 19.2.8, Vite 5.4.20, esbuild 0.21.5, Babel 7.28.4, macOS 26.2 arm64 / Apple M1.
The maintained production fixtures use identical dependencies, compiler settings, Vite/esbuild
minification, gzip level 9, and Node's default Brotli compression on both sides:

| Fixture | Build  |       Raw |     Gzip |   Brotli |
| ------- | ------ | --------: | -------: | -------: |
| Filter  | Before | 241,593 B | 74,307 B | 63,565 B |
| Filter  | After  | 232,957 B | 72,190 B | 61,731 B |
| Filter  | Saved  |   8,636 B |  2,117 B |  1,834 B |
| Slice   | Before | 241,645 B | 74,325 B | 63,582 B |
| Slice   | After  | 233,009 B | 72,210 B | 61,728 B |
| Slice   | Saved  |   8,636 B |  2,115 B |  1,854 B |

The compiler gzip premium falls from 14,164 B to 12,047 B for filter and from 14,193 B to
12,078 B for slice (about 14.9%). All other 18 maintained fixture results and every compiler-off
measurement are unchanged in raw/gzip/Brotli size. The existing persisted budgets pass without
rewriting their baseline. A new paired gate builds each removal fixture twice with the same
compiler, substituting the legacy broad filter export only for the control; it requires at least
1 KiB gzip savings, a Brotli reduction, and removal of unused Set/Map target guards.

Reproduce the size gates and browser controls after building the package:

```bash
pnpm --filter @farm.js/react test:runtime-size
node packages/farm-react/scripts/test-removal-browser.mjs
node packages/farm-react/scripts/benchmark-row-event-index.mjs --baseline-ref ac736ba99a8020e01ecb686d5ff42e3d1b4652e0 --operations filter,slice
node packages/farm-react/scripts/benchmark-row-event-index.mjs --baseline-ref ac736ba99a8020e01ecb686d5ff42e3d1b4652e0 --operations filter,slice --reactivity static
```

The browser scripts accept `--executable-path` for an installed Chrome; otherwise they use
Playwright Chromium. Development checks exercise both scheduling modes against uncompiled React.
The production diagnostic uses 10,000 rows, ordinary/delegated row-event variants, uncompiled
React correctness controls, five warm-ups and 35 alternating baseline/candidate samples. It checks
all row content and retained DOM identities, button focus, and event dispatch. Its timing metric
is programmatic click to mutation observer, excluding layout, paint, and startup. Bundle savings
are not evidence of faster browser operations, first paint, or a cross-framework ranking.

Chrome 155.0.8059.40 passed all development and production correctness controls in both modes.
Production timings below retain both the original 35-sample run and a 70-sample repeat (add
`--samples 70` to the commands above). Values are milliseconds, median and interpolated
interquartile range. Each run uses five warm-ups per variant and alternates baseline/candidate:

| Mode   | Operation | Delegated events | First median, before → after | Repeat before, median [IQR] | Repeat after, median [IQR] |
| ------ | --------- | ---------------- | ---------------------------: | --------------------------: | -------------------------: |
| Hybrid | Filter    | No               |                  2.40 → 2.30 |            4.10 [2.90–5.00] |           3.95 [2.93–5.37] |
| Hybrid | Filter    | Yes              |                  2.60 → 2.40 |            3.20 [2.50–4.67] |           2.65 [2.20–3.30] |
| Hybrid | Slice     | No               |                  1.40 → 1.70 |            2.05 [1.80–3.48] |           2.10 [1.50–3.10] |
| Hybrid | Slice     | Yes              |                  1.30 → 1.50 |            1.80 [1.50–2.20] |           1.75 [1.43–2.57] |
| Static | Filter    | No               |                  2.40 → 2.00 |            3.05 [2.22–4.05] |           3.30 [2.40–4.38] |
| Static | Filter    | Yes              |                  2.30 → 2.50 |            4.00 [3.30–4.95] |           3.45 [2.60–5.10] |
| Static | Slice     | No               |                  1.60 → 1.40 |            2.15 [1.60–3.48] |           2.30 [1.60–3.17] |
| Static | Slice     | Yes              |                  1.50 → 1.60 |            2.30 [1.90–3.65] |           1.95 [1.50–2.90] |

This shared host was heavily loaded: recorded start/end one-minute load averages span 18.6–29.1.
Small regressions in the first slice run did not reproduce consistently; distributions overlap
and several deltas change direction. These are noisy diagnostics, not evidence establishing a
CPU improvement or ruling out small regressions. The confirmed improvement is payload size.
The first static run emitted complete results but stalled during browser teardown and was stopped.
The diagnostic now explicitly closes its owned page/context before the browser; the repeat exited
normally. No framework timeout, fallback, or test assertion was relaxed.

The mixed-operation `benchmarks/react-optimizer` dashboard remains byte-identical to the same
baseline (232,382 B raw / 70,941 B gzip). Both builds and uncompiled React pass its create, update,
select, swap, append, remove, and clear correctness controls with no page errors. Reusing the
maintained runner's correctness and trial functions, five alternating paired trials with five
warm-up cycles and 20 measured cycles per trial produce before/after median milliseconds of:
create 3.70/3.70, update 0.50/0.50, select 0.20/0.20, swap 0.70/0.70, append 0.80/0.70,
remove 0.90/0.90, clear 2.30/2.20. Recorded one-minute load averages are 28.62 before and 27.47
after. Since the JavaScript is identical, these small timing differences are diagnostic noise,
not a benefit attributed to this specialization. No existing framework benchmark headline changes.

## Target-free prepend-only runtime

Plain target-free keyed lists whose accepted hints require only prepend now select
`keyedRowsPrependOnlyRuntimeFeature`. The compiler aggregates requirements across all sibling
lists. Map/append/filter/structural hints, target bindings, conditionals, and host blocks keep
their existing features. The new export uses the existing core wrapper and prepend validator;
it removes unused target and map/append capabilities without changing the prepend algorithm,
event-index maintenance, or complete reconciliation fallback. Legacy exports remain intact.

Measured against main `00dfae77ed7fe32ae66637dbc3b8f7b654f915b2` with Node 24.21.0,
React/React DOM 19.2.8, Vite 5.4.20, esbuild 0.21.5, Babel 7.28.4, macOS 26.2 arm64 / Apple M1.
Both builds use the maintained `keyed-prepend.tsx` fixture, identical dependencies and compiler
settings, Vite/esbuild production minification, gzip level 9, and Node's default Brotli:

| Prepend fixture |       Raw |     Gzip |   Brotli |
| --------------- | --------: | -------: | -------: |
| Before          | 241,888 B | 74,280 B | 63,605 B |
| After           | 233,262 B | 72,267 B | 61,814 B |
| Saved           |   8,626 B |  2,013 B |  1,791 B |

The compiler gzip premium drops from 14,134 B to 12,121 B (14.2%); total fixture gzip falls
2.7%. All other maintained fixture results and every compiler-disabled result remain unchanged
in raw/gzip/Brotli. Persisted budgets are not rewritten. The paired gate substitutes the legacy
prepend feature only for the control, requires at least 1 KiB gzip savings and a Brotli reduction,
and rejects retained Set/Map target guards.

The component-wide selector regression fails in four positive cases on the baseline and passes
with the specialization. Static/hybrid runtime coverage includes duplicate and numeric/string
equivalent keys, empty/queued prefixes, atomic key/descriptor/binding failures, sparse/subclassed
arrays, custom iterators, and a proxy that rejects metadata inspection after adoption. Opaque
and hand-authored mixed updates still reconcile. Lifecycle checks cover focus/selection, ordinary
and delegated events/indexes, disposal, hydration, Strict Mode, and Fast Refresh. Packaged React
18.3.1 and 19.2.8 checks exercise the new ESM feature and its CJS export.

Reproduce after building the package:

```bash
pnpm --filter @farm.js/react test:runtime-size
node packages/farm-react/scripts/test-removal-browser.mjs --operations prepend
node packages/farm-react/scripts/benchmark-row-event-index.mjs --baseline-ref 00dfae77ed7fe32ae66637dbc3b8f7b654f915b2 --operations append,prepend
node packages/farm-react/scripts/benchmark-row-event-index.mjs --baseline-ref 00dfae77ed7fe32ae66637dbc3b8f7b654f915b2 --operations append,prepend --reactivity static
```

Browser commands accept `--executable-path` for installed Chrome. The development check uses
both scheduling modes and an uncompiled React control, checking content, retained DOM identity,
focus, delegated events, and disposal. The production diagnostic uses 10,000 rows, five warm-ups,
35 alternating paired samples, ordinary/delegated event variants, and React correctness controls.
It measures programmatic click to mutation observer, not layout, paint, startup, or an official
cross-framework benchmark. Payload savings alone do not establish faster browser operations.

Chrome 155.0.8059.40 passed all production correctness controls with no page/console errors.
Before/after median and interquartile milliseconds from the paired runs:

| Mode   | Operation      | Delegated events | Before median [Q1–Q3] | After median [Q1–Q3] |
| ------ | -------------- | ---------------- | --------------------: | -------------------: |
| Hybrid | Append control | No               |      0.30 [0.30–0.40] |     0.30 [0.30–0.40] |
| Hybrid | Append control | Yes              |      0.30 [0.30–0.40] |     0.30 [0.30–0.40] |
| Hybrid | Prepend        | No               |      1.80 [1.60–1.90] |     1.70 [1.50–1.80] |
| Hybrid | Prepend        | Yes              |      2.40 [2.30–2.60] |     2.50 [2.40–2.70] |
| Static | Append control | No               |      0.30 [0.20–0.30] |     0.30 [0.30–0.30] |
| Static | Append control | Yes              |      0.40 [0.30–0.40] |     0.40 [0.30–0.40] |
| Static | Prepend        | No               |      2.20 [1.80–2.50] |     2.10 [1.80–2.30] |
| Static | Prepend        | Yes              |      3.10 [2.50–3.40] |     2.80 [2.40–3.40] |

The shared host was heavily loaded: recorded one-minute load averages span 6.89–75.34. The
distributions overlap and small deltas differ by event/mode; these data neither establish a CPU
improvement nor rule out small regressions. The confirmed improvement is payload. The hybrid run
emitted its full results but stalled during cleanup after Chrome had exited; its owned diagnostic
process was stopped. The static run completed and exited normally. No framework timeout or
correctness assertion was relaxed.

The maintained `benchmarks/react-optimizer` mixed dashboard remains byte-identical before/after:
233,473 B raw / 71,327 B gzip / 61,796 B Brotli. Build its `src/main.tsx` with the same current
compiler and Vite/esbuild automatic JSX settings, alias `virtual:bench-component` to `src/bench.tsx`,
and alias the runtime to baseline/current source for the pair. Both builds and uncompiled React
pass the maintained runner's correctness functions (including input focus/selection and identity)
for create, update, select, swap, append, remove, and clear, with no page errors. Five alternating
paired trials using its `runTrial` function, five warm-up cycles, and 20 measured cycles per trial
give median milliseconds before/after: create 3.70/3.80, update 0.50/0.50, select 0.20/0.20,
swap 0.40/0.50, append 0.80/0.80, remove 0.90/1.00, clear 2.30/2.40. Start/end one-minute loads
were 28.13/35.91. Since the emitted JavaScript is identical, these timing differences are noise,
not a change attributable to prepend specialization. Existing cross-framework headlines are unchanged.

## Existing production benchmark audit

The existing js-framework-benchmark application was also rebuilt before and after runtime
specialization with the same workspace, source, Vite configuration, and compression command:

| Build                                   |       Raw |     Gzip |   Brotli |
| --------------------------------------- | --------: | -------: | -------: |
| Compiler off                            | 196,335 B | 61,194 B | 52,750 B |
| Compiler on, previous full runtime      | 274,635 B | 79,297 B | 65,547 B |
| Compiler on, selected keyed-row runtime | 236,899 B | 73,112 B | 60,499 B |

Runtime selection removes **37,736 raw bytes, 6,185 gzip bytes, and 5,048 Brotli bytes** from the
compiler-on build. The measured gzip premium over compiler-off falls from 18,103 B to 11,918 B,
which is a **34.2% reduction** for this feature-heavy keyed application. These build-size numbers
are separate from the official browser CPU result; the official harness must still be rerun before
changing its checked headline.

The regression gate allows only small compression variance and fails if the direct or keyed
premium grows materially, if core runtime reduction falls by more than one percentage point, or if
an unused capability marker returns.
