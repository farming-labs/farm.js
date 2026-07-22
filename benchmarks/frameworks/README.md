# Meta-framework benchmark

This suite compares Farm.js, Next.js, SvelteKit, Nuxt, and TanStack Start as complete
server-rendered framework stacks. It does not treat their underlying build tools as interchangeable.

## Fixture and validation

Each pinned fixture serves one dynamic SSR route with the same CSS and 120-item DOM workload. Every
timed response must return HTTP 200, `framework-benchmark-v1`, an item count of 120, and a numeric
server-render timestamp. The runner also requests the exact same URL again and requires a different
timestamp before measuring it, which prevents an accidentally static or per-URL cached fixture from
being accepted.

The fixtures live in an isolated pnpm workspace under this directory. Farm.js links to the local
`packages/farm` and `packages/farm-cli`; the other framework versions are pinned in the benchmark
lockfile. The runner builds those local Farm packages before timing unless `--skip-prepare` is used.
It verifies the installed package versions against every label in the report before starting.

## Metrics

- **First dev page:** process spawn to the first validated, fully read HTTP response. This includes
  startup and lazy compilation instead of relying on framework-specific ready messages.
- **Warm dev response:** sequential validated loopback responses after warm-up requests.
- **Clean build:** build-process wall time after the fixture's generated framework caches are
  removed. This is a complete fixture-project production build; the local Farm framework-package
  build happens beforehand and is excluded from the timed sample.
- **Production boot:** production-process spawn to the first validated, fully read response.
- **Production response:** sequential full-body loopback requests after warmups, reported as p50 and
  p95. Each request uses a fresh connection.
- **HTML:** bytes in the production response body, reported because response size affects full-body
  latency.

All durations use Node's external monotonic clock. Readiness is checked every 2 ms so single-digit
production-boot differences are not hidden by the polling interval. One unmeasured burn-in pass over
every selected framework is discarded before collection. Measured orders use a seeded,
position-balanced cyclic schedule: every complete block gives each framework every ordinal position
exactly once, and partial blocks differ by at most one appearance per position. Raw JSON retains every
timing sample.

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

An ordinary run prints a report but does **not** replace the checked-in results:

```sh
node benchmarks/frameworks/run.mjs --runs 1 --requests 3 --warmups 1
```

Validate scheduling, readiness precision, numeric options, environment sanitization, and publish
guards without starting framework servers:

```sh
corepack pnpm --dir benchmarks/frameworks self-check
```

To reproduce and publish the canonical report and landing-page data:

```sh
node benchmarks/frameworks/run.mjs --runs 7 --requests 30 --warmups 5 --publish
```

`--publish` requires all five frameworks, at least seven measured rounds, 30 measured requests, five
warmups, the discarded burn-in, and a fresh untimed build of the local Farm packages. It writes:

- `results/latest.json` — metadata, per-round data, and every raw sample.
- `results/latest.md` — the concise human-readable report.
- `../../docs/src/lib/benchmark-results.generated.ts` — compact landing-page data.

Before and after a run, the runner fingerprints benchmark inputs, the root lockfile, Git revision,
and local Farm source state. It aborts if those inputs change mid-run. Publishing requires clean
benchmark harness and fixture inputs, clean Farm sources, and a clean root lockfile; the report
records the benchmark SHA-256 and whether the wider workspace was dirty. An exclusive PID lock
prevents simultaneous suite runs. Publishing is also rejected when a measured round shows correlated
contention: at least three frameworks with build times above 1.5× their own measured median.

## Limitations

This small dynamic-SSR fixture measures local framework baseline overhead on one machine. It does
not measure browser parsing, hydration, HMR updates, network or TLS latency, CDN behavior, hosted
cold starts, or production-application performance. Full-body response timings also reflect each
framework's emitted HTML size. Hardware, background load, OS cache state, project shape, framework
versions, rendering strategy, and deployment runtime can change the result. Compare exact metrics
and raw distributions rather than treating them as a universal framework ranking.
