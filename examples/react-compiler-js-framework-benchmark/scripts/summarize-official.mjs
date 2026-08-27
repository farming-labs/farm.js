import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkRoot = path.resolve(process.argv[2] || process.env.JS_FRAMEWORK_BENCHMARK_DIR || "");
if (!process.argv[2] && !process.env.JS_FRAMEWORK_BENCHMARK_DIR) {
  throw new Error(
    "Pass the js-framework-benchmark checkout path or set JS_FRAMEWORK_BENCHMARK_DIR.",
  );
}

const resultsRoot = path.join(benchmarkRoot, "webdriver-ts", "results");
const resultFiles = await readdir(resultsRoot);
const requestedCpuSamples = Number(process.env.FARM_BENCHMARK_CPU_SAMPLES || 10);
const requestedMemorySamples = Number(process.env.FARM_BENCHMARK_MEMORY_SAMPLES || 3);
assert(Number.isInteger(requestedCpuSamples) && requestedCpuSamples > 0);
assert(Number.isInteger(requestedMemorySamples) && requestedMemorySamples > 0);
const variants = {
  hybrid: "farm-react-hybrid-",
  off: "farm-react-off-",
  react: "react-hooks-",
  static: "farm-react-static-",
};
const cpuIds = [
  "01_run1k",
  "02_replace1k",
  "03_update10th1k_x16",
  "04_select1k",
  "05_swap1k",
  "06_remove-one-1k",
  "07_create10k",
  "08_create1k-after1k_x2",
  "09_clear1k_x8",
];
const secondaryIds = [
  "21_ready-memory",
  "22_run-memory",
  "25_run-clear-memory",
  "41_size-uncompressed",
  "42_size-compressed",
  "43_first-paint",
];

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function validateMetric(metric, expectedSamples, label) {
  assert(metric && Array.isArray(metric.values), `${label} has no raw sample array.`);
  assert.equal(metric.values.length, expectedSamples, `${label} sample count mismatch.`);
  assert(
    metric.values.every((value) => Number.isFinite(value) && value >= 0),
    `${label} contains an invalid sample.`,
  );
  assert.equal(metric.median, median(metric.values), `${label} median does not match its samples.`);
}

async function result(prefix, id, type, expectedSamples) {
  const files = resultFiles.filter(
    (entry) => entry.startsWith(prefix) && entry.endsWith(`_${id}.json`),
  );
  assert.equal(
    files.length,
    1,
    `Expected one ${prefix} ${id} result, found ${files.length}. Remove stale result files.`,
  );
  const parsed = JSON.parse(await readFile(path.join(resultsRoot, files[0]), "utf8"));
  assert.equal(parsed.benchmark, id, `${files[0]} benchmark metadata mismatch.`);
  assert.equal(parsed.keyed, true, `${files[0]} is not marked keyed.`);
  assert.equal(parsed.type, type, `${files[0]} result type mismatch.`);
  assert(
    parsed.framework.startsWith(prefix.slice(0, -1)),
    `${files[0]} framework metadata mismatch.`,
  );
  if (type === "cpu") {
    for (const metric of ["total", "script", "paint"]) {
      validateMetric(parsed.values[metric], expectedSamples, `${files[0]} ${metric}`);
    }
  } else {
    validateMetric(parsed.values.DEFAULT, expectedSamples, `${files[0]} DEFAULT`);
  }
  return parsed;
}

const results = {};
for (const [variant, prefix] of Object.entries(variants)) {
  const cpu = {};
  const secondary = {};
  for (const id of cpuIds) {
    const expectedSamples = requestedCpuSamples + (id === "04_select1k" ? 10 : 0);
    cpu[id] = (await result(prefix, id, "cpu", expectedSamples)).values;
  }
  for (const id of secondaryIds) {
    const type = id.startsWith("2") ? "memory" : "size";
    const expectedSamples = type === "memory" ? requestedMemorySamples : 1;
    secondary[id] = (await result(prefix, id, type, expectedSamples)).values;
  }
  results[variant] = { cpu, secondary };
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function weightedGeometricMean(values, weights) {
  assert.equal(values.length, weights.length);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return Math.exp(
    values.reduce((sum, value, index) => sum + weights[index] * Math.log(value), 0) / totalWeight,
  );
}

const resultTableSource = await readFile(
  path.join(benchmarkRoot, "webdriver-ts-results", "src", "Common.ts"),
  "utf8",
);
const officialWeightMatch = resultTableSource.match(
  /if\s*\(type === BenchmarkType\.CPU\)[\s\S]*?benchmarkWeights\s*=\s*\[([\s\S]*?)\];/,
);
assert(officialWeightMatch, "Could not read the official CPU weights from Common.ts.");
const officialCpuWeights = officialWeightMatch[1]
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map(Number);
assert.equal(officialCpuWeights.length, cpuIds.length, "Official CPU weight count mismatch.");
assert(
  officialCpuWeights.every((value) => Number.isFinite(value) && value > 0),
  "Official CPU weights must be positive finite numbers.",
);

const hybridVsReact = cpuIds.map(
  (id) => results.react.cpu[id].total.median / results.hybrid.cpu[id].total.median,
);
const hybridVsOff = cpuIds.map(
  (id) => results.off.cpu[id].total.median / results.hybrid.cpu[id].total.median,
);
const staticVsReact = cpuIds.map(
  (id) => results.react.cpu[id].total.median / results.static.cpu[id].total.median,
);

const summary = {
  generatedAt: new Date().toISOString(),
  environment: {
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    node: process.version,
    platform: os.platform(),
    release: os.release(),
  },
  harness: {
    officialCpuWeights,
    repository: "https://github.com/krausest/js-framework-benchmark",
    revision: execFileSync("git", ["-C", benchmarkRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    runner: "playwright",
    requestedCpuSamples,
    requestedMemorySamples,
  },
  aggregate: {
    hybridVsOffOfficialWeightedSpeedup: weightedGeometricMean(hybridVsOff, officialCpuWeights),
    hybridVsReactOfficialWeightedSpeedup: weightedGeometricMean(hybridVsReact, officialCpuWeights),
    staticVsReactOfficialWeightedSpeedup: weightedGeometricMean(staticVsReact, officialCpuWeights),
    hybridVsOffUnweightedSpeedup: geometricMean(hybridVsOff),
    hybridVsReactUnweightedSpeedup: geometricMean(hybridVsReact),
    staticVsReactUnweightedSpeedup: geometricMean(staticVsReact),
  },
  results,
};

const output = path.resolve(
  process.env.FARM_BENCHMARK_OUTPUT || path.join(exampleRoot, "BENCHMARK_RESULTS.json"),
);
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ aggregate: summary.aggregate, output }, null, 2));
