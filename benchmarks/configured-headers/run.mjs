import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
function generate(name) {
  const start = source.indexOf(`export function ${name}(): string {`);
  const marker = "\n`.trim();\n}";
  const end = source.indexOf(marker, start);
  assert.ok(start >= 0 && end > start, name);
  return new Function(
    source
      .slice(start, end + marker.length)
      .replace("export ", "")
      .replace("(): string {", "() {") + `\nreturn ${name}();`,
  )();
}
const matcher = generate("generateRuntimePathMatcherSource");
const candidate = generate("generateConfiguredResponseHeadersRuntimeSource");
const preparationEnd = candidate.indexOf("function getConfiguredSetCookieHeaders");
assert.ok(preparationEnd > 0);
const preparedMatch = `    const matched = headerRoute.prepared
      ? matchPreparedRuntimePageSegments(headerRoute.prepared, pathnameSegments)
      : matchRuntimePathSegments(headerRoute.segments, pathnameSegments);
    if (!matched) continue;`;
assert.ok(candidate.includes(preparedMatch));
// Restore the original per-rule string matcher. Header application is identical.
const baseline = candidate
  .slice(preparationEnd)
  .replace("  if (preparedHeaderRoutes.length === 0) return response;\n", "")
  .replace("  const pathnameSegments = splitRuntimePath(pathname).map(decodeRouteSegment);\n", "")
  .replace(
    "for (const headerRoute of preparedHeaderRoutes)",
    "for (const headerRoute of configuredHeaderRoutes)",
  )
  .replace(
    preparedMatch,
    "    if (!matchRuntimePathPattern(headerRoute.source, pathname)) continue;",
  );
assert.ok(!baseline.includes("preparedHeaderRoutes"));
const sources = { baseline, candidate };
const factories = Object.fromEntries(
  Object.entries(sources).map(([arm, code]) => [
    arm,
    new Function(
      "configuredHeaderRoutes",
      `${matcher}\n${code}\nreturn applyConfiguredResponseHeaders;`,
    ),
  ]),
);
const exact = (source) => ({
  source,
  headers: [{ key: "Cache-Control", value: "private, no-store" }],
});
const scenarios = {
  empty: { routes: [], pathname: "/target", expected: null },
  root: { routes: [exact("/")], pathname: "/", expected: "private, no-store" },
  rootAlreadySet: {
    routes: [exact("/")],
    pathname: "/",
    expected: "private, no-store",
    existing: true,
  },
  dynamic: { routes: [exact("/page/:id")], pathname: "/page/one", expected: "private, no-store" },
  exact32: {
    routes: Array.from({ length: 32 }, (_, i) => exact(`/page/${i}`)),
    pathname: "/page/31",
    expected: "private, no-store",
  },
  miss32: {
    routes: Array.from({ length: 32 }, (_, i) => exact(`/page/${i}`)),
    pathname: "/other/no-match",
    expected: null,
  },
  fallback: {
    routes: [exact("/a/[...rest]/end"), exact("/a/:id"), exact("/a/[[...rest]]")],
    pathname: "/a/%2541/%2F/end/",
    expected: "private, no-store",
  },
  malformed32: {
    routes: Array.from({ length: 32 }, (_, i) => exact(`/page/${i}`)),
    pathname: "/other/%zz",
    expected: null,
  },
};
const warmups = 2000,
  iterations = 10000,
  batches = 5,
  rounds = 5;
const arm = process.argv[2];
if (arm) {
  assert.ok(arm in factories);
  const scenario = scenarios[process.argv[3]];
  assert.ok(scenario);
  const input = new Response("unchanged 🌱", {
    status: 201,
    headers: scenario.existing ? { "cache-control": scenario.expected } : {},
  });
  for (const name of Object.keys(factories)) {
    const output = factories[name](scenario.routes)(input, scenario.pathname);
    assert.equal(output.status, 201);
    assert.equal(output.body, input.body);
    assert.equal(output.headers.get("cache-control"), scenario.expected);
    if (scenario.existing || scenario.expected === null) assert.equal(output, input);
  }
  const run = factories[arm](scenario.routes);
  for (let i = 0; i < warmups; i++) run(input, scenario.pathname);
  const samples = [];
  for (let batch = 0; batch < batches; batch++) {
    let last;
    const cpu = process.cpuUsage(),
      start = performance.now();
    for (let i = 0; i < iterations; i++) last = run(input, scenario.pathname);
    const wallUs = ((performance.now() - start) * 1000) / iterations,
      used = process.cpuUsage(cpu);
    assert.equal(last.headers.get("cache-control"), scenario.expected);
    samples.push({ wallUs, cpuUs: (used.user + used.system) / iterations });
  }
  for (let i = 0; i < 20; i++) factories[arm](scenario.routes);
  const instances = Array.from({ length: 1000 });
  const start = performance.now();
  for (let i = 0; i < instances.length; i++) instances[i] = factories[arm](scenario.routes);
  const setupUs = ((performance.now() - start) * 1000) / instances.length;
  assert.notEqual(instances[0], instances.at(-1));
  assert.equal(
    instances.at(-1)(input, scenario.pathname).headers.get("cache-control"),
    scenario.expected,
  );
  console.log(JSON.stringify({ samples, setupUs }));
} else {
  const require = createRequire(new URL("../../packages/farm/package.json", import.meta.url));
  const { transformSync } = require("esbuild");
  const sizes = Object.fromEntries(
    Object.entries(sources).map(([name, code]) => {
      const minified = transformSync(`${matcher}\n${code}`, { minify: true }).code;
      return [
        name,
        { minifiedBytes: Buffer.byteLength(minified), gzipBytes: gzipSync(minified).length },
      ];
    }),
  );
  const loadBefore = os.loadavg(),
    pairs = [];
  for (let round = 0; round < rounds; round++)
    for (const scenario of Object.keys(scenarios)) {
      const pair = { round, scenario };
      for (const name of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const child = spawnSync(
          process.execPath,
          [fileURLToPath(import.meta.url), name, scenario],
          { encoding: "utf8", timeout: 60000 },
        );
        assert.equal(child.status, 0, child.stderr || child.stdout);
        pair[name] = JSON.parse(child.stdout);
      }
      pairs.push(pair);
    }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.keys(scenarios).map((scenario) => [
      scenario,
      Object.fromEntries(
        Object.keys(factories).map((name) => [
          name,
          {
            wallUs: median(
              pairs
                .filter((p) => p.scenario === scenario)
                .map((p) => p[name].samples.reduce((sum, s) => sum + s.wallUs, 0) / batches),
            ),
            setupUs: median(
              pairs.filter((p) => p.scenario === scenario).map((p) => p[name].setupUs),
            ),
          },
        ]),
      ),
    ]),
  );
  const hash = (input) => createHash("sha256").update(input).digest("hex");
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0].model,
        loadBefore,
        loadAfter: os.loadavg(),
        sourceHash: hash(source),
        runnerHash: hash(readFileSync(fileURLToPath(import.meta.url))),
        warmups,
        iterations,
        batches,
        rounds,
        sizes,
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
