// Build @farm.js/core, then: node benchmarks/request-tracing/run.mjs > /tmp/tracing.json
// Node 24.11+; diagnostic wrapper overhead, not SSR/network/application latency.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";

const entry = new URL("../../packages/farm/dist/observability.mjs", import.meta.url);
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  let moduleSha256;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (!url.startsWith(new URL("./", entry).href)) return result;
      let source = String(result.source);
      if (!source.includes("async function _runWithFarmRequestSpan(")) return result;
      assert.equal(moduleSha256, undefined, "expected a single tracing module");
      moduleSha256 = createHash("sha256").update(source).digest("hex");
      const prefix =
        /(async function _runWithFarmRequestSpan\(request, handler, options = \{\}\) \{\s*const startedAt = Date.now\(\);\s*)const url =[\s\S]*?;\s*const shouldTrace =[\s\S]*?;/;
      const match = source.match(prefix);
      assert.ok(
        match?.[0].includes("? new URL(request.url) : void 0"),
        "build the candidate runtime first",
      );
      if (arm === "baseline")
        source = source.replace(
          prefix,
          '$1const url = new URL(request.url);\nconst shouldTrace = tracingState.enabled && tracingState.spans.has("request") && !tracingState.ignorePaths.some((prefix) => url.pathname.startsWith(prefix));',
        );
      return { ...result, source };
    },
  });
  const { configureFarmObservability, runWithFarmRequestSpan } = await import(entry.href);
  assert.ok(moduleSha256);
  configureFarmObservability({ tracing: false });
  const request = new Request("https://farm.test/products/42?q=one");
  const response = new Response("ok", { status: 201 });
  const handler = () => response;
  const NativeURL = globalThis.URL;
  let allocations = 0,
    starts = 0,
    completes = 0;
  globalThis.URL = new Proxy(NativeURL, {
    construct(target, args, newTarget) {
      allocations++;
      return Reflect.construct(target, args, newTarget);
    },
  });
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        await runWithFarmRequestSpan(request, handler, {
          onStart() {
            starts++;
          },
          onComplete(status) {
            assert.equal(status, 201);
            completes++;
          },
        }),
        response,
      );
  } finally {
    globalThis.URL = NativeURL;
  }
  assert.equal(starts, 10);
  assert.equal(completes, 10);
  assert.equal(allocations, arm === "baseline" ? 20 : 10);
  for (let i = 0; i < 10000; i++) await runWithFarmRequestSpan(request, handler);
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    const cpu = process.cpuUsage(),
      start = performance.now();
    for (let i = 0; i < 50000; i++) await runWithFarmRequestSpan(request, handler);
    const elapsed = performance.now() - start,
      used = process.cpuUsage(cpu);
    samples.push({ wallMs: elapsed / 50000, cpuMs: (used.user + used.system) / 50000000 });
  }
  console.log(JSON.stringify({ arm, moduleSha256, urlsPerRequest: allocations / 10, samples }));
} else {
  assert.equal(arm, undefined, "usage: node benchmarks/request-tracing/run.mjs");
  const rounds = [],
    loadBefore = os.loadavg();
  for (let round = 0; round < 5; round++)
    for (const current of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const child = spawnSync(process.execPath, [import.meta.filename, current], {
        encoding: "utf8",
        timeout: 90000,
        env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
      });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      rounds.push({ round: round + 1, ...JSON.parse(child.stdout) });
    }
  assert.ok(rounds.every((row) => row.moduleSha256 === rounds[0].moduleSha256));
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    ["baseline", "candidate"].map((current) => [
      current,
      Object.fromEntries(
        ["wallMs", "cpuMs"].map((metric) => [
          metric,
          median(
            rounds
              .filter((row) => row.arm === current)
              .map(
                (row) =>
                  row.samples.reduce((sum, sample) => sum + sample[metric], 0) / row.samples.length,
              ),
          ),
        ]),
      ),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        provisional: true,
        methodology:
          "Untraced public request wrapper with a preconstructed Request/Response; 5 alternating process pairs, 10000 warmups and 250000 measured calls per process. URL probe runs separately before warmup. Baseline restores the previous URL/eligibility statements. Not SSR or network latency.",
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0].model,
        loadBefore,
        loadAfter: os.loadavg(),
        summary,
        rounds,
      },
      null,
      2,
    ),
  );
}
