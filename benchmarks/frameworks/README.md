# Meta-framework benchmark

This suite compares Farm.js, Next.js, SvelteKit, Nuxt, and TanStack Start as complete
server-rendered framework stacks. It does not treat their underlying build tools as interchangeable.

## Fixture and validation

Each pinned fixture serves one dynamic SSR route with the same CSS and 120-item DOM workload. Every
timed response must return HTTP 200 and exactly one real `<main>` with the benchmark marker and item
count. The HTML parser validates all 120 ordered `<li>` rows, identifiers, and labels inside that
fixture; marker strings or rows in scripts, comments, and inert templates do not count. The numeric
server-render timestamp comes from that same element, not embedded serialized data. Framework
comments, whitespace, extra attributes, and HTML entities are supported.

Full-body response and first-page clocks stop before HTML parsing/validation. Every readiness,
warm-up, and measured response must also have a render timestamp within that request's local
wall-clock window, from immediately before the request until its full body has been read. This
rejects stale responses even when caching begins after startup or partway through measurement, and
rejects future timestamps or backwards request windows. The wall-clock snapshots and validation
stay outside the monotonic response timer; no extra measured requests, sleeps, or cache-busting URLs
are added. The separate startup check still requests the exact same URL again and requires a
different timestamp before measurement.

These controls require the fixture servers and runner to share one host and a stable wall clock.
Timestamps have millisecond resolution: fresh renders may legitimately share a timestamp, and reuse
within the same millisecond cannot be distinguished. Timestamp validation is a cache guard, not
proof of unique execution for every response. Timing metrics still use the monotonic clock.

The fixtures live in an isolated pnpm workspace under this directory. Farm.js links to the local
`packages/farm` and `packages/farm-cli`; the other framework versions are pinned in the benchmark
lockfile. The runner builds those local Farm packages before timing unless `--skip-prepare` is used.
It verifies the installed package versions against every label in the report before starting.

## Metrics

- **First dev page:** process spawn to the first validated, fully read HTTP response. This includes
  startup and lazy compilation instead of relying on framework-specific ready messages.
- **Warm dev response:** sequential validated loopback responses after 30 equal warm-up requests.
  This reduces early runtime JIT effects; cold compilation remains visible in the separate
  first-dev-page metric.
- **Clean build:** build-process wall time after the fixture's generated framework caches are
  removed. This is a complete fixture-project production build; the local Farm framework-package
  build happens beforehand and is excluded from the timed sample.
- **Production boot:** production-process spawn to the first validated, fully read response.
- **Production response:** sequential full-body loopback requests after warmups, reported as p50 and
  p95. Each request uses a fresh connection.
- **Decoded HTML:** production body bytes after content decoding. `responseBytes` remains a
  compatibility alias for `decodedResponseBodyBytes`.
- **Encoded body:** production HTTP body bytes before decompression, counted from the received
  chunks, not inferred from `Content-Length`. This excludes HTTP headers, chunk framing, TCP and TLS.
  Summary byte metrics use each round's production-readiness response; raw per-response records also
  retain byte counts and actual encoding for readiness, startup verification, warmups and measurements.

Requests explicitly send `Accept-Encoding: identity` by default. Use `--encoding gzip` or
`--encoding br` for separate compression diagnostics. A server may return identity; reports record
that fallback rather than claiming compression was used. Unrequested encodings, corrupt/truncated
bodies and response deadlines fail the run. Redirects are not followed: the fixture URL itself must
return the validated HTTP 200 workload.

Schema v2 uses Node HTTP/1.1 with a fresh connection and explicit content decoding, replacing the
previous Fetch transport's implicit encoding/decompression. Full-body latency includes decoding;
it is not isolated rendering time. **Do not compare these timings directly with schema-v1 reports.**
Rerun all compared frameworks under the same encoding and transport. Existing published results are
not rewritten by this change.

All durations use Node's external monotonic clock. Readiness is checked every 2 ms so single-digit
production-boot differences are not hidden by the polling interval. One unmeasured burn-in pass over
every selected framework is discarded before collection. Measured orders use a seeded,
position-balanced cyclic schedule: every complete block gives each framework every ordinal position
exactly once, and partial blocks differ by at most one appearance per position. Raw JSON retains every
timing sample at full precision; displayed summary statistics are rounded.

## Cache and server policy

Generated framework caches are removed before every dev and build sample. Dependency installation
and the local Farm package build are outside timed samples. The operating-system filesystem cache is
left warm; this is not a reboot-level cold-cache benchmark. Vite and Farm's normal product CLI paths
enable Node's on-disk compile cache, which is warmed by the discarded burn-in and deliberately left
enabled for measured rounds. Ambient Node compile-cache controls are removed so a caller cannot
silently disable, relocate, or preconfigure that behavior. Next.js and Nuxt telemetry are disabled.
Ambient `NODE_ENV`, `NODE_OPTIONS`, `NODE_PATH`, `BABEL_ENV`, host/port overrides, and Farm, Next,
Nitro, Nuxt, Svelte, SvelteKit, TanStack, Router, Turbo, Vite, Rolldown, Rollup, esbuild, SWC,
Rspack, Turbopack, Browserslist, and Rust build-control variables are removed, while `CI=1` and
`TZ=UTC` are applied consistently.

Farm uses its shipped dual-Vite path: Vite 5.4.20 powers development, while Vite 8.1.5 with Rolldown
powers the measured production build. Reports disclose both versions in Farm's stack label.
SvelteKit's static-asset precompression is disabled because this dynamic-HTML fixture does not
measure or request precompressed assets; no framework receives a timed asset-precompression phase.

Production boot and response measurements use the normal framework server path:

| Framework      | Production command                         |
| -------------- | ------------------------------------------ |
| Farm.js        | Generated `.farm/.output/server/index.mjs` |
| Next.js        | `next start`                               |
| SvelteKit      | Adapter-generated `build/index.js`         |
| Nuxt           | Generated `.output/server/index.mjs`       |
| TanStack Start | Generated `.output/server/index.mjs`       |

## Reproduce

Use a single even-numbered LTS Node release for the entire comparison. The full five-framework suite
requires Node 22.19+, Node 24.11+, or a newer supported even release; the published run uses Node
24.14.0. From the repository root, install the main workspace and the isolated benchmark workspace:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --dir benchmarks/frameworks install --frozen-lockfile
```

An ordinary run saves raw samples and a report in a unique, Git-ignored `results/run-*/` directory
and prints its path. It does **not** replace the checked-in results or landing-page data:

```sh
node benchmarks/frameworks/run.mjs --runs 1 --requests 3 --warmups 1
node benchmarks/frameworks/run.mjs --only farm,tanstack --encoding gzip --runs 1 --requests 3 --warmups 1
node benchmarks/frameworks/run.mjs --only farm,tanstack --encoding br --runs 1 --requests 3 --warmups 1
```

Validate rendered fixtures, scheduling, readiness precision, numeric options, environment sanitization,
and publish guards without starting framework servers (fixture tests use a temporary loopback HTTP
server):

```sh
corepack pnpm --dir benchmarks/frameworks self-check
```

### Investigating failed runs

A failed burn-in or measured round reports the framework, round, and phase (development startup
or requests, production build, or production startup or requests). Server startup/request failures
also include the URL and the captured server-output tail. Nested causes and connection-error entries
retain their codes, addresses, and ports. A final process-cleanup failure is logged separately
without hiding the original failure. Keep the command output when investigating an incomplete run:

```sh
node benchmarks/frameworks/run.mjs --only farm,tanstack > /tmp/farm-benchmark.log 2>&1
```

Failures still abort the run with a nonzero exit status; incomplete runs do not produce a scored
report or replace canonical results. Readiness retries only connection-refused errors from a server
that has not started listening. Connection resets, deadlines, invalid encodings and broken bodies
remain failures, not reasons to retry a timed request or extend its timeout. Error context is assembled
only after failure and does not change the successful request timers or validation.

### Publishing results

To reproduce and publish the canonical report and landing-page data:

```sh
node benchmarks/frameworks/run.mjs --runs 7 --requests 30 --warmups 30 --publish
```

`--publish` requires all five frameworks, at least seven measured rounds, 30 measured requests, 30
warmups, identity encoding, the discarded burn-in, and a fresh untimed build of the local Farm
packages. Compressed runs remain diagnostic-only so they cannot replace the canonical report. It writes:

- `results/latest.json` — metadata, per-round data, and every raw sample.
- `results/latest.md` — the concise human-readable report.
- `../../docs/src/lib/benchmark-results.generated.ts` — compact landing-page data.

Before and after a run, the runner fingerprints benchmark inputs, the root lockfile, Git revision,
and local Farm source state. It aborts if those inputs change mid-run. Publishing requires clean
benchmark harness and fixture inputs, clean Farm sources, and a clean root lockfile; the report
records the benchmark SHA-256 and whether the wider workspace was dirty. An exclusive PID lock
prevents simultaneous suite runs. Publishing is also rejected when a measured round shows correlated
contention: at least three frameworks with build times above 1.5× their own measured median.
The report marks this assessment **unavailable** with fewer than three selected frameworks or three
measured rounds. Otherwise, “not detected” is not proof of an idle host. Publication eligibility also
requires the full methodology and clean inputs described above; partial runs are diagnostic only.

### Generated-output ownership

The fixture generators own these exact paths, relative to this benchmark directory:

- `apps/farm/src/farm.d.ts`, the legacy `farm-routes.d.ts`, `farm-env.d.ts`, `farm-images.d.ts`
  and `farm-i18n.d.ts` in the same directory, and `apps/farm/src/lib/api.generated.ts`.
- `apps/tanstack/src/routeTree.gen.ts`.
- `apps/next/next-env.d.ts`.

They are outputs, not authored benchmark inputs: their creation, regeneration or removal does not
invalidate source identity or make a run unpublishable. Reports retain their exact before/after
SHA-256 values (or `null` for absent files) under `inputs.generatedOutputs`. A run refuses an existing
reserved path without the expected generator marker, or a non-regular file such as a symlink, before
fixture cleanup. The marker is an ownership check, not proof that a file was never manually edited.

Keep handwritten types and code outside these generator-owned paths. There is no broad exclusion
for `farm-*.d.ts`, other declarations or `*.generated.ts`: route sources, configuration, manifests,
lockfiles and the exclusion policy itself remain fingerprinted. Their mid-run changes still fail.
Generators may overwrite their owned outputs; use a disposable clean checkout if any existing
generated version needs preserving. This policy does not reset, restore, stage or commit files, and
the broader workspace-dirty flag still discloses tracked generated-output changes.

## Buffered-response diagnostic

For the focused buffered-HTML response ablation, build the local core runtime and Farm fixture,
then run the diagnostic under Node 24.11+:

```sh
pnpm --filter @farm.js/core build:runtime
pnpm --dir benchmarks/frameworks/apps/farm build
node benchmarks/frameworks/preload-response.mjs > /tmp/farm-preload-response.json
```

For an isolated-runner check, manually dispatch the CI workflow with
`preload-response-benchmark` enabled. Its opt-in diagnostic job builds the maintained fixture,
collects two independent comparisons, and retains the raw JSON artifact for review. It does not
assert timing thresholds or replace canonical results; check the recorded load and distributions
before drawing a performance conclusion.

This runs five alternating fresh-process pairs against the same built SSR entry, with 1,000 warmups
and 3,000 measured requests per process. The baseline forces the old buffered-body path; both arms
retain the no-candidate preload scanner guard. Every response is checked for equivalent HTML and
same-URL freshness. Output includes raw batch samples, CPU time, and machine load. It is an
in-process diagnostic, not network latency or a canonical cross-framework result.

## Hydration-planning diagnostic

The focused planner diagnostic measures build/development analysis, not SSR latency or the
cross-framework score. It compares disabled isolation with active analyze/enabled modes and the
async-owner exception that still creates client islands while the experiment is off:

```sh
pnpm --filter @farm.js/core build:runtime
node benchmarks/hydration-planning/run.mjs > /tmp/hydration-planning-first.json
node benchmarks/hydration-planning/run.mjs > /tmp/hydration-planning-second.json
```

Requires Node 24.11+. Five alternating fresh-process pairs per scenario use 200 warmups and 5,000
measured calls per process, with a warm filesystem cache. The baseline restores only the previous
placement of the three owner-source read/parse statements in memory. Complete plans are compared
across arms; read counts and output validation run outside timing. Results include every batch,
wall/CPU measurements, source/runner hashes, and machine load. Do not run other tests or builds
alongside measurements or interpret planner-only gains as an equivalent full-build improvement.
The diagnostic creates and removes only its own temporary fixtures; published results are untouched.

For an independent-runner check, manually dispatch the CI workflow with
`hydration-planning-benchmark` enabled. The opt-in job builds the runtime, collects two comparisons,
and uploads both raw JSON files. It does not assert timing thresholds or publish canonical results;
review the inactive gains alongside active controls and recorded machine load.

## Slot-route selector diagnostic

The [slot-route diagnostic](../slot-route-inputs/README.md) compares the generated production
selector with its unprepared baseline, including no-slot, fallback, catch-all and interception
controls. It reports lookup time, one-time preparation cost and helper size separately. The
framework fixture above has no route slots; do not interpret selector gains as improved HTTP
latency or a changed framework ranking.

## Markdown request URL diagnostic

This opt-in diagnostic compares the generated SSR entry with a baseline that restores only the
Markdown helper's unconditional URL parse and removes the caller's parsed-URL hint. It does not
change Markdown negotiation, the dynamic 120-row workload, or published benchmark scores.

```sh
pnpm --filter @farm.js/core build
pnpm --filter @farm.js/cli build
pnpm --dir benchmarks/frameworks --filter farm-framework-benchmark install --frozen-lockfile
pnpm --dir benchmarks/frameworks/apps/farm exec farm build --preset node-server
node benchmarks/frameworks/markdown-request-url.mjs > /tmp/markdown-request-url-first.json
node benchmarks/frameworks/markdown-request-url.mjs > /tmp/markdown-request-url-second.json
```

Requires Node 24.11+. Five alternating fresh-process pairs cover HTML with no Accept header,
browser HTML, negotiated Markdown, and `.md` URLs. Each process uses 1,000 warmups and 3,000
measured requests. All ordered rows, per-request freshness, normalized bodies and headers are
checked outside timing; body consumption and lifecycle completion are included. Reports retain
raw batch times, CPU time, load and source hashes. These are in-process means, not HTTP p50/p95
or a cross-framework ranking. Do not run other tests or builds alongside timing measurements.

Local results are mixed; one fewer URL parse does not by itself establish a latency benefit.
Use the CI workflow's `markdown-request-url-benchmark` input for two comparisons on an independent
runner. The diagnostic job retains raw artifacts without publishing scores or asserting timing
thresholds. Review all active controls before promoting this optimization.

## Limitations

This small dynamic-SSR fixture measures local framework baseline overhead on one machine. It does
not measure browser parsing, hydration, HMR updates, network or TLS latency, CDN behavior, hosted
cold starts, or production-application performance. Full-body response timings also reflect each
framework's emitted HTML size. Hardware, background load, OS cache state, project shape, framework
versions, rendering strategy, and deployment runtime can change the result. Compare exact metrics
and raw distributions rather than treating them as a universal framework ranking.
