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

Version labels come from the installed renderer and React packages, not a hard-coded release or
dependency range. Preparation rejects mismatched React/React DOM versions. The Vite config deduplicates
React and React DOM to the example's pinned copies, including imports from the workspace renderer.
Compiler-marker validation accepts minifier quote styles but still rejects missing compilation,
missing delegation, or the wrong reactivity mode. Run `pnpm test:harness` for these reporting guards.

The checked-in results below describe their recorded versions and environment; they are not updated
by preparing newer artifacts. Keep previous results separately when rerunning with a new version.
When testing workspace compiler changes, build `@farm.js/react` first: a package version alone does
not identify unpublished source edits or refresh its built compiler.

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
harness. Each filename must match its JSON framework identity, and all CPU, memory, and size results
within one variant must have the same full framework/version label. The report retains that label
in `results.<variant>.framework`; different variants keep their own labels. Mixed-version results
fail before replacing an existing report. These labels do not distinguish separate runs or
unpublished builds of the same version; keep those results separately as well. Run
`pnpm test:harness` for preparation and report-validation coverage.

CPU total medians, per-operation speedup ratios, and aggregate speedups must be positive and finite.
Invalid calculations fail before replacing an existing report; they are not clamped or omitted.
Individual zero total samples remain valid when their median is positive, and zero script, paint,
memory, and size metrics remain supported. Valid samples and scoring formulas are unchanged.

For a deliberately reduced rerun, pass the actual counts explicitly, for example:

```bash
FARM_BENCHMARK_CPU_SAMPLES=3 \
FARM_BENCHMARK_MEMORY_SAMPLES=3 \
FARM_BENCHMARK_OUTPUT=/tmp/farm-benchmark-audit.json \
pnpm summarize:official /absolute/path/to/js-framework-benchmark
```

See [BENCHMARK_RESULTS.md](./BENCHMARK_RESULTS.md) for the checked-in interpretation and
`BENCHMARK_RESULTS.json` for raw sample arrays and medians from the recorded run.
[BENCHMARK_RESULTS_LINUX_CHROMIUM.md](./BENCHMARK_RESULTS_LINUX_CHROMIUM.md) and
`BENCHMARK_RESULTS_LINUX_CHROMIUM.json` are a separate run on a Linux VM with Chromium; compare
ratios between builds, not absolute times across the two machines.

## Compare with other frameworks

To rank Farm against the harness's own entries, build those entries in the checkout (for example
`frameworks/keyed/vanillajs`, `solid`, `svelte`, `vue`, `preact-hooks` and `react-compiler-hooks`,
each with `npm ci && npm run build-prod` where it has a build), add them to the `--framework`
lists of the `isKeyed` and `bench` commands above, and run the CPU, memory and size suites into an
otherwise empty `webdriver-ts/results`. Then score every framework in that directory:

```bash
pnpm compare:frameworks /absolute/path/to/js-framework-benchmark
```

It recomputes each median from the raw samples, rejects duplicate results, and scores CPU with the
official weights and memory and size with equal weights, relative to the best framework in the
run, as the harness's results table does. Set `FARM_COMPARISON_OUTPUT` to choose the JSON path.
[FRAMEWORK_COMPARISON_LINUX_CHROMIUM.md](./FRAMEWORK_COMPARISON_LINUX_CHROMIUM.md) is the recorded
ten-framework run.

## Run everything in one step

`scripts/run-official.sh` does all of the above against a harness checkout: it installs the
harness and its framework entries with npm lifecycle scripts disabled, prepares the Farm adapters,
starts the harness server, runs the keyed-identity check and the CPU, memory and size suites, and
writes `farm-vs-react.json`, `framework-comparison.json`, the raw results and `environment.txt`
to the output directory. Build `@farm.js/react` first.

```bash
scripts/run-official.sh /absolute/path/to/js-framework-benchmark /absolute/path/to/output
```

`CHROME_BINARY`, `FARM_BENCHMARK_FRAMEWORKS` (the harness entries besides the Farm adapters; it
must include `react-hooks`), `FARM_BENCHMARK_CPU_SAMPLES` and `FARM_BENCHMARK_MEMORY_SAMPLES`
change the defaults. The script refuses a non-empty `webdriver-ts/results`, so runs are never
mixed. The size suite gets a `--no-sandbox` Chrome wrapper, because the harness launches it through
Puppeteer, which Chrome refuses as root and some CI kernels block for unprivileged users.

In CI, run the **CI** workflow manually with the `js-framework-benchmark` input. The
`js-framework-benchmark Diagnostic` job runs the script on `ubuntu-latest` with the harness
revision pinned in `.github/workflows/ci.yml`, writes the score table to the job summary, and
uploads the output directory as an artifact for 14 days. A hosted runner is a shared machine:
compare builds within one run, and repeat a run before publishing a ranking from it.

These are local results produced by the official harness, not an official leaderboard submission.
Browser, operating-system, runner, framework versions, harness revision, and sample counts must be
reported with comparisons. Overall CPU comparisons should use the official-weighted geometric
mean; the unweighted geometric mean may be included only as a separately labeled diagnostic.
