// Production layout selection only: not SSR/HTTP latency or a framework comparison.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createFarmLayoutSelector } from "../../packages/farm/dist/internal/production-runtime.mjs";
import { isFarmRouteActive } from "../../packages/farm/dist/router.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const start = source.lastIndexOf("function getApplicableLayouts(pathname) {");
const end = source.indexOf("\n}", start) + 2;
assert.ok(start > 0 && end > start);
const setup = "const selectApplicableLayouts = createFarmLayoutSelector(layoutRoutes);";
assert.ok(source.includes(setup));
const candidate = setup + new Function(`return \`${source.slice(start, end)}\`;`)();
// The selector on main at b9897677: sorting was already removed. Both arms use
// the same unchanged router primitives; this isolates pattern preparation.
const baseline = `function getApplicableLayouts(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  for (const layout of layoutRoutes) {
    if (layout.pattern === '/' || isFarmRouteActive(layout.pattern, normalizedPath, { exact: false })) {
      applicable.push(layout);
    }
  }
  return applicable;
}`;
const compile = (code) =>
  new Function(
    "layoutRoutes",
    "isFarmRouteActive",
    "createFarmLayoutSelector",
    code + "; return getApplicableLayouts;",
  );
const factories = { baseline: compile(baseline), candidate: compile(candidate) };
const create = (arm, layouts) =>
  factories[arm](layouts, isFarmRouteActive, createFarmLayoutSelector);
const prepare = (patterns) =>
  patterns
    .map((pattern, id) => ({ pattern, id }))
    .sort(
      (a, b) =>
        a.pattern.split("/").filter(Boolean).length - b.pattern.split("/").filter(Boolean).length,
    );
const nested = Array.from(
  { length: 16 },
  (_, i) => "/" + Array.from({ length: i }, (_, n) => "level" + n).join("/"),
);
const table = prepare([...nested, ...Array.from({ length: 84 }, (_, i) => "/other" + i)]);
const scenarios = {
  root: { layouts: prepare(["/"]), paths: ["/", "/other"] },
  nested16: { layouts: prepare(nested), paths: [nested.at(-1), nested.at(-2) + "/leaf"] },
  table100: { layouts: table, paths: [nested.at(-1), nested.at(-2) + "/leaf"] },
  table100Miss: { layouts: table, paths: ["/missing", "/another-miss"] },
  mixed: {
    layouts: prepare(["/", "/docs", "/docs/[id]", "/docs/[[...slug]]", "/café", "/(group)"]),
    paths: ["/docs/a%2Fb", "/docs/%ZZ/leaf", "/docs", "/caf%C3%A9/leaf"],
  },
};
const warmups = 1000;
const iterations = 5000;
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const results = {};
  for (const [name, { layouts, paths }] of Object.entries(scenarios)) {
    const before = create("baseline", layouts),
      after = create("candidate", layouts);
    for (const pathname of paths) assert.deepEqual(after(pathname), before(pathname));
    const expected =
      (iterations / paths.length) *
      paths.reduce((sum, pathname) => sum + before(pathname).length, 0);
    const select = arm === "baseline" ? before : after;
    for (let i = 0; i < warmups; i++) select(paths[i % paths.length]);
    let count = 0;
    const cpu = process.cpuUsage(),
      begin = performance.now();
    for (let i = 0; i < iterations; i++) count += select(paths[i % paths.length]).length;
    const wallMs = performance.now() - begin,
      usedCpu = process.cpuUsage(cpu);
    assert.equal(count, expected);
    // Report the cold-start tradeoff separately from request work.
    for (let i = 0; i < 20; i++) create(arm, layouts);
    const setupCpu = process.cpuUsage(),
      setupBegin = performance.now();
    let fresh;
    for (let i = 0; i < 100; i++) fresh = create(arm, layouts);
    const setupWall = performance.now() - setupBegin,
      setupUsed = process.cpuUsage(setupCpu);
    assert.deepEqual(fresh(paths[0]), before(paths[0]));
    results[name] = {
      wallMsPerLookup: wallMs / iterations,
      cpuMsPerLookup: (usedCpu.user + usedCpu.system) / 1000 / iterations,
      wallMsPerSetup: setupWall / 100,
      cpuMsPerSetup: (setupUsed.user + setupUsed.system) / 1000 / 100,
    };
  }
  console.log(JSON.stringify(results));
} else {
  const require = createRequire(new URL("../../packages/farm/package.json", import.meta.url));
  const { buildSync } = require("esbuild");
  const bundle = (contents) =>
    buildSync({
      stdin: { contents, resolveDir: root, sourcefile: "layout-diagnostic.mjs" },
      bundle: true,
      write: false,
      minify: true,
      format: "esm",
      platform: "neutral",
    }).outputFiles[0].contents;
  const sizes = {};
  for (const [name, code] of Object.entries({ baseline, candidate })) {
    const bytes = bundle(`import { isFarmRouteActive } from './packages/farm/src/router.ts';
      import { createFarmLayoutSelector } from './packages/farm/src/routing/layout-selector.ts';
      export function create(layoutRoutes) { ${code}; return getApplicableLayouts; }`);
    sizes[name] = { bundledBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }
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
    Object.keys(scenarios).map((scenario) => [
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
  const inputs = [
    "packages/farm/src/nitro/universal-build.ts",
    "packages/farm/src/router.ts",
    "packages/farm/src/routing/matcher.ts",
    "packages/farm/src/routing/layout-selector.ts",
    "benchmarks/layout-matching/run.mjs",
  ];
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        sourceHashes: Object.fromEntries(
          inputs.map((file) => [
            file,
            createHash("sha256")
              .update(readFileSync(new URL("../../" + file, import.meta.url)))
              .digest("hex"),
          ]),
        ),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0]?.model,
        loadBefore,
        loadAfter: os.loadavg(),
        methodology:
          "Seven alternating fresh-process pairs; 1000 warmups and 5000 lookups per arm/scenario. Actual emitted selector plus built internal helper versus pre-preparation selector using unchanged public router. Correctness outside timing; separate 100-iteration setup measurement. Helper sizes include transitive matcher code, not application bundles. No concurrent builds/tests in this checkout; shared host may contend. Not SSR, HTTP, hydration or a cross-framework comparison.",
        helperBytes: sizes,
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
