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
| Keyed rows, LIS, scalar, Set, and Map targeting   |          60,179 B |         71,304 B |         11,125 B |
| Keyed rows with append hints                      |          60,085 B |         71,622 B |         11,537 B |
| Keyed rows with prepend hints                     |          60,087 B |         72,013 B |         11,926 B |
| Keyed rows with filter hints                      |          60,088 B |         72,230 B |         12,142 B |
| Keyed rows with slice hints                       |          60,075 B |         72,271 B |         12,196 B |
| Keyed rows with rolling-window hints              |          60,098 B |         73,004 B |         12,906 B |

The isolated compatibility runtime contributes 18,199 B gzip over the React control. The
compiler-selected core contributes 3,766 B, a **79.3% reduction**. This comparison uses the same
hand-authored compiled definition and changes only the runtime entry used to create it.

The keyed fixture retains `FarmCompiledKeyedRows` plus compiler-emitted `identityTarget`,
`membershipTarget`, and `mapLookupTarget` metadata, plus Set/Map producer-delta helpers. It rejects
the optional row-conditional and keyed-update runtimes. Separate append, prepend, and filter
fixtures prove that recognized functional updates retain only the matching hinted runtime. Slice
reuses the filter removal capability. Rolling windows select a separate all-hint runtime only when
the compiler emits that update shape. The shared optional dispatch adds at most 46 B gzip to an
existing keyed fixture; the direct and isolated core results remain byte-for-byte unchanged. The
slice fixture pays a 1,071 B gzip premium and the rolling-window fixture pays a 1,781 B premium
over the ordinary keyed fixture. Unrelated bundles reject the rolling-window runtime marker, and
the direct fixture rejects every structural runtime marker. The checked
machine-readable result is [`RUNTIME_SIZE_RESULTS.json`](./RUNTIME_SIZE_RESULTS.json).

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
