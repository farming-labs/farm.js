// Runtime results the landing page cites, each taken from the run that measured it.
// runtime-benchmarks.test.ts reads the checked-in sources, so re-running a benchmark that changes
// a figure fails the docs tests until this file and the page agree with it again.

/**
 * `benchmarks/compiler`: one keyed-table app built with the React compiler off and on, from the
 * published packages. Click to DOM write, median of 25 iterations (`results/latest.json`).
 */
export const compilerBenchmark = {
  href: "https://github.com/farming-labs/farm.js/tree/main/benchmarks/compiler",
  swap: { reactMs: 3.8, compiledMs: 0.2 },
} as const;

/** How many times faster the compiled swap is, rounded as the page prints it. */
export const compilerSwapSpeedup = Math.round(
  compilerBenchmark.swap.reactMs / compilerBenchmark.swap.compiledMs,
);

/**
 * The official js-framework-benchmark results for Chrome 158 (krausest/js-framework-benchmark
 * e18468299, with the incremental run of 2026-11-22), keyed implementations. The score is the
 * site's weighted geometric mean of each operation's median against the fastest; 1 is the fastest.
 */
export const jsFrameworkBenchmark = {
  href: "https://krausest.github.io/js-framework-benchmark/current.html",
  browser: "Chrome 158",
  entries: [
    { id: "vanillajs", label: "Vanilla JS", score: 1.033 },
    { id: "farm-react", label: "Farm.js React", score: 1.125 },
    { id: "solid", label: "Solid 1.9", score: 1.133 },
    { id: "react-hooks", label: "React 19.2", score: 1.555 },
    { id: "react-compiler", label: "React Compiler", score: 1.601 },
  ],
} as const;

/**
 * One app built with `serverComponents: { mode: "rsc" }` and `{ mode: "islands" }`
 * (`benchmarks/server-components-payload`), as published in the islands docs' comparison table.
 * These pages' client components wait for a click; a page that hydrates one at load sends more.
 */
export const islandsBenchmark = {
  href: "/docs/server-rendering/islands#how-it-compares-with-react-server-components",
  firstLoadKb: { rsc: 71.0, islands: 27.6 },
  mainThreadMs: [
    { page: "Docs page", rsc: 168, islands: 87 },
    { page: "Shop page", rsc: 162, islands: 80 },
    { page: "Blog post", rsc: 216, islands: 106 },
    { page: "Guide post", rsc: 216, islands: 105 },
  ],
  blogRequestsPerSecond: { rsc: 31, islands: 224 },
} as const;
