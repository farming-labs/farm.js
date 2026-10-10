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
