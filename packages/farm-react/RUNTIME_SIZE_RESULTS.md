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
| Direct text, attribute, style, and event bindings |          60,043 B |         63,721 B |          3,678 B |
| Keyed rows, LIS, scalar, Set, and Map targeting   |          60,179 B |         71,373 B |         11,194 B |
| Keyed rows with append hints                      |          60,085 B |         71,690 B |         11,605 B |
| Keyed rows with prepend hints                     |          60,087 B |         72,055 B |         11,968 B |
| Keyed rows with filter hints                      |          60,088 B |         72,258 B |         12,170 B |
| Keyed rows with slice hints                       |          60,075 B |         72,297 B |         12,222 B |
| Keyed rows with known-position hints              |          60,076 B |         72,344 B |         12,268 B |
| Keyed rows with batch-position hints              |          60,091 B |         72,534 B |         12,443 B |
| Keyed rows with exact-window hints                |          60,124 B |         74,297 B |         14,173 B |
| Keyed rows with reverse hints                     |          60,058 B |         72,115 B |         12,057 B |
| Keyed rows with sort hints                        |          60,077 B |         72,172 B |         12,095 B |
| Keyed rows with rolling-window hints              |          60,098 B |         73,038 B |         12,940 B |

The isolated compatibility runtime contributes 21,525 B gzip over the React control. The
compiler-selected core contributes 3,766 B, an **82.5% reduction**. This comparison uses the same
hand-authored compiled definition and changes only the runtime entry used to create it.

The keyed fixture retains `FarmCompiledKeyedRows` plus compiler-emitted `identityTarget`,
`membershipTarget`, and `mapLookupTarget` metadata, plus Set/Map producer-delta helpers. It rejects
the optional row-conditional and keyed-update runtimes. Separate append, prepend, and filter
fixtures prove that recognized functional updates retain only the matching hinted runtime. Slice
reuses the filter removal capability. Position-only, batch-position, exact-window, and
rolling-window modules select separate hint runtimes only when the compiler emits those update
shapes. Reverse and sort share the optional reorder capability; the direct and isolated core
results remain byte-for-byte unchanged. Over the ordinary keyed fixture, position pays 1,074 B
gzip, batch-position pays 1,249 B, exact-window pays 2,979 B, reverse pays 863 B, sort pays 901 B,
slice pays 1,028 B, and rolling-window pays 1,746 B. The exact-window figure includes fresh-key
replacement, atomic same-key binding refresh, fixed- and variable-length window-local keyed reuse
with LIS movement, queued same-key window composition, disjoint queued fresh-key replacement, and
queued disjoint variable-length local-key reuse.
Unrelated bundles reject the optional position and reorder runtime markers, and the direct fixture
rejects every structural runtime marker. The checked machine-readable result is
[`RUNTIME_SIZE_RESULTS.json`](./RUNTIME_SIZE_RESULTS.json).

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
