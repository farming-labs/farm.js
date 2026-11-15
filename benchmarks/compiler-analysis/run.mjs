// See README.md. Diagnostic only: this never changes compiler or runtime behavior.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, release, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function runSample(config, timeout = 60_000) {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./worker.mjs", import.meta.url))],
    {
      input: JSON.stringify(config),
      encoding: "utf8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      // Do not inherit preload/profiling hooks or cross-process bytecode caches.
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        NODE_PATH: "",
        NODE_COMPILE_CACHE: "",
        NODE_COMPILE_CACHE_PORTABLE: "",
        NODE_DISABLE_COMPILE_CACHE: "1",
      },
    },
  );
  assert.equal(
    child.status,
    0,
    `Compiler sample failed (${config.compilerPath}, ${config.options.reactivity}, ${config.warmups} warm-ups): ${child.error?.message || child.signal || "nonzero exit"}\n${child.stderr}\n${child.stdout}`,
  );
  const result = JSON.parse(child.stdout);
  assert.equal(result.compilerHash, config.compilerHash);
  assert.equal(result.inputsHash, config.inputsHash);
  for (const metric of ["elapsedMs", "cpuMs"])
    assert(Number.isFinite(result[metric]) && result[metric] >= 0, `Invalid ${metric}`);
  return { ...result, stderr: child.stderr };
}

export function assertSameOutput(result, reference) {
  assert.deepEqual(
    result.outputs,
    reference.outputs,
    "Compiler output changed (code, maps, diagnostics or optimization metadata)",
  );
}

export function median(values) {
  assert(values.length > 0 && values.every(Number.isFinite));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(samples) {
  return Object.fromEntries(
    ["control", "comparison"].map((group) => {
      const rows = samples.filter((sample) => sample.group === group);
      return [
        group,
        Object.fromEntries(
          ["baseline", "candidate"].map((variant) => {
            const selected = rows.filter((sample) => sample.variant === variant);
            return [
              variant,
              {
                wallMs: median(selected.map((sample) => sample.elapsedMs)),
                cpuMs: median(selected.map((sample) => sample.cpuMs)),
              },
            ];
          }),
        ),
      ];
    }),
  );
}

async function listInputs(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listInputs(path)));
    else if (entry.isFile() && /\.[jt]sx$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function main() {
  assert(process.env.BASE_REF, "Set BASE_REF to a compiler commit (see README.md)");
  const pairs = Number(process.env.PAIRS || 5);
  assert(Number.isInteger(pairs) && pairs >= 3 && pairs <= 20, "PAIRS must be 3–20");
  const ref = (value) =>
    execFileSync("git", ["rev-parse", "--verify", `${value}^{commit}`], {
      cwd: workspace,
      encoding: "utf8",
    }).trim();
  const baselineRef = ref(process.env.BASE_REF);
  const candidateRef = process.env.CANDIDATE_REF ? ref(process.env.CANDIDATE_REF) : null;
  const sourcePath = "packages/farm-react/src/compiler.ts";
  const sourceAt = (commit) =>
    execFileSync("git", ["show", `${commit}:${sourcePath}`], {
      cwd: workspace,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
  const sources = [
    sourceAt(baselineRef),
    candidateRef ? sourceAt(candidateRef) : await readFile(join(workspace, sourcePath), "utf8"),
  ];
  const output = await mkdtemp(join(tmpdir(), "farm-compiler-isolated-"));
  console.log(JSON.stringify({ output, baselineRef, candidateRef }));
  const require = createRequire(join(workspace, "packages/farm-react/package.json"));
  const { transformWithEsbuild } = require("vite");
  const { normalizeReactCompilerOptions } = require("./dist/index.cjs");
  const compilers = [];
  for (const [index, source] of sources.entries()) {
    const { code } = await transformWithEsbuild(source, "compiler.ts", {
      loader: "ts",
      target: "esnext",
    });
    const pattern = /(["'])@babel\/core\1/g;
    assert.equal([...code.matchAll(pattern)].length, 1, "Compiler Babel import no longer matches");
    const prepared = code.replace(
      pattern,
      JSON.stringify(pathToFileURL(require.resolve("@babel/core")).href),
    );
    const compilerPath = join(output, `${index}.mjs`);
    await writeFile(compilerPath, prepared);
    compilers.push({ compilerPath, compilerHash: hash(prepared), sourceHash: hash(source) });
  }
  const files = (
    await Promise.all(
      ["react-compiler", "react-compiler-dashboard"].map((app) =>
        listInputs(join(workspace, "examples", app, "src")),
      ),
    )
  )
    .flat()
    .sort();
  const inputs = await Promise.all(
    files.map(async (id) => ({ id, source: await readFile(id, "utf8") })),
  );
  const inputSource = JSON.stringify(inputs);
  const inputsPath = join(output, "inputs.json");
  await writeFile(inputsPath, inputSource);
  const inputsHash = hash(inputSource);
  const config = (index, reactivity, warmups) => ({
    ...compilers[index],
    inputsPath,
    inputsHash,
    options: normalizeReactCompilerOptions({ reactivity, report: true }),
    warmups,
  });
  const controls = {};
  for (const reactivity of ["static", "hybrid"]) {
    const baseline = runSample(config(0, reactivity, 0));
    const candidate = runSample(config(1, reactivity, 0));
    assertSameOutput(candidate, baseline);
    controls[reactivity] = { baseline, candidate };
  }
  await writeFile(join(output, "controls.json"), JSON.stringify(controls, null, 2));
  const samples = [];
  for (let pair = 0; pair < pairs; pair++) {
    const variants = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    const groups = pair % 2 ? ["comparison", "control"] : ["control", "comparison"];
    for (const group of groups)
      for (const variant of variants) {
        const index = group === "comparison" && variant === "candidate" ? 1 : 0;
        const result = runSample(config(index, "hybrid", 2));
        assertSameOutput(result, controls.hybrid.baseline);
        const sample = { pair, group, variant, ...result };
        samples.push(sample);
        await writeFile(
          join(output, `${pair}-${group}-${variant}.json`),
          JSON.stringify(sample, null, 2),
        );
        console.log(
          JSON.stringify({
            pair,
            group,
            variant,
            elapsedMs: result.elapsedMs,
            cpuMs: result.cpuMs,
            pid: result.pid,
          }),
        );
      }
  }
  const report = {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    dependencies: {
      babel: require("@babel/core/package.json").version,
      vite: require("vite/package.json").version,
    },
    cpu: cpus()[0].model,
    cores: cpus().length,
    os: release(),
    baselineRef,
    candidateRef,
    output,
    pairs,
    warmupsPerSample: 2,
    compilerSources: compilers,
    inputsHash,
    inputs: inputs.map(({ id, source }) => ({ id, hash: hash(source) })),
    options: config(0, "hybrid", 2).options,
    controls,
    samples,
    summary: summarize(samples),
    limits:
      "Compiler-only diagnostic, not build/browser performance or a ranking. Control compares identical baseline code; inspect its noise and all paired samples. Fresh processes do not eliminate host contention. No automatic performance verdict.",
  };
  await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, summary: report.summary, limits: report.limits }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
