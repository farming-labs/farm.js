// Build core with build:runtime, then run this diagnostic with Node 24.11+.
// Measures hydration planning, not a full build, request latency, or published score.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const dist = new URL("../../packages/farm/dist/", import.meta.url);
const modules = fs
  .readdirSync(dist)
  .filter((name) => name.endsWith(".mjs"))
  .map((name) => {
    const url = new URL(name, dist);
    return { url, source: fs.readFileSync(url, "utf8") };
  })
  .filter(({ source }) => source.includes("function getClientModuleHydrationPlan("));
assert.equal(modules.length, 1, "Build the core runtime first");
const [{ url: entry, source }] = modules;
const readBlock =
  '  const resolvedPath = resolveModuleSourcePath(modulePath, root);\n  const content = readIfExists(resolvedPath ?? "");\n  const parsed = parseClientModuleMetadata(content, true);\n';
const returnLine = '  if (mode === "off" && !asyncOwner) return emptyPlan();';
assert.equal(source.split(readBlock).length, 2);
assert.equal(source.split(returnLine).length, 2);
assert.ok(
  source.indexOf(readBlock) > source.indexOf(returnLine),
  "Build the candidate runtime first",
);
const baseline = source
  .replace(readBlock, "")
  .replace(
    "  const metadata = getClientModuleMetadata(modulePath, root);\n",
    "  const metadata = getClientModuleMetadata(modulePath, root);\n" + readBlock,
  );
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scenarios = {
  staticOff: { file: "static.tsx", mode: "off" },
  clientOff: { file: "owner.tsx", mode: "off" },
  analyze: { file: "owner.tsx", mode: "analyze" },
  enabled: { file: "owner.tsx", mode: "enabled" },
  asyncOff: { file: "async.tsx", mode: "off" },
};
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const name = process.argv[3],
    root = process.argv[4];
  assert.ok(Object.hasOwn(scenarios, name));
  assert.ok(path.isAbsolute(root));
  let loaded = false;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== entry.href) return result;
      assert.equal(String(result.source), source);
      loaded = true;
      return { ...result, source: arm === "baseline" ? baseline : source };
    },
  });
  const { getClientModuleHydrationPlan } = await import(entry.href);
  assert.ok(loaded);
  const scenario = scenarios[name];
  const plan = () =>
    getClientModuleHydrationPlan(path.join(root, scenario.file), root, scenario.mode, {
      asyncOwnerIslands: true,
    });
  const expected = plan();
  assert.equal(expected.hasIsolatedClientBoundaries, name === "enabled" || name === "asyncOff");
  if (name === "asyncOff") assert.equal(expected.asyncOwnerIslands, true);
  const originalRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (...args) {
    if (String(args[0]).startsWith(root + path.sep)) reads++;
    return Reflect.apply(originalRead, this, args);
  };
  try {
    assert.deepEqual(plan(), expected);
  } finally {
    fs.readFileSync = originalRead;
  }
  for (let i = 0; i < 200; i++) assert.deepEqual(plan(), expected);
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    const results = [];
    const cpu = process.cpuUsage(),
      begin = performance.now();
    for (let i = 0; i < 1000; i++) results.push(plan());
    const wallMs = (performance.now() - begin) / 1000;
    const used = process.cpuUsage(cpu);
    samples.push({ wallMs, cpuMs: (used.user + used.system) / 1_000_000 });
    for (const result of results) assert.deepEqual(result, expected);
  }
  console.log(
    JSON.stringify({
      arm,
      scenario: name,
      sourceHash: hash(source),
      reads,
      plan: expected,
      samples,
    }),
  );
} else {
  assert.equal(arm, undefined);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-hydration-planning-")));
  const pairs = [],
    loadBefore = os.loadavg();
  try {
    fs.writeFileSync(
      path.join(root, "static.tsx"),
      "export default function Page() { return <main>Static</main>; }",
    );
    fs.writeFileSync(
      path.join(root, "leaf.tsx"),
      '"use client"; export default function Leaf() { return <button>Click</button>; }',
    );
    fs.writeFileSync(
      path.join(root, "owner.tsx"),
      'import Leaf from "./leaf"; export default function Page() { return <main><Leaf /></main>; }',
    );
    fs.writeFileSync(
      path.join(root, "async.tsx"),
      'import Leaf from "./leaf"; export default async function Page() { return <main><Leaf /></main>; }',
    );
    for (let round = 0; round < 5; round++)
      for (const name of Object.keys(scenarios)) {
        const pair = { round: round + 1, scenario: name };
        for (const current of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
          const child = spawnSync(process.execPath, [import.meta.filename, current, name, root], {
            encoding: "utf8",
            timeout: 60000,
            env: {
              ...process.env,
              NODE_ENV: "production",
              NODE_OPTIONS: "",
              NODE_PATH: "",
              FARM_INTERNAL_BENCHMARK: "",
              FARM_INTERNAL_ISOLATED_HYDRATION_MAX_BOUNDARIES: "",
            },
          });
          assert.equal(child.status, 0, child.error?.message || child.stdout + child.stderr);
          pair[current] = JSON.parse(child.stdout);
          assert.equal(pair[current].sourceHash, hash(source));
        }
        assert.deepEqual(pair.baseline.plan, pair.candidate.plan);
        assert.equal(
          pair.baseline.reads - pair.candidate.reads,
          name.endsWith("Off") && name !== "asyncOff" ? 1 : 0,
        );
        pairs.push(pair);
      }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.keys(scenarios).map((name) => [
      name,
      Object.fromEntries(
        ["baseline", "candidate"].map((current) => [
          current,
          Object.fromEntries(
            ["wallMs", "cpuMs"].map((metric) => [
              metric,
              median(
                pairs
                  .filter((p) => p.scenario === name)
                  .map((p) => p[current].samples.reduce((sum, s) => sum + s[metric], 0) / 5),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        methodology:
          "Hydration planner only, warm OS filesystem cache; 5 alternating fresh-process pairs per scenario, 200 warmups and 5000 measured calls per process. Validation and read instrumentation outside timing. Baseline moves only the candidate's three read/parse statements back before the early return. Summary: median of process means. Not a full-build or framework ranking.",
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0].model,
        sourceHash: hash(source),
        runnerHash: hash(fs.readFileSync(pathToFileURL(import.meta.filename))),
        loadBefore,
        loadAfter: os.loadavg(),
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
