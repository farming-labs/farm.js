// Production-selector diagnostic, not an end-to-end framework comparison.
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import { isFarmRouteActive } from "../../packages/farm/dist/router.mjs";
import { createFarmLayoutSelector } from "../../packages/farm/dist/internal/production-runtime.mjs";

const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const start = source.lastIndexOf("function getApplicableLayouts(pathname) {");
const end = source.indexOf("\n}", start) + 2;
assert.ok(start > 0 && end > start);
const candidate = new Function(`return \`${source.slice(start, end)}\`;`)();
assert.ok(!candidate.includes(".sort("), "Build the layout-order candidate first");
const oldSort = `applicable.sort((a, b) => {
    const depthA = a.pattern.split('/').filter(Boolean).length;
    const depthB = b.pattern.split('/').filter(Boolean).length;
    return depthA - depthB;
  });`;
const baseline = candidate.replace("return applicable;", oldSort + "\nreturn applicable;");
const prepare = (patterns) =>
  patterns
    .map((pattern, id) => ({ pattern, id }))
    .sort(
      (a, b) =>
        a.pattern.split("/").filter(Boolean).length - b.pattern.split("/").filter(Boolean).length,
    );
const nested = Array.from(
  { length: 16 },
  (_, index) => "/" + Array.from({ length: index }, (_, depth) => "level" + depth).join("/"),
);
const scenarios = {
  root: { layouts: prepare(["/"]), paths: ["/", "/other"] },
  nested16: { layouts: prepare(nested), paths: [nested.at(-1), nested.at(-2) + "/leaf"] },
  table100: {
    layouts: prepare([...nested, ...Array.from({ length: 84 }, (_, index) => "/other" + index)]),
    paths: [nested.at(-1), nested.at(-2) + "/leaf"],
  },
};
const create = (code, layouts) =>
  new Function(
    "layoutRoutes",
    "isFarmRouteActive",
    "selectApplicableLayouts",
    code + "; return getApplicableLayouts;",
  )(layouts, isFarmRouteActive, createFarmLayoutSelector(layouts));
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const results = {};
  for (const [name, { layouts, paths }] of Object.entries(scenarios)) {
    const before = create(baseline, layouts),
      after = create(candidate, layouts);
    for (const pathname of paths) assert.deepEqual(after(pathname), before(pathname));
    const select = arm === "baseline" ? before : after;
    const expectedCount =
      (5000 / paths.length) * paths.reduce((total, pathname) => total + after(pathname).length, 0);
    for (let index = 0; index < 1000; index++) select(paths[index % paths.length]);
    let count = 0;
    const cpu = process.cpuUsage(),
      begin = performance.now();
    for (let index = 0; index < 5000; index++) count += select(paths[index % paths.length]).length;
    const wallMs = performance.now() - begin,
      usedCpu = process.cpuUsage(cpu);
    assert.equal(count, expectedCount);
    results[name] = {
      wallMsPerLookup: wallMs / 5000,
      cpuMsPerLookup: (usedCpu.user + usedCpu.system) / 1000 / 5000,
    };
  }
  console.log(JSON.stringify(results));
} else {
  const require = createRequire(new URL("../../packages/farm/package.json", import.meta.url));
  const { transformSync } = require("esbuild");
  const compact = (code) => transformSync(code, { minify: true, format: "esm" }).code;
  const baselineCompact = compact(baseline),
    candidateCompact = compact(candidate);
  const loadBefore = os.loadavg();
  const pairs = [];
  for (let index = 0; index < 7; index++) {
    const pair = {};
    for (const name of index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {
        encoding: "utf8",
      });
      if (child.status !== 0) throw new Error(child.stderr || child.stdout);
      pair[name] = JSON.parse(child.stdout);
    }
    pairs.push(pair);
  }
  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const summary = Object.fromEntries(
    Object.keys(scenarios).map((scenario) => [
      scenario,
      Object.fromEntries(
        ["baseline", "candidate"].map((arm) => [
          arm,
          {
            medianWallMs: median(pairs.map((pair) => pair[arm][scenario].wallMsPerLookup)),
            medianCpuMs: median(pairs.map((pair) => pair[arm][scenario].cpuMsPerLookup)),
          },
        ]),
      ),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0]?.model,
        loadBefore,
        loadAfter: os.loadavg(),
        methodology:
          "Seven alternating fresh-process pairs; 1000 warmups and 5000 measured lookups per arm/scenario. Actual production selector and router; previous sort injected in memory. Correctness outside timing. Shared-host diagnostic, not request latency.",
        selectorBytes: {
          baseline: Buffer.byteLength(baselineCompact),
          candidate: Buffer.byteLength(candidateCompact),
          baselineGzip: gzipSync(baselineCompact).length,
          candidateGzip: gzipSync(candidateCompact).length,
        },
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
