import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertSameOutput, median, runSample, summarize } from "./run.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, implementation) {
  const root = await mkdtemp(join(tmpdir(), "farm-compiler-worker-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compilerPath = join(root, "compiler.mjs");
  const inputsPath = join(root, "inputs.json");
  const input = JSON.stringify([{ id: "/app/Fixture.tsx", source: "fixture" }]);
  await writeFile(compilerPath, implementation);
  await writeFile(inputsPath, input);
  return {
    compilerPath,
    compilerHash: hash(implementation),
    inputsPath,
    inputsHash: hash(input),
    warmups: 2,
    options: { reactivity: "hybrid" },
  };
}

test("every sample has a new process and excludes warm-up and output hashing from timing", async (t) => {
  const config = await fixture(
    t,
    `
    let calls = 0, ticks = 0;
    Object.defineProperty(globalThis, "performance", { value: { now: () => ticks } });
    export async function compileReactModule(source) {
      if (++calls > 3) throw new Error("Compiler state leaked into another sample");
      ticks += 100;
      return { toJSON() { ticks += 1000; return {code: source}; } };
    }
  `,
  );
  const first = runSample(config);
  const second = runSample(config);
  assert.notEqual(first.pid, second.pid);
  assert.notEqual(first.pid, process.pid);
  assert.notEqual(second.pid, process.pid);
  assert.equal(first.elapsedMs, 100);
  assert.equal(second.elapsedMs, 100);
  assertSameOutput(first, second);
});

test("workers do not inherit preload hooks from NODE_OPTIONS", async (t) => {
  const config = await fixture(
    t,
    "export async function compileReactModule() { return process.env.NODE_OPTIONS; }",
  );
  const before = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = "--require=missing-compiler-benchmark-preload";
    assert.deepEqual(runSample(config).outputs, [hash(JSON.stringify(""))]);
  } finally {
    if (before === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = before;
  }
});

test("workers cannot share an inherited Node bytecode cache", async (t) => {
  const config = await fixture(
    t,
    `export async function compileReactModule() {
    return [process.env.NODE_COMPILE_CACHE, process.env.NODE_COMPILE_CACHE_PORTABLE, process.env.NODE_DISABLE_COMPILE_CACHE];
  }`,
  );
  const keys = ["NODE_COMPILE_CACHE", "NODE_COMPILE_CACHE_PORTABLE", "NODE_DISABLE_COMPILE_CACHE"];
  const before = keys.map((key) => process.env[key]);
  try {
    process.env.NODE_COMPILE_CACHE = "/unused-compiler-cache";
    process.env.NODE_COMPILE_CACHE_PORTABLE = "1";
    process.env.NODE_DISABLE_COMPILE_CACHE = "0";
    assert.deepEqual(runSample(config).outputs, [hash(JSON.stringify(["", "", "1"]))]);
  } finally {
    keys.forEach((key, index) => {
      if (before[index] === undefined) delete process.env[key];
      else process.env[key] = before[index];
    });
  }
});

for (const field of ["code", "map", "compiled", "diagnostics", "optimizations"]) {
  test(`output control rejects changed ${field}`, async (t) => {
    const result = {
      code: "ok",
      map: { version: 3 },
      compiled: ["Counter"],
      diagnostics: [],
      optimizations: {},
    };
    const implementation = (value) =>
      `export async function compileReactModule() { return ${JSON.stringify(value)}; }`;
    const config = await fixture(t, implementation(result));
    const baseline = runSample(config);
    const changed = implementation({ ...result, [field]: "changed" });
    await writeFile(config.compilerPath, changed);
    const candidate = runSample({ ...config, compilerHash: hash(changed) });
    assert.throws(() => assertSameOutput(candidate, baseline), /Compiler output changed/);
  });
}

for (const threshold of [2, 3]) {
  test(`rejects nondeterministic output on compilation ${threshold}`, async (t) => {
    const config = await fixture(
      t,
      `let calls=0; export async function compileReactModule() { return {code: ++calls >= ${threshold} ? "changed" : "initial"}; }`,
    );
    assert.throws(() => runSample(config), /Output changed during/);
  });
}

test("worker errors retain their diagnostic message", async (t) => {
  const config = await fixture(
    t,
    'export async function compileReactModule() { throw new Error("fixture compiler failed"); }',
  );
  assert.throws(() => runSample(config), /fixture compiler failed/);
});

test("worker timeout fails the run instead of reporting a partial sample", async (t) => {
  const config = await fixture(
    t,
    "export async function compileReactModule() { await new Promise(() => setInterval(() => {}, 1000)); }",
  );
  assert.throws(() => runSample(config, 200), /ETIMEDOUT/);
});

for (const property of ["inputsHash", "compilerHash"]) {
  test(`rejects a changed snapshot (${property})`, async (t) => {
    const config = await fixture(
      t,
      'export async function compileReactModule() { return {code:"ok"}; }',
    );
    assert.throws(() => runSample({ ...config, [property]: "incorrect" }), /snapshot changed/);
  });
}

test("reports same-code noise separately without subtracting it from candidate timings", () => {
  const samples = [];
  for (let pair = 0; pair < 3; pair++) {
    samples.push({ pair, group: "control", variant: "baseline", elapsedMs: 10, cpuMs: 10 });
    samples.push({ pair, group: "control", variant: "candidate", elapsedMs: 5, cpuMs: 10 });
    samples.push({ pair, group: "comparison", variant: "baseline", elapsedMs: 10, cpuMs: 10 });
    samples.push({ pair, group: "comparison", variant: "candidate", elapsedMs: 20, cpuMs: 20 });
  }
  assert.deepEqual(summarize(samples), {
    control: { baseline: { wallMs: 10, cpuMs: 10 }, candidate: { wallMs: 5, cpuMs: 10 } },
    comparison: { baseline: { wallMs: 10, cpuMs: 10 }, candidate: { wallMs: 20, cpuMs: 20 } },
  });
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.throws(() => summarize(samples.filter((sample) => sample.variant === "baseline")));
});
