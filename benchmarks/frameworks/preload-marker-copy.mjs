// Diagnostic ablation of the preload marker-strip rebuild, not a cross-framework score.
// Build the maintained Farm fixture first. Requires Node 24.11+ (registerHooks).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";

const entry = new URL("./apps/farm/.farm/ssr/_virtual_farm-ssr-entry.js", import.meta.url);
const arm = process.argv[2];
const normalize = (html) =>
  html
    .replace(/data-rendered-at="\d+"/g, 'data-rendered-at="TIME"')
    .replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, "<time>TIME</time>");

if (arm === "baseline" || arm === "candidate") {
  process.env.NODE_ENV = "production";
  process.env.FARM_TELEMETRY_DISABLED = "1";
  let intercepted = false;
  let entrySha256;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== entry.href) return result;
      let source = String(result.source);
      entrySha256 = createHash("sha256").update(source).digest("hex");
      // The candidate builds the output first and edits the constructor's own
      // header copy. The baseline restores the explicit copy before building.
      const rebuild = /function rebuildFarmPreloadResponse\(response, body\) \{[\s\S]*?\n\}/g;
      assert.equal([...source.matchAll(rebuild)].length, 1, "build the candidate first");
      if (arm === "baseline")
        source = source.replace(
          rebuild,
          `function rebuildFarmPreloadResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("x-farm-preload-streaming");
  headers.delete("x-farm-preload-buffered");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}`,
        );
      intercepted = true;
      return { ...result, source };
    },
  });
  const mod = await import(entry.href);
  assert.ok(intercepted);
  await mod.farmProductionLifecycle.start();
  let expected, firstTimestamp, lastTimestamp;
  async function request() {
    const callbacks = [],
      pending = [];
    const response = await mod.fetch(
      new Request("http://localhost/", { headers: { "accept-encoding": "identity" } }),
      {
        onResponseFinished(callback) {
          callbacks.push(callback);
        },
        waitUntil(promise) {
          pending.push(promise);
        },
      },
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.ok(html.includes('data-item-count="120"'));
    assert.equal((html.match(/<li\b/g) || []).length, 120);
    assert.ok(!/\bpreload\b/i.test(html));
    assert.equal(response.headers.get("x-farm-preload-buffered"), null);
    expected ??= normalize(html);
    assert.equal(normalize(html), expected);
    lastTimestamp = html.match(/data-rendered-at="(\d+)"/)[1];
    firstTimestamp ??= lastTimestamp;
    for (const callback of callbacks) callback();
    await Promise.all(pending);
  }
  try {
    for (let i = 0; i < 1000; i++) await request();
    const samples = [];
    for (let batch = 0; batch < 10; batch++) {
      const cpu = process.cpuUsage(),
        start = performance.now();
      for (let i = 0; i < 300; i++) await request();
      const duration = performance.now() - start,
        used = process.cpuUsage(cpu);
      samples.push({ wallMs: duration / 300, cpuMs: (used.user + used.system) / 300000 });
    }
    assert.notEqual(firstTimestamp, lastTimestamp);
    console.log(
      JSON.stringify({
        arm,
        warmups: 1000,
        requests: 3000,
        samples,
        normalizedHtml: expected,
        entrySha256,
      }),
    );
  } finally {
    await mod.farmProductionLifecycle.close("benchmark-complete");
  }
} else {
  assert.equal(arm, undefined, "usage: node benchmarks/frameworks/preload-marker-copy.mjs");
  const rounds = [];
  const loadBefore = os.loadavg();
  for (let round = 0; round < 5; round++) {
    for (const current of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
      const child = spawnSync(process.execPath, [import.meta.filename, current], {
        encoding: "utf8",
        timeout: 90000,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) =>
              !/^(NODE_OPTIONS|NODE_ENV|NODE_PATH|FARM_|NITRO_|VITE_|PORT$|HOST$)/.test(name),
          ),
        ),
      });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      rounds.push({ round: round + 1, ...JSON.parse(child.stdout) });
    }
  }
  assert.ok(rounds.every((row) => row.normalizedHtml === rounds[0].normalizedHtml));
  assert.ok(
    rounds.every((row) => row.entrySha256 === rounds[0].entrySha256),
    "built entry changed mid-run",
  );
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
          "In-process SSR plus full body consumption and correctness validation; identity encoding; five alternating process pairs; median of round means. The page has no preload hints, so every request takes the proven preload-free path and its one marker-strip rebuild. Baseline restores the explicit Headers copy before that rebuild. Not network latency or a publishable comparison.",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
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
