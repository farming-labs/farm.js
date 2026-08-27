# Farm React compiler — js-framework-benchmark adapter

This example implements the keyed DOM contract from
[`krausest/js-framework-benchmark`](https://github.com/krausest/js-framework-benchmark) with React
19.2.0. The same component source is built with the Farm compiler disabled, static reactivity, and
hybrid reactivity. Those builds can be compared with the benchmark's official React Hooks entry.

## Prepare an official checkout

Clone and install the upstream benchmark according to its README, then run:

```bash
pnpm prepare:official /absolute/path/to/js-framework-benchmark
```

The preparation script builds all three modes, verifies the compiled markers and delegated keyed
rows, and installs self-contained production artifacts at:

- `frameworks/keyed/farm-react-off`
- `frameworks/keyed/farm-react-static`
- `frameworks/keyed/farm-react-hybrid`

Build the official `frameworks/keyed/react-hooks` entry and start the benchmark server. Validate
identity before measuring:

```bash
cd /absolute/path/to/js-framework-benchmark/webdriver-ts
npm run isKeyed -- --headless \
  --chromeBinary "/absolute/path/to/chrome" \
  --framework keyed/react-hooks keyed/farm-react-off keyed/farm-react-static keyed/farm-react-hybrid
```

Run the CPU suite with the official Playwright timeline runner:

```bash
npm run bench -- --headless --runner playwright --count 10 \
  --chromeBinary "/absolute/path/to/chrome" \
  --framework keyed/react-hooks keyed/farm-react-off keyed/farm-react-static keyed/farm-react-hybrid \
  --benchmark 01_ 02_ 03_ 04_ 05_ 06_ 07_ 08_ 09_
```

Run memory and transfer-size measurements:

```bash
npm run bench -- --headless --runner playwright --count 3 \
  --chromeBinary "/absolute/path/to/chrome" \
  --framework keyed/react-hooks keyed/farm-react-off keyed/farm-react-static keyed/farm-react-hybrid \
  --benchmark 21_ 22_ 25_ 40_
```

Copy the official JSON results into a machine-readable consolidated report:

```bash
pnpm summarize:official /absolute/path/to/js-framework-benchmark
```

The summarizer requires exactly one result file per framework and operation, rejects stale
duplicates, verifies keyed/type metadata, recomputes every median from its raw samples, validates
the documented sample counts, and reads the current official CPU weights from the checked-out
harness. For a deliberately reduced rerun, pass the actual counts explicitly, for example:

```bash
FARM_BENCHMARK_CPU_SAMPLES=3 \
FARM_BENCHMARK_MEMORY_SAMPLES=3 \
FARM_BENCHMARK_OUTPUT=/tmp/farm-benchmark-audit.json \
pnpm summarize:official /absolute/path/to/js-framework-benchmark
```

See [BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md) for the checked-in interpretation and
`BENCHMARK_RESULTS.json` for raw sample arrays and medians from the recorded run.

These are local results produced by the official harness, not an official leaderboard submission.
Browser, operating-system, runner, framework versions, harness revision, and sample counts must be
reported with comparisons. Overall CPU comparisons should use the official-weighted geometric
mean; the unweighted geometric mean may be included only as a separately labeled diagnostic.
