// Selector-only diagnostic. This does not measure SSR/HTTP or framework rankings.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { isFarmRouteActive } from "../../packages/farm/dist/router.mjs";
import { runtimeSources, signature } from "./runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const baselineMode = process.env.FARM_SLOT_ROUTE_BASELINE ?? "inputs";
assert.ok(["inputs", "owners"].includes(baselineMode), "Unknown baseline");
const sourcesFor = (input) => {
  const code = runtimeSources(source, input);
  return {
    baseline: baselineMode === "owners" ? code.prepared : code.baseline,
    candidate: code.candidate,
  };
};
const code = sourcesFor([]);
const slots = (patterns, extra = {}) =>
  patterns.map((pattern, id) => ({
    pattern,
    id,
    name: "panel",
    ownerPattern: "/",
    fallback: false,
    interception: false,
    containerId: `slot-${id}`,
    module: {},
    ...extra,
  }));
const hundred = slots(Array.from({ length: 100 }, (_, i) => `/route${i}/[id]`));
const scenarios = {
  noSlots: { slots: [], paths: [["/"], ["/missing"]], iterations: 1000000 },
  fallbackOnly: {
    slots: slots(["/"], { fallback: true }),
    paths: [["/one"], ["/two"]],
    iterations: 100000,
  },
  singleDynamic: { slots: slots(["/users/[id]"]), paths: [["/users/a%252Fb"], ["/users/value"]] },
  late100: { slots: hundred, paths: [["/route99/a%252Fb"], ["/route98/value"]] },
  miss100: { slots: hundred, paths: [["/missing/value"], ["/missing/other"]] },
  malformedMiss100: { slots: hundred, paths: [["/missing/%ZZ"], ["/missing/%E0%A4"]] },
  allMatch100: {
    slots: slots(Array(100).fill("/catalog/[id]")),
    paths: [["/catalog/one"], ["/catalog/two"]],
  },
  nestedOwner100: {
    slots: hundred.map((slot) => ({
      ...slot,
      pattern: "/app" + slot.pattern,
      ownerPattern: "/app",
    })),
    paths: [["/app/route99/value"], ["/app/missing/other"]],
  },
  excludedOwner100: {
    slots: hundred.map((slot) => ({ ...slot, ownerPattern: "/outside" })),
    paths: [["/app/one"], ["/app/two"]],
  },
  catchAll: {
    slots: slots(["/docs/:a*/x/:b*/end", "/docs/[[...slug]]"]),
    paths: [["/docs/a%2Fb/x/c/end"], ["/docs/a/b/missing"]],
  },
  interception: {
    slots: [
      ...slots(["/app/photo/[id]"], { ownerPattern: "/app", interception: true }),
      ...slots(["/app"], { ownerPattern: "/app", fallback: true, id: 1 }),
    ],
    paths: [["/app/photo/42", "/app?x=1"], ["/app/photo/42"]],
  },
  singleNested: {
    slots: slots(["/app/[id]"], { ownerPattern: "/app" }),
    paths: [["/app/one"], ["/app/two"]],
  },
  sharedOwnerTwo: {
    slots: slots(["/app/a/[id]", "/app/b/[id]"], { ownerPattern: "/app" }),
    paths: [["/app/a/one"], ["/app/b/two"]],
  },
  uniqueOwners100: {
    slots: hundred.map((slot, i) => ({
      ...slot,
      ownerPattern: `/owner${i}`,
      pattern: `/owner${i}/[id]`,
    })),
    paths: [["/owner99/one"], ["/owner98/two"]],
  },
  sparseDuplicate100: {
    slots: hundred.map((slot, i) => ({
      ...slot,
      ownerPattern: i < 2 ? "/app" : `/owner${i}`,
      pattern: i < 2 ? `/app/route${i}` : `/owner${i}/[id]`,
    })),
    paths: [["/app/route1"], ["/owner99/two"]],
  },
  mostlyRoot100: {
    slots: hundred.map((slot, i) => ({
      ...slot,
      ownerPattern: i < 2 ? "/app" : "/",
      pattern: i < 2 ? `/app/route${i}` : `/route${i}/[id]`,
    })),
    paths: [["/app/route1"], ["/route99/two"]],
  },
  interleavedOwners100: {
    slots: hundred.map((slot, i) => ({
      ...slot,
      ownerPattern: i % 2 ? "/other" : "/app",
      pattern: `${i % 2 ? "/other" : "/app"}/route${i}/[id]`,
    })),
    paths: [["/app/route98/one"], ["/other/route99/two"]],
  },
};
const scenarioName = process.env.FARM_SLOT_ROUTE_SCENARIO;
assert.ok(scenarioName === undefined || Object.hasOwn(scenarios, scenarioName), "Unknown scenario");
const selected = scenarioName ? { [scenarioName]: scenarios[scenarioName] } : scenarios;
// Match production's build-time specialization for each manifest. Compiling
// these diagnostic factories is outside both lookup and runtime-setup timing.
const scenarioSources = Object.fromEntries(
  Object.entries(selected).map(([name, scenario]) => [name, sourcesFor(scenario.slots)]),
);
const scenarioFactories = Object.fromEntries(
  Object.entries(scenarioSources).map(([name, code]) => [
    name,
    Object.fromEntries(
      Object.entries(code).map(([arm, code]) => [
        arm,
        new Function("routeSlots", "isFarmRouteActive", code + ";return matchRouteSlots;"),
      ]),
    ),
  ]),
);
const count = (name, fallback) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
};
const warmups = count("FARM_SLOT_ROUTE_WARMUPS", 500);
const iterations = count("FARM_SLOT_ROUTE_ITERATIONS", 5000);
const checksum = (matches) => matches.reduce((sum, match) => sum + match.id + 1, 0);
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const results = {};
  for (const [name, scenario] of Object.entries(selected)) {
    const factories = scenarioFactories[name];
    const input = Object.freeze(scenario.slots.map((slot) => Object.freeze(slot)));
    const before = factories.baseline(input, isFarmRouteActive),
      after = factories.candidate(input, isFarmRouteActive);
    for (const args of scenario.paths)
      assert.deepEqual(signature(after(...args)), signature(before(...args)));
    const n = process.env.FARM_SLOT_ROUTE_ITERATIONS
      ? iterations
      : (scenario.iterations ?? iterations);
    assert.equal(n % scenario.paths.length, 0, "Iterations must cover complete request cycles");
    const expected =
      (n / scenario.paths.length) *
      scenario.paths.reduce((sum, args) => sum + checksum(before(...args)), 0);
    const select = arm === "baseline" ? before : after;
    for (let i = 0; i < warmups; i++) select(...scenario.paths[i % scenario.paths.length]);
    let sum = 0;
    const cpu = process.cpuUsage(),
      thread = process.threadCpuUsage?.(),
      start = performance.now();
    for (let i = 0; i < n; i++)
      sum += checksum(select(...scenario.paths[i % scenario.paths.length]));
    const wallMs = performance.now() - start,
      used = process.cpuUsage(cpu),
      threadUsed = thread && process.threadCpuUsage(thread);
    assert.equal(sum, expected);
    for (let i = 0; i < 20; i++) factories[arm](input, isFarmRouteActive);
    const setupCpu = process.cpuUsage(),
      setupStart = performance.now();
    let fresh;
    for (let i = 0; i < 100; i++) fresh = factories[arm](input, isFarmRouteActive);
    const setupWall = performance.now() - setupStart,
      setupUsed = process.cpuUsage(setupCpu);
    assert.deepEqual(
      signature(fresh(...scenario.paths[0])),
      signature(before(...scenario.paths[0])),
    );
    results[name] = {
      iterations: n,
      wallMsPerLookup: wallMs / n,
      cpuMsPerLookup: (used.user + used.system) / 1000 / n,
      ...(threadUsed && { threadCpuMsPerLookup: (threadUsed.user + threadUsed.system) / 1000 / n }),
      wallMsPerSetup: setupWall / 100,
      cpuMsPerSetup: (setupUsed.user + setupUsed.system) / 1000 / 100,
    };
  }
  console.log(JSON.stringify(results));
} else {
  assert.equal(arm, undefined, "Expected baseline, candidate or no arm argument");
  const require = createRequire(new URL("../../packages/farm/package.json", import.meta.url));
  const { transformSync } = require("esbuild");
  const sizes = (sources) =>
    Object.fromEntries(
      Object.entries(sources).map(([arm, code]) => {
        const compact = transformSync(
          `export function create(routeSlots, isFarmRouteActive) { ${code}; return matchRouteSlots; }`,
          { format: "esm", minify: true },
        ).code;
        return [arm, { minified: Buffer.byteLength(compact), gzip: gzipSync(compact).length }];
      }),
    );
  const helperBytes = sizes(code);
  const helperBytesByScenario = Object.fromEntries(
    Object.entries(scenarioSources).map(([name, code]) => [name, sizes(code)]),
  );
  const loadBefore = os.loadavg(),
    pairs = [];
  for (let i = 0; i < 7; i++) {
    const pair = {};
    for (const name of i % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {
        encoding: "utf8",
      });
      if (child.status !== 0) throw new Error(child.stderr || child.stdout);
      pair[name] = JSON.parse(child.stdout);
    }
    pairs.push(pair);
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.keys(selected).map((scenario) => [
      scenario,
      Object.fromEntries(
        ["baseline", "candidate"].map((arm) => [
          arm,
          Object.fromEntries(
            Object.keys(pairs[0][arm][scenario]).map((metric) => [
              metric,
              median(pairs.map((pair) => pair[arm][scenario][metric])),
            ]),
          ),
        ]),
      ),
    ]),
  );
  const hash = (input) => createHash("sha256").update(input).digest("hex");
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        generatedRuntimeHash: hash(code.candidate),
        baselineRuntimeHash: hash(code.baseline),
        baselineMode,
        scenarioRuntimeHashes: Object.fromEntries(
          Object.entries(scenarioSources).map(([name, code]) => [
            name,
            Object.fromEntries(Object.entries(code).map(([arm, code]) => [arm, hash(code)])),
          ]),
        ),
        runnerHash: hash(readFileSync(fileURLToPath(import.meta.url))),
        routerHash: hash(
          readFileSync(new URL("../../packages/farm/dist/router.mjs", import.meta.url)),
        ),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0]?.model,
        loadBefore,
        loadAfter: os.loadavg(),
        warmups,
        iterations,
        methodology: `Seven alternating fresh-process pairs. Actual generated matcher/selector versus selector from ${baselineMode === "owners" ? "b85aee16 (prepared inputs)" : "72cdabb6 (unprepared inputs)"}. Same real owner-prefix matcher in both arms. Complete results and hidden capture descriptors checked outside timing; checksum consumed during timing. Median of process means, warmup per scenario; setup separately (100 creations after 20 warmups). Build-time eligibility and factory compilation excluded. No SSR/HTTP/framework-ranking claim. No-slot control uses more iterations by default. Per-scenario hashes identify specialized emitted code.`,
        helperBytes,
        helperBytesByScenario,
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
