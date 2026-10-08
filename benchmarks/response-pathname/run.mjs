// Node 24.11+: generated response preparation, not rendering or HTTP latency.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

const source = readFileSync(
  new URL("../../packages/farm/src/nitro/universal-build.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../../packages/farm/src/preload.ts", import.meta.url),
  "utf8",
);
const helpers = new Function(
  "console",
  stripTypeScriptTypes(preloadSource).replace(/^export /gm, "") +
    "\nreturn { manageFarmDocumentPreloads, manageFarmLinkHeaderPreloads, reportFarmPreloadWarnings };",
)({ warn() {} });
function generated(name, next) {
  const start = source.indexOf("export function " + name + "(");
  const end = source.indexOf("\nfunction " + next + "(", start);
  assert.ok(start >= 0 && end > start);
  return new Function(
    stripTypeScriptTypes(source.slice(start, end)).replace("export ", "") +
      "\nreturn " +
      name +
      "();",
  )();
}
const start = source.indexOf(
  "        const prepareResponse = async (runtimeRequest, responsePromise) => {",
);
const end = source.indexOf("        const runRequest = ", start);
assert.ok(start >= 0 && end > start);
const candidate =
  generated(
    "generateConfiguredResponseHeadersRuntimeSource",
    "parseRouteRenderingDirectiveFromDisk",
  ) +
  "\n" +
  generated("generatePreloadResponseRuntimeSource", "generateVirtualEntryCode") +
  "\n" +
  source.slice(start, end);
const guarded = /const routePathname = configuredHeaderRoutes.length > 0[\s\S]*?: undefined;/;
const warningContext =
  /reportFarmPreloadWarnings\(managed.warnings, managed.warnings.length > 0[\s\S]*?: undefined\);/g;
assert.ok(guarded.test(candidate));
assert.equal([...candidate.matchAll(warningContext)].length, 2);
const baseline = candidate
  .replace(
    guarded,
    "const routePathname = getFarmRoutePathname(new URL(runtimeRequest.url).pathname);",
  )
  .replace(warningContext, 'reportFarmPreloadWarnings(managed.warnings, "route " + pathname);')
  .replace(
    "applyFarmPreloadBudget(response, pathname, request)",
    "applyFarmPreloadBudget(response, pathname)",
  )
  .replace("            runtimeRequest,\n", "");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hints =
  '<link rel="preload" as="image" href="/first"><link rel="preload" as="image" href="/second">';
const scenarios = {
  json: { type: "application/json", body: "json-" },
  bufferedHtml: { type: "text/html", body: "<p>hello 🌱</p>", marker: "none" },
  unknownHtml: { type: "text/html", body: "<p>hello 🌱</p>" },
  configuredHeaders: { type: "text/html", body: "<p>hello 🌱</p>", marker: "none", headers: true },
  bufferedWarnings: { type: "text/html", body: hints, marker: "1" },
  headerWarnings: {
    type: "text/html",
    body: "<p>hello 🌱</p>",
    link: "</first>; rel=preload; as=image, </second>; rel=preload; as=image",
  },
  configuredWarnings: { type: "text/html", body: hints, marker: "1", headers: true },
};
function runtime(arm, scenario, URLConstructor = URL) {
  return new Function(
    "URL",
    "getFarmRoutePathname",
    "configuredHeaderRoutes",
    "matchRuntimePathPattern",
    "appendFarmLinkHeader",
    "applyFarmCspNonceToResponse",
    "farmSecurityConfig",
    "manageFarmDocumentPreloads",
    "manageFarmLinkHeaderPreloads",
    "farmPreloadConfig",
    "reportFarmPreloadWarnings",
    (arm === "baseline" ? baseline : candidate) + "\nreturn prepareResponse;",
  )(
    URLConstructor,
    (pathname) => pathname.replace(/^\/base/, "") || "/",
    scenario.headers
      ? [{ source: "/target", headers: [{ key: "Cache-Control", value: "private, no-store" }] }]
      : [],
    (pattern, pathname) => pattern === pathname,
    (headers, value) => headers.append("Link", value),
    (response) => response,
    { csp: false },
    helpers.manageFarmDocumentPreloads,
    helpers.manageFarmLinkHeaderPreloads,
    { mode: "enforce", maxImages: 1, maxFonts: 2 },
    helpers.reportFarmPreloadWarnings,
  );
}
function response(scenario, index) {
  return new Response(scenario.body + index, {
    headers: {
      "content-type": scenario.type,
      ...(scenario.marker && { "x-farm-preload-buffered": scenario.marker }),
      ...(scenario.link && { link: scenario.link }),
      "set-cookie": "session=1; Path=/; HttpOnly",
    },
  });
}

const arm = process.argv[2];
if (arm) {
  assert.ok(["baseline", "candidate"].includes(arm));
  const name = process.argv[3],
    scenario = scenarios[name];
  assert.ok(scenario);
  const request = new Request("https://farm.test/base/target?q=one&q=two");
  let parses = 0;
  const counted = runtime(
    arm,
    scenario,
    new Proxy(URL, {
      construct(target, args) {
        parses++;
        return Reflect.construct(target, args);
      },
    }),
  );
  const expected = await counted(request, response(scenario, "REFERENCE"));
  const signature = { headers: [...expected.headers], body: await expected.text() };
  assert.equal(
    signature.body,
    (scenario.marker === "1" ? '<link rel="preload" as="image" href="/first">' : scenario.body) +
      "REFERENCE",
  );
  assert.equal(
    expected.headers.get("cache-control"),
    scenario.headers ? "private, no-store" : null,
  );
  assert.equal(expected.headers.get("set-cookie"), "session=1; Path=/; HttpOnly");
  assert.equal(expected.headers.get("x-farm-preload-buffered"), null);
  const run = runtime(arm, scenario);
  const perform = async (index) => {
    const result = await run(request, response(scenario, index));
    return { headers: result.headers, body: await result.text(), index };
  };
  const validate = (result) => {
    assert.deepEqual([...result.headers], signature.headers);
    assert.equal(result.body, signature.body.replace(/REFERENCE$/, String(result.index)));
  };
  for (let i = 0; i < 500; i++) validate(await perform(i));
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    const results = [],
      cpu = process.cpuUsage(),
      begin = performance.now();
    for (let i = 0; i < 2000; i++) results.push(await perform(i));
    const wallUs = ((performance.now() - begin) * 1000) / results.length,
      used = process.cpuUsage(cpu);
    samples.push({ wallUs, cpuUs: (used.user + used.system) / results.length });
    for (const result of results) validate(result);
  }
  console.log(JSON.stringify({ name, parses, signature, samples }));
} else {
  const pairs = [],
    loadBefore = os.loadavg();
  for (let round = 0; round < 5; round++)
    for (const name of Object.keys(scenarios)) {
      const pair = { round: round + 1, scenario: name };
      for (const current of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const child = spawnSync(process.execPath, [import.meta.filename, current, name], {
          encoding: "utf8",
          timeout: 60000,
        });
        assert.equal(child.status, 0, child.stdout + child.stderr);
        pair[current] = JSON.parse(child.stdout);
      }
      assert.deepEqual(pair.baseline.signature, pair.candidate.signature);
      assert.equal(pair.baseline.parses, 1);
      assert.equal(
        pair.candidate.parses,
        ["json", "bufferedHtml", "unknownHtml"].includes(name) ? 0 : 1,
      );
      pairs.push(pair);
    }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    Object.keys(scenarios).map((name) => [
      name,
      Object.fromEntries(
        ["baseline", "candidate"].map((current) => [
          current,
          Object.fromEntries(
            ["wallUs", "cpuUs"].map((metric) => [
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
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceHash: hash(source),
        preloadHash: hash(preloadSource),
        runnerHash: hash(readFileSync(import.meta.filename)),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0].model,
        loadBefore,
        loadAfter: os.loadavg(),
        methodology:
          "Generated response-preparation helpers and real preload manager/reporter; identity CSP-disabled adapter, exact header matcher and basePath normalizer. Five alternating fresh-process pairs; 500 warmups, five batches of 2000 responses. Includes response creation/preparation/body reads; all bodies and headers checked outside timing. URL counts separate. Microseconds per helper pipeline, not SSR/network latency or published scores.",
        generatedBytes: {
          baseline: { raw: Buffer.byteLength(baseline), gzip: gzipSync(baseline).length },
          candidate: { raw: Buffer.byteLength(candidate), gzip: gzipSync(candidate).length },
        },
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
