// Compiler-only comparison: BASE_REF=<commit> PAIRS=7 node scripts/benchmark-compiler-analysis.mjs
// Build @farm.js/react first. Do not run other verification concurrently.
// Timings are uninstrumented. Counts and complete output equality are separate controls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, loadavg, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

assert(process.env.BASE_REF, "Set BASE_REF to the compiler revision to compare");
const pairs = Number(process.env.PAIRS || 7);
assert(Number.isInteger(pairs) && pairs >= 3 && pairs <= 20, "PAIRS must be 3–20");
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineRef = execFileSync(
  "git",
  ["rev-parse", "--verify", `${process.env.BASE_REF}^{commit}`],
  { cwd: workspace, encoding: "utf8" },
).trim();
const output = await mkdtemp(join(tmpdir(), "farm-compiler-analysis-"));
const require = createRequire(join(workspace, "packages/farm-react/package.json"));
const { transformWithEsbuild } = require("vite");
const { normalizeReactCompilerOptions } = require("./dist/index.cjs");
const sourcePath = "packages/farm-react/src/compiler.ts";
const sources = [
  execFileSync("git", ["show", `${baselineRef}:${sourcePath}`], {
    cwd: workspace,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }),
  await readFile(join(workspace, sourcePath), "utf8"),
];
const compilers = [];
const countedCompilers = [];
for (const [index, source] of sources.entries()) {
  const transformed = await transformWithEsbuild(source, "compiler.ts", {
    loader: "ts",
    target: "esnext",
  });
  const pattern = /(["'])@babel\/core\1/g;
  assert.equal([...transformed.code.matchAll(pattern)].length, 1);
  const code = transformed.code.replace(
    pattern,
    JSON.stringify(pathToFileURL(require.resolve("@babel/core")).href),
  );
  const signature = "function collectStateDependencies(expression, statesByValue) {";
  assert.equal(code.split(signature).length, 2, "Dependency count probe no longer matches");
  for (const counted of [false, true]) {
    const path = join(output, `${index}${counted ? "-counted" : ""}.mjs`);
    await writeFile(
      path,
      counted
        ? "let dependencyCollections = 0;\n" +
            code.replace(signature, `${signature} dependencyCollections++;`) +
            "\nexport function takeCount() { const count = dependencyCollections; dependencyCollections = 0; return count; }\n"
        : code,
    );
    (counted ? countedCompilers : compilers).push(await import(pathToFileURL(path).href));
  }
}
const files = execFileSync(
  "rg",
  ["--files", "examples/react-compiler/src", "examples/react-compiler-dashboard/src"],
  { cwd: workspace, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((file) => /\.[jt]sx$/.test(file))
  .sort();
const inputs = await Promise.all(
  files.map(async (file) => ({
    id: join(workspace, file),
    source: await readFile(join(workspace, file), "utf8"),
  })),
);
const counts = {};
for (const reactivity of ["static", "hybrid"]) {
  const options = normalizeReactCompilerOptions({ reactivity, report: true });
  for (const input of inputs) {
    const results = await Promise.all(
      [...compilers, ...countedCompilers].map((compiler) =>
        compiler.compileReactModule(input.source, input.id, options),
      ),
    );
    for (const result of results.slice(1)) assert.deepEqual(result, results[0], input.id);
  }
  counts[reactivity] = countedCompilers.map((compiler) => compiler.takeCount());
}
console.log(JSON.stringify({ output, files: files.length, counts, outputIdentical: true }));
const options = normalizeReactCompilerOptions({ reactivity: "hybrid", report: true });
async function batch(index) {
  const startLoad = loadavg();
  const cpuStart = process.cpuUsage();
  const started = performance.now();
  for (const input of inputs)
    await compilers[index].compileReactModule(input.source, input.id, options);
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(cpuStart);
  return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, startLoad, endLoad: loadavg() };
}
for (let round = 0; round < 2; round++) {
  for (const index of round % 2 ? [1, 0] : [0, 1]) await batch(index);
}
const results = [];
for (let pair = 0; pair < pairs; pair++) {
  for (const index of pair % 2 ? [1, 0] : [0, 1]) {
    const result = { pair, variant: index ? "candidate" : "baseline", ...(await batch(index)) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const report = {
  node: process.version,
  cpu: cpus()[0].model,
  cores: cpus().length,
  os: release(),
  baselineRef,
  compilerSourceHashes: sources.map((source) => createHash("sha256").update(source).digest("hex")),
  output,
  files,
  counts,
  outputIdentical: true,
  pairs,
  results,
  summary: ["baseline", "candidate"].map((variant) => ({
    variant,
    medianWallMs: median(
      results.filter((result) => result.variant === variant).map((result) => result.elapsedMs),
    ),
    medianCpuMs: median(
      results.filter((result) => result.variant === variant).map((result) => result.cpuMs),
    ),
  })),
  limits:
    "Compiler-only diagnostic on the current host, not build time, browser performance, or a framework ranking. Inspect load and individual pairs.",
};
await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
