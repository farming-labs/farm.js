import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./summarize-official.mjs", import.meta.url));
const frameworks = {
  hybrid: "farm-react-hybrid-v0.1.0-beta.29-hybrid-react-19.2.0-keyed",
  off: "farm-react-off-vreact-19.2.0-compiler-off-keyed",
  react: "react-hooks-v19.2.0-keyed",
  static: "farm-react-static-v0.1.0-beta.29-static-react-19.2.0-keyed",
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
const weights = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const previousReport = "previous report must survive invalid inputs\n";
const metric = (value, count) => ({ median: value, values: Array(count).fill(value) });

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-benchmark-summary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultsRoot = path.join(root, "webdriver-ts/results");
  const commonRoot = path.join(root, "webdriver-ts-results/src");
  const output = path.join(root, "summary.json");
  await mkdir(resultsRoot, { recursive: true });
  await mkdir(commonRoot, { recursive: true });
  await writeFile(output, previousReport);
  await writeFile(
    path.join(commonRoot, "Common.ts"),
    `if (type === BenchmarkType.CPU) { benchmarkWeights = [${weights.join(",")}]; }`,
  );
  // Exercise the real CLI's harness revision lookup without using the user's repository.
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Benchmark fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Synthetic benchmark fixture",
  ]);
  const records = {};
  for (const [variant, framework] of Object.entries(frameworks)) {
    records[variant] = {};
    for (const id of [...cpuIds, ...secondaryIds]) {
      const type = cpuIds.includes(id) ? "cpu" : id.startsWith("2") ? "memory" : "size";
      const count = type === "cpu" ? (id === "04_select1k" ? 20 : 10) : type === "memory" ? 3 : 1;
      const total = { hybrid: 10, off: 20, react: 30, static: 20 }[variant];
      const values =
        type === "cpu"
          ? { total: metric(total, count), script: metric(0, count), paint: metric(total, count) }
          : { DEFAULT: metric(100, count) };
      const record = { framework, keyed: true, benchmark: id, type, values };
      records[variant][id] = record;
      await writeFile(path.join(resultsRoot, `${framework}_${id}.json`), JSON.stringify(record));
    }
  }
  return {
    records,
    output,
    commonFile: path.join(commonRoot, "Common.ts"),
    file: (variant, id) => path.join(resultsRoot, `${frameworks[variant]}_${id}.json`),
    run: () =>
      spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
        env: {
          ...process.env,
          FARM_BENCHMARK_OUTPUT: output,
          FARM_BENCHMARK_CPU_SAMPLES: "10",
          FARM_BENCHMARK_MEMORY_SAMPLES: "3",
        },
      }),
  };
}

async function rejectsReport(input, message) {
  const result = input.run();
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, "Invalid input must not produce a successful report.");
  assert.match(result.stderr, message);
  assert.equal(await readFile(input.output, "utf8"), previousReport);
}

test("preserves valid metrics and ratios while recording each variant's full identity", async (t) => {
  const input = await fixture(t);
  const result = input.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(input.output, "utf8"));
  assert.deepEqual(report.harness.officialCpuWeights, weights);
  const expected = {
    hybridVsOffOfficialWeightedSpeedup: 2,
    hybridVsReactOfficialWeightedSpeedup: 3,
    staticVsReactOfficialWeightedSpeedup: 1.5,
    hybridVsOffUnweightedSpeedup: 2,
    hybridVsReactUnweightedSpeedup: 3,
    staticVsReactUnweightedSpeedup: 1.5,
  };
  for (const [name, value] of Object.entries(expected)) {
    assert(Math.abs(report.aggregate[name] - value) < 1e-12, name);
  }
  for (const [variant, framework] of Object.entries(frameworks)) {
    for (const id of cpuIds)
      assert.deepEqual(report.results[variant].cpu[id], input.records[variant][id].values);
    for (const id of secondaryIds)
      assert.deepEqual(report.results[variant].secondary[id], input.records[variant][id].values);
    assert.equal(report.results[variant].framework, framework);
  }
});

for (const variant of Object.keys(frameworks)) {
  for (const id of ["02_replace1k", "21_ready-memory", "43_first-paint"]) {
    test(`rejects a different ${variant} version in ${id}`, async (t) => {
      const input = await fixture(t);
      const record = input.records[variant][id];
      record.framework = record.framework.replace("19.2.0", "19.1.0");
      const original = input.file(variant, id);
      const changed = path.join(path.dirname(original), `${record.framework}_${id}.json`);
      await rename(original, changed);
      await writeFile(changed, JSON.stringify(record));
      await rejectsReport(input, /framework identity mismatch/);
    });
  }
}

test("rejects mixed compiler releases even when the React version matches", async (t) => {
  const input = await fixture(t);
  const id = "01_run1k";
  const record = input.records.hybrid[id];
  record.framework = record.framework.replace("beta.29", "beta.15");
  const original = input.file("hybrid", id);
  const changed = path.join(path.dirname(original), `${record.framework}_${id}.json`);
  await rename(original, changed);
  await writeFile(changed, JSON.stringify(record));
  await rejectsReport(input, /framework identity mismatch/);
});

test("rejects disagreement between the filename and JSON framework version", async (t) => {
  const input = await fixture(t);
  const record = input.records.hybrid["01_run1k"];
  record.framework = record.framework.replace("beta.29", "beta.15");
  await writeFile(input.file("hybrid", "01_run1k"), JSON.stringify(record));
  await rejectsReport(input, /framework metadata does not match its filename/);
});

test("rejects a missing operation without replacing an earlier report", async (t) => {
  const input = await fixture(t);
  await rm(input.file("static", "43_first-paint"));
  await rejectsReport(input, /Expected one .*43_first-paint result, found 0/);
});

test("rejects stale duplicate versions without picking either result", async (t) => {
  const input = await fixture(t);
  const original = input.file("hybrid", "01_run1k");
  const record = structuredClone(input.records.hybrid["01_run1k"]);
  record.framework = record.framework.replace("beta.29", "beta.15");
  await writeFile(original.replace("beta.29", "beta.15"), JSON.stringify(record));
  await rejectsReport(input, /Expected one .*01_run1k result, found 2/);
});

for (const [field, value, message] of [
  ["framework", null, /framework metadata mismatch/],
  ["keyed", false, /not marked keyed/],
  ["type", "memory", /result type mismatch/],
  ["benchmark", "02_replace1k", /benchmark metadata mismatch/],
]) {
  test(`rejects invalid ${field} metadata`, async (t) => {
    const input = await fixture(t);
    input.records.hybrid["01_run1k"][field] = value;
    await writeFile(
      input.file("hybrid", "01_run1k"),
      JSON.stringify(input.records.hybrid["01_run1k"]),
    );
    await rejectsReport(input, message);
  });
}

test("still validates raw sample counts and medians", async (t) => {
  const input = await fixture(t);
  const record = input.records.hybrid["01_run1k"];
  record.values.total.values.pop();
  await writeFile(input.file("hybrid", "01_run1k"), JSON.stringify(record));
  await rejectsReport(input, /sample count mismatch/);
  record.values.total.values.push(10);
  record.values.total.median = 11;
  await writeFile(input.file("hybrid", "01_run1k"), JSON.stringify(record));
  await rejectsReport(input, /median does not match its samples/);
});

for (const variant of Object.keys(frameworks)) {
  test(`rejects a zero ${variant} total median without replacing the report`, async (t) => {
    const input = await fixture(t);
    const id = "09_clear1k_x8";
    const record = input.records[variant][id];
    record.values.total = metric(0, 10);
    await writeFile(input.file(variant, id), JSON.stringify(record));
    await rejectsReport(input, /09_clear1k_x8.json total median must be positive and finite/);
  });
}

for (const [reference, candidate] of [
  ["react", "hybrid"],
  ["off", "hybrid"],
  ["react", "static"],
]) {
  for (const [kind, numerator, denominator] of [
    ["overflow", 2 ** 1000, 2 ** -1000],
    ["underflow", 2 ** -1000, 2 ** 1000],
  ]) {
    test(`rejects ${reference}/${candidate} ratio ${kind} from positive finite medians`, async (t) => {
      const input = await fixture(t);
      const id = "01_run1k";
      for (const [variant, value] of [
        [reference, numerator],
        [candidate, denominator],
      ]) {
        const record = input.records[variant][id];
        record.values.total = metric(value, 10);
        await writeFile(input.file(variant, id), JSON.stringify(record));
      }
      await rejectsReport(
        input,
        new RegExp(`${reference}/${candidate} ${id} must be positive and finite`),
      );
    });
  }
}

test("rejects a non-finite aggregate without serializing it as null", async (t) => {
  const input = await fixture(t);
  await writeFile(
    input.commonFile,
    `if (type === BenchmarkType.CPU) { benchmarkWeights = [${Array(9).fill(1e308).join(",")}]; }`,
  );
  await rejectsReport(input, /hybridVsOffOfficialWeightedSpeedup must be positive and finite/);
});

test("preserves isolated zero samples and zero non-total metrics", async (t) => {
  const input = await fixture(t);
  for (const [variant, records] of Object.entries(input.records)) {
    for (const [id, record] of Object.entries(records)) {
      if (record.type === "cpu") {
        record.values.total.values[0] = 0;
        record.values.paint = metric(0, record.values.paint.values.length);
      } else {
        record.values.DEFAULT = metric(0, record.values.DEFAULT.values.length);
      }
      await writeFile(input.file(variant, id), JSON.stringify(record));
    }
  }
  const result = input.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(input.output, "utf8"));
  for (const [variant, records] of Object.entries(input.records)) {
    for (const [id, record] of Object.entries(records)) {
      const group = record.type === "cpu" ? "cpu" : "secondary";
      assert.deepEqual(report.results[variant][group][id], record.values);
    }
  }
  assert(Object.values(report.aggregate).every((value) => Number.isFinite(value) && value > 0));
});

test("replays recorded samples with exactly the same medians and aggregates", async (t) => {
  const input = await fixture(t);
  const recorded = JSON.parse(
    await readFile(new URL("../BENCHMARK_RESULTS.json", import.meta.url), "utf8"),
  );
  await writeFile(
    input.commonFile,
    `if (type === BenchmarkType.CPU) { benchmarkWeights = [${recorded.harness.officialCpuWeights.join(",")}]; }`,
  );
  for (const [variant, records] of Object.entries(input.records)) {
    for (const [id, record] of Object.entries(records)) {
      const group = record.type === "cpu" ? "cpu" : "secondary";
      record.values = recorded.results[variant][group][id];
      await writeFile(input.file(variant, id), JSON.stringify(record));
    }
  }
  const result = input.run();
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(input.output, "utf8"));
  assert.deepEqual(report.aggregate, recorded.aggregate);
  for (const variant of Object.keys(frameworks)) {
    assert.deepEqual(report.results[variant].cpu, recorded.results[variant].cpu);
    assert.deepEqual(report.results[variant].secondary, recorded.results[variant].secondary);
  }
});
