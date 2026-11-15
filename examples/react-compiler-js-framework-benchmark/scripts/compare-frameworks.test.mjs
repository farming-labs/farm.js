import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cpuIds, median, readOfficialCpuWeights, readResults, scoreTable } from "./compare-frameworks.mjs";

test("median uses the middle pair for even sample counts", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("scores relative to the best median with the given weights", () => {
  const results = {
    fast: { a: { median: 10 }, b: { median: 20 } },
    slow: { a: { median: 20 }, b: { median: 20 } },
  };
  const [first, second] = scoreTable(results, ["a", "b"], [1, 1]);
  assert.equal(first.framework, "fast");
  assert.equal(first.score, 1);
  assert.deepEqual(second.factors, [2, 1]);
  assert.ok(Math.abs(second.score - Math.SQRT2) < 1e-12);
  // Weighting only the first benchmark makes the slow framework exactly 2x.
  assert.ok(Math.abs(scoreTable(results, ["a", "b"], [1, 1e-12])[1].score - 2) < 1e-9);
});

test("reads the official CPU weights and rejects a wrong count", () => {
  const source = (weights) =>
    `if (type === BenchmarkType.CPU) {\n  benchmarkWeights = [\n    ${weights.join(", ")},\n  ];\n}`;
  assert.deepEqual(readOfficialCpuWeights(source(cpuIds.map(() => 0.5))), cpuIds.map(() => 0.5));
  assert.throws(() => readOfficialCpuWeights(source([0.5, 0.5])), /count mismatch/);
});

test("recomputes medians from raw samples and rejects duplicates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "farm-compare-"));
  const result = (framework, benchmark, values) =>
    JSON.stringify({ framework, benchmark, keyed: true, values: { total: { median: -1, values } } });
  await writeFile(path.join(dir, "a_01.json"), result("a-keyed", "01_run1k", [5, 1, 3]));
  const results = await readResults(dir);
  assert.equal(results["a-keyed"]["01_run1k"].median, 3);
  await writeFile(path.join(dir, "a_01_copy.json"), result("a-keyed", "01_run1k", [5, 1, 3]));
  await assert.rejects(readResults(dir), /Duplicate/);
});
