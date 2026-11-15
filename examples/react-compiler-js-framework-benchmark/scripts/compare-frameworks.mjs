import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const cpuIds = [
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
export const memoryIds = ["21_ready-memory", "22_run-memory", "25_run-clear-memory"];
export const sizeIds = ["41_size-uncompressed", "42_size-compressed", "43_first-paint"];

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function weightedGeometricMean(values, weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return Math.exp(
    values.reduce((sum, value, index) => sum + weights[index] * Math.log(value), 0) / totalWeight,
  );
}

export function readOfficialCpuWeights(commonSource) {
  const match = commonSource.match(
    /if\s*\(type === BenchmarkType\.CPU\)[\s\S]*?benchmarkWeights\s*=\s*\[([\s\S]*?)\];/,
  );
  assert(match, "Could not read the official CPU weights from Common.ts.");
  const weights = match[1]
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);
  assert.equal(weights.length, cpuIds.length, "Official CPU weight count mismatch.");
  assert(
    weights.every((value) => Number.isFinite(value) && value > 0),
    "Official CPU weights must be positive finite numbers.",
  );
  return weights;
}

/**
 * Scores frameworks the way the harness's results table does: each framework's median divided by
 * the lowest median among the compared frameworks, combined with the official CPU weights (CPU) or
 * equal weights (memory, size). 1.00 means best on every benchmark in the table.
 */
export function scoreTable(results, ids, weights) {
  const frameworks = Object.keys(results);
  const best = Object.fromEntries(
    ids.map((id) => [id, Math.min(...frameworks.map((framework) => results[framework][id].median))]),
  );
  for (const [id, value] of Object.entries(best)) {
    assert(Number.isFinite(value) && value > 0, `${id} has no positive median.`);
  }
  return frameworks
    .map((framework) => {
      const factors = ids.map((id) => results[framework][id].median / best[id]);
      return { framework, score: weightedGeometricMean(factors, weights), factors };
    })
    .sort((left, right) => left.score - right.score);
}

export async function readResults(resultsRoot) {
  const results = {};
  for (const file of (await readdir(resultsRoot)).filter((entry) => entry.endsWith(".json"))) {
    const parsed = JSON.parse(await readFile(path.join(resultsRoot, file), "utf8"));
    assert.equal(parsed.keyed, true, `${file} is not marked keyed.`);
    assert(typeof parsed.framework === "string", `${file} has no framework label.`);
    const metric = parsed.values?.total ?? parsed.values?.DEFAULT;
    assert(metric && Array.isArray(metric.values) && metric.values.length > 0, `${file} has no samples.`);
    assert(
      metric.values.every((value) => Number.isFinite(value) && value >= 0),
      `${file} contains an invalid sample.`,
    );
    const framework = (results[parsed.framework] ??= {});
    assert(!framework[parsed.benchmark], `Duplicate ${parsed.framework} ${parsed.benchmark} result.`);
    framework[parsed.benchmark] = { median: median(metric.values), values: metric.values };
  }
  return results;
}

async function main() {
  const benchmarkRoot = process.argv[2] || process.env.JS_FRAMEWORK_BENCHMARK_DIR;
  assert(benchmarkRoot, "Pass the js-framework-benchmark checkout path.");
  const results = await readResults(path.join(benchmarkRoot, "webdriver-ts", "results"));
  const frameworks = Object.keys(results);
  assert(frameworks.length >= 2, "Compare at least two frameworks.");
  for (const framework of frameworks) {
    for (const id of [...cpuIds, ...memoryIds, ...sizeIds]) {
      assert(results[framework][id], `${framework} is missing ${id}. Run the CPU, memory and size suites.`);
    }
  }
  const weights = readOfficialCpuWeights(
    await readFile(path.join(benchmarkRoot, "webdriver-ts-results", "src", "Common.ts"), "utf8"),
  );
  const tables = {
    cpu: scoreTable(results, cpuIds, weights),
    memory: scoreTable(results, memoryIds, memoryIds.map(() => 1)),
    size: scoreTable(results, sizeIds, sizeIds.map(() => 1)),
  };
  const output = path.resolve(
    process.env.FARM_COMPARISON_OUTPUT ||
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "FRAMEWORK_COMPARISON.json"),
  );
  await writeFile(
    output,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), officialCpuWeights: weights, tables, results }, null, 2)}\n`,
  );
  for (const [name, rows] of Object.entries(tables)) {
    console.log(`\n${name}`);
    for (const row of rows) console.log(`  ${row.score.toFixed(3)}  ${row.framework}`);
  }
  console.log(`\nwrote ${output}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
