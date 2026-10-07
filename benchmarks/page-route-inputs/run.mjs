// Generated page-selector diagnostic, not HTTP/SSR or a framework comparison.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const emit = (raw) => new Function("return `" + raw + "`;")();
const generation = source.indexOf("export function generateRuntimePathMatcherSource(): string");
const matcherStart = source.indexOf("return `", generation) + 8;
const matcherEnd = source.indexOf("`.trim();", matcherStart);
const tableStart = source.indexOf("const exactPageRoutes = new Map();");
const tableEnd = source.indexOf("// Layout routes bundled", tableStart);
const selectorStart = source.indexOf("function matchPageRoute(pathname) {");
const selectorEnd = source.indexOf("\n}", selectorStart) + 2;
assert.ok(
  generation > 0 &&
    matcherEnd > matcherStart &&
    tableEnd > tableStart &&
    selectorEnd > selectorStart,
);
const matcher = emit(source.slice(matcherStart, matcherEnd));
const table = emit(source.slice(tableStart, tableEnd));
const selector = emit(source.slice(selectorStart, selectorEnd));
const boundary =
  "  return matchRuntimePathSegments(patternSegments, pathnameSegments);\n}\n\nfunction matchRuntimePathSegments(patternSegments, pathnameSegments) {\n";
assert.ok(matcher.includes(boundary));
assert.ok(
  table.includes("patternPageRoutes.push({ route, segments: splitRuntimePath(route.pattern) });"),
);
assert.ok(selector.includes("matchRuntimePathSegments(segments, pathnameSegments)"));
// Restore the pre-change preparation boundary, leaving the matching algorithm
// identical and avoiding an extra wrapper call in the baseline.
const baselineMatcher = matcher.replace(boundary, "");
assert.ok(!baselineMatcher.includes("matchRuntimePathSegments"));
const baselineTable = table.replace(
  "patternPageRoutes.push({ route, segments: splitRuntimePath(route.pattern) });",
  "patternPageRoutes.push(route);",
);
const baselineSelector = `function matchPageRoute(pathname) {
  const exactRoute = exactPageRoutes.get(normalizeRuntimePath(pathname));
  if (exactRoute) return { route: exactRoute, params: {} };
  for (const route of patternPageRoutes) {
    const params = matchRuntimePathPattern(route.pattern, pathname);
    if (params !== null) return { route, params };
  }
  return null;
}`;
const code = {
  baseline: baselineMatcher + baselineTable + baselineSelector,
  candidate: matcher + table + selector,
};
const factories = Object.fromEntries(
  Object.entries(code).map(([arm, code]) => [
    arm,
    new Function(
      "pageRoutes",
      "genericPattern",
      code +
        `;
      if (genericPattern === undefined) return matchPageRoute;
      return pathname => {
        const params = matchRuntimePathPattern(genericPattern, pathname);
        return params === null ? null : { route: pageRoutes[0], params };
      };`,
    ),
  ]),
);
const routes = (patterns) => patterns.map((pattern, id) => ({ pattern, id }));
const dynamic100 = routes(Array.from({ length: 100 }, (_, i) => `/route${i}/[id]`));
const scenarios = {
  staticHit: { routes: routes(["/", "/about"]), paths: ["/", "/about/"] },
  staticMiss: { routes: routes(["/", "/about"]), paths: ["/missing", "/missing/child"] },
  singleDynamic: { routes: routes(["/users/[id]"]), paths: ["/users/a%252Fb", "/users/%ZZ"] },
  late100: { routes: dynamic100, paths: ["/route99/a%252Fb", "/route98/value"] },
  miss100: { routes: dynamic100, paths: ["/missing/value", "/missing/other"] },
  malformedMiss100: { routes: dynamic100, paths: ["/missing/%ZZ", "/missing/%E0%A4"] },
  catchAll: {
    routes: routes(["/docs/:a*/x/:b*/end", "/docs/[[...slug]]"]),
    paths: ["/docs/a%2Fb/x/c/end", "/docs/a/b/missing"],
  },
  genericControl: {
    routes: routes(["/users/[id]"]),
    paths: ["/users/a%252Fb", "/users/value"],
    genericPattern: "/users/[id]",
  },
};
const scenarioName = process.env.FARM_PAGE_ROUTE_SCENARIO;
assert.ok(scenarioName === undefined || Object.hasOwn(scenarios, scenarioName), "Unknown scenario");
const selectedScenarios = scenarioName ? { [scenarioName]: scenarios[scenarioName] } : scenarios;
const count = (name, fallback) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
};
const signature = (result) =>
  result && {
    route: result.route,
    params: result.params,
    captures: Object.getOwnPropertySymbols(result.params).map((key) => [
      key.description,
      Object.getOwnPropertyDescriptor(result.params, key),
    ]),
  };
const warmups = count("FARM_PAGE_ROUTE_WARMUPS", 1000),
  iterations = count("FARM_PAGE_ROUTE_ITERATIONS", 10000);
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const results = {};
  for (const [name, { routes, paths, genericPattern }] of Object.entries(selectedScenarios)) {
    assert.equal(iterations % paths.length, 0, "Iterations must cover complete path cycles");
    const before = factories.baseline(routes, genericPattern),
      after = factories.candidate(routes, genericPattern);
    for (const pathname of paths) {
      assert.deepEqual(signature(after(pathname)), signature(before(pathname)));
      if (before(pathname)) assert.equal(after(pathname).route, before(pathname).route);
    }
    const expected =
      (iterations / paths.length) *
      paths.reduce((sum, pathname) => sum + (before(pathname)?.route.id ?? -1), 0);
    const select = arm === "baseline" ? before : after;
    for (let i = 0; i < warmups; i++) select(paths[i % paths.length]);
    let checksum = 0;
    const threadCpu = process.threadCpuUsage?.();
    const cpu = process.cpuUsage(),
      begin = performance.now();
    for (let i = 0; i < iterations; i++)
      checksum += select(paths[i % paths.length])?.route.id ?? -1;
    const wall = performance.now() - begin,
      used = process.cpuUsage(cpu);
    const threadUsed = threadCpu && process.threadCpuUsage(threadCpu);
    assert.equal(checksum, expected);
    for (let i = 0; i < 20; i++) factories[arm](routes, genericPattern);
    const setupCpu = process.cpuUsage(),
      setupBegin = performance.now();
    let fresh;
    for (let i = 0; i < 100; i++) fresh = factories[arm](routes, genericPattern);
    const setupWall = performance.now() - setupBegin,
      setupUsed = process.cpuUsage(setupCpu);
    assert.deepEqual(signature(fresh(paths[0])), signature(before(paths[0])));
    results[name] = {
      wallMsPerLookup: wall / iterations,
      cpuMsPerLookup: (used.user + used.system) / 1000 / iterations,
      ...(threadUsed && {
        threadCpuMsPerLookup: (threadUsed.user + threadUsed.system) / 1000 / iterations,
      }),
      wallMsPerSetup: setupWall / 100,
      cpuMsPerSetup: (setupUsed.user + setupUsed.system) / 1000 / 100,
    };
  }
  console.log(JSON.stringify(results));
} else {
  const require = createRequire(new URL("../../packages/farm/package.json", import.meta.url));
  const { transformSync } = require("esbuild");
  const helperBytes = Object.fromEntries(
    Object.entries(code).map(([arm, code]) => {
      const compact = transformSync(
        `export function create(pageRoutes) { ${code}; return matchPageRoute; }`,
        { format: "esm", minify: true },
      ).code;
      return [arm, { minified: Buffer.byteLength(compact), gzip: gzipSync(compact).length }];
    }),
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
    Object.keys(selectedScenarios).map((scenario) => [
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
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        generatedRuntimeHash: createHash("sha256").update(code.candidate).digest("hex"),
        runnerHash: createHash("sha256")
          .update(readFileSync(fileURLToPath(import.meta.url)))
          .digest("hex"),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0]?.model,
        loadBefore,
        loadAfter: os.loadavg(),
        scenarios: Object.keys(selectedScenarios),
        warmups,
        iterations,
        methodology: `Seven alternating fresh-process pairs; ${warmups} warmups and ${iterations} lookups per arm/scenario. Actual emitted matcher/table/selector; baseline restores the old preparation boundary without modifying the algorithm. Route identity, params and hidden capture descriptors checked outside timing. Setup (100 creations after 20 warmups) measured separately. Selector-only, not SSR/HTTP/application performance.`,
        helperBytes,
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
