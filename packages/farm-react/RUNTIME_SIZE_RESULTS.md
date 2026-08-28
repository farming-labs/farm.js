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
| Keyed rows, LIS, scalar, Set, and Map targeting   |          60,179 B |         71,259 B |         11,080 B |
| Keyed rows with append hints                      |          60,085 B |         71,576 B |         11,491 B |
| Keyed rows with prepend hints                     |          60,087 B |         71,984 B |         11,897 B |
| Keyed rows with filter hints                      |          60,088 B |         72,021 B |         11,933 B |

The isolated compatibility runtime contributes 17,642 B gzip over the React control. The
compiler-selected core contributes 3,766 B, a **78.7% reduction**. This comparison uses the same
hand-authored compiled definition and changes only the runtime entry used to create it.

The keyed fixture retains `FarmCompiledKeyedRows` plus compiler-emitted `identityTarget`,
`membershipTarget`, and `mapLookupTarget` metadata, plus Set/Map producer-delta helpers. It rejects
the optional row-conditional and keyed-update runtimes. Separate append, prepend, and filter
fixtures prove that recognized functional updates retain only the matching hinted runtime. The
direct compiler premium and isolated core runtime remain byte-for-byte unchanged. The new prepend
fixture pays an 817 B gzip premium over the ordinary keyed fixture while keeping prepend code out
of direct, ordinary keyed, append-only, and filter-only bundles. The direct fixture rejects every
structural runtime marker. The checked
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
