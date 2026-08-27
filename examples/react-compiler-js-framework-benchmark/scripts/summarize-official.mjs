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

async function result(prefix, id) {
  const file = resultFiles.find(
    (entry) => entry.startsWith(prefix) && entry.endsWith(`_${id}.json`),
  );
  assert(file, `Missing ${prefix} ${id}.`);
  return JSON.parse(await readFile(path.join(resultsRoot, file), "utf8"));
}

const results = {};
for (const [variant, prefix] of Object.entries(variants)) {
  const cpu = {};
  const secondary = {};
  for (const id of cpuIds) cpu[id] = (await result(prefix, id)).values;
  for (const id of secondaryIds) secondary[id] = (await result(prefix, id)).values;
  results[variant] = { cpu, secondary };
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

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
    repository: "https://github.com/krausest/js-framework-benchmark",
    revision: execFileSync("git", ["-C", benchmarkRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    runner: "playwright",
    requestedCpuSamples: 10,
    requestedMemorySamples: 3,
  },
  aggregate: {
    hybridVsOffGeometricMeanSpeedup: geometricMean(hybridVsOff),
    hybridVsReactGeometricMeanSpeedup: geometricMean(hybridVsReact),
    staticVsReactGeometricMeanSpeedup: geometricMean(staticVsReact),
  },
  results,
};

const output = path.join(exampleRoot, "BENCHMARK_RESULTS.json");
await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ aggregate: summary.aggregate, output }, null, 2));
