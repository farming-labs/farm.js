# Meta-framework benchmark

This suite compares Farm.js, Next.js, SvelteKit, and Nuxt as complete server-rendered framework
stacks. It does not treat their underlying build tools as interchangeable.

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

All durations use Node's external monotonic clock. One unmeasured burn-in pass over every selected
framework is discarded before collection, and framework order is deterministically randomized in
each measured round. Raw JSON retains every timing sample.

## Cache and server policy

Generated framework caches are removed before every dev and build sample. Dependency installation
and the local Farm package build are outside timed samples. The operating-system filesystem cache is
left warm; this is not a reboot-level cold-cache benchmark. Next.js and Nuxt telemetry are disabled.
Ambient `NODE_ENV`, `NODE_OPTIONS`, and `BABEL_ENV` values are removed, while `CI=1` and `TZ=UTC`
are applied consistently.

Production boot and response measurements use the normal framework server path:

| Framework | Production command                         |
| --------- | ------------------------------------------ |
| Farm.js   | Generated `.farm/.output/server/index.mjs` |
| Next.js   | `next start`                               |
| SvelteKit | Adapter-generated `build/index.js`         |
| Nuxt      | Generated `.output/server/index.mjs`       |

## Reproduce

Use a single even-numbered LTS Node release for the entire comparison. The full four-framework suite
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

To reproduce and publish the canonical report and landing-page data:

```sh
node benchmarks/frameworks/run.mjs --runs 7 --requests 30 --warmups 5 --publish
```

`--publish` requires all four frameworks, at least seven measured rounds, 30 measured requests, five
warmups, the discarded burn-in, and a fresh untimed build of the local Farm packages. It writes:

- `results/latest.json` — metadata, per-round data, and every raw sample.
- `results/latest.md` — the concise human-readable report.
- `../../docs/src/lib/benchmark-results.generated.ts` — compact landing-page data.

Before and after a run, the runner fingerprints benchmark inputs, the root lockfile, Git revision,
and local Farm source state. It aborts if those inputs change mid-run. Publishing requires clean Farm
sources and a clean root lockfile; the report records the benchmark SHA-256 and whether the wider
workspace was dirty. An exclusive PID lock prevents simultaneous suite runs. Publishing is also
rejected when a measured round shows correlated contention: at least three frameworks with build
times above 1.5× their own measured median.

## Limitations

This small dynamic-SSR fixture measures local framework baseline overhead on one machine. It does
not measure browser parsing, hydration, HMR updates, network or TLS latency, CDN behavior, hosted
cold starts, or production-application performance. Full-body response timings also reflect each
framework's emitted HTML size. Hardware, background load, OS cache state, project shape, framework
versions, rendering strategy, and deployment runtime can change the result. Compare exact metrics
and raw distributions rather than treating them as a universal framework ranking.
