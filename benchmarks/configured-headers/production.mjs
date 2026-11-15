// Full-body SSR diagnostic, not an HTTP benchmark or a cross-framework score.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { restoreUnpreparedHeaders, summarizePairs } from "./production-source.mjs";

const entry = new URL(
  "../frameworks/apps/farm/.farm/ssr/_virtual_farm-ssr-entry.js",
  import.meta.url,
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const warmups = 1000,
  iterations = 5000,
  rounds = 7;
const arms = ["baseline", "candidate", "controlA", "controlB"];
const arm = process.argv[2];
if (arm) {
  assert.ok(arms.includes(arm));
  process.env.NODE_ENV = "production";
  process.env.FARM_TELEMETRY_DISABLED = "1";
  let intercepted = 0,
    builtHash,
    loadedHash;
  // Install the same hook in every process. Both controls load identical code.
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== entry.href) return result;
      const source = String(result.source),
        baseline = restoreUnpreparedHeaders(source);
      builtHash = hash(source);
      const loaded = arm === "baseline" ? baseline : source;
      loadedHash = hash(loaded);
      intercepted++;
      return { ...result, source: loaded };
    },
  });
  const mod = await import(entry.href);
  assert.equal(intercepted, 1);
  const labels = Array.from(
    { length: 120 },
    (_, i) =>
      `<span>${i + 1}</span><strong>Benchmark item ${String(i + 1).padStart(3, "0")}</strong>`,
  );
  let signature;
  async function request() {
    const done = [],
      pending = [],
      before = Date.now(),
      start = performance.now();
    const response = await mod.fetch(
      new Request("http://localhost/", { headers: { "accept-encoding": "identity" } }),
      {
        onResponseFinished: (callback) => done.push(callback),
        waitUntil: (promise) => pending.push(promise),
      },
    );
    const body = await response.text();
    for (const callback of done) callback();
    await Promise.all(pending);
    const us = (performance.now() - start) * 1000,
      after = Date.now();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-encoding"), null);
    assert.deepEqual(
      [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]),
      labels,
    );
    assert.ok(body.includes('data-item-count="120"'));
    const timestamp = Number(body.match(/data-rendered-at="(\d+)"/)?.[1]);
    assert.ok(timestamp >= before && timestamp <= after);
    const normalized = body
      .replace(/data-rendered-at="\d+"/g, 'data-rendered-at="TIME"')
      .replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, "<time>TIME</time>");
    const current = { bodyHash: hash(normalized), headers: [...response.headers] };
    signature ??= current;
    assert.deepEqual(current, signature);
    return us;
  }
  await mod.farmProductionLifecycle.start();
  try {
    for (let i = 0; i < warmups; i++) await request();
    const samples = [];
    for (let batch = 0; batch < 10; batch++) {
      let sum = 0;
      for (let i = 0; i < iterations / 10; i++) sum += await request();
      samples.push(sum / (iterations / 10));
    }
    console.log(
      JSON.stringify({
        meanUs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        samples,
        signature,
        builtHash,
        loadedHash,
      }),
    );
  } finally {
    await mod.farmProductionLifecycle.close("benchmark-complete");
  }
} else {
  const loadBefore = os.loadavg(),
    pairs = [];
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(NODE_OPTIONS|NODE_ENV|NODE_PATH|FARM_|NITRO_|VITE_|PORT$|HOST$)/.test(name),
    ),
  );
  for (let round = 0; round < rounds; round++) {
    const pair = { round };
    const order =
      round % 2
        ? ["controlB", "candidate", "baseline", "controlA"]
        : ["controlA", "baseline", "candidate", "controlB"];
    for (const current of order) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), current], {
        encoding: "utf8",
        timeout: 60000,
        env,
      });
      assert.equal(child.status, 0, child.stderr + child.stdout);
      pair[current] = JSON.parse(child.stdout.trim().split("\n").at(-1));
      assert.equal(
        pair[current].builtHash,
        hash(readFileSync(entry)),
        "built entry changed mid-run",
      );
    }
    for (const current of arms) assert.deepEqual(pair[current].signature, pair.baseline.signature);
    assert.equal(pair.controlA.loadedHash, pair.controlB.loadedHash);
    assert.equal(pair.controlA.loadedHash, pair.candidate.loadedHash);
    assert.notEqual(pair.baseline.loadedHash, pair.candidate.loadedHash);
    pairs.push(pair);
  }
  assert.ok(pairs.every((pair) => pair.baseline.builtHash === pairs[0].baseline.builtHash));
  console.log(
    JSON.stringify(
      {
        provisional: true,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0].model,
        loadBefore,
        loadAfter: os.loadavg(),
        runnerHash: hash(readFileSync(fileURLToPath(import.meta.url))),
        warmups,
        iterations,
        rounds,
        methodology:
          "Seven alternating process groups, each with baseline/candidate and two identical-code controls. Full body consumption and lifecycle completion timed; every response validated outside timing. All samples retained. Same-code shifts reveal noise, not an optimization. Not network latency or a publishable cross-framework result.",
        summary: summarizePairs(pairs),
        pairs,
      },
      null,
      2,
    ),
  );
}
