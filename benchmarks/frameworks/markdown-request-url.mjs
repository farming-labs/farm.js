// In-process production diagnostic; does not publish or alter benchmark scores.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

const entry = new URL("./apps/farm/.farm/ssr/_virtual_farm-ssr-entry.js", import.meta.url);
const source = readFileSync(entry, "utf8");
const reuse = "requestUrl: url,";
const parsed =
  "options.requestUrl?.href === options.request.url ? options.requestUrl : new URL(options.request.url)";
assert.equal(source.split(reuse).length, 2, "Build the candidate fixture before measuring");
assert.equal(source.split(parsed).length, 2, "Expected the guarded URL reuse");
const baseline = source.replace(reuse, "").replace(parsed, "new URL(options.request.url)");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scenarios = {
  html: { path: "/" },
  browserHtml: {
    path: "/",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
  markdown: { path: "/", accept: "text/markdown", markdown: true },
  extension: { path: "/index.md", accept: "text/html", markdown: true },
};
const selected = process.env.FARM_MARKDOWN_SCENARIO;
assert.ok(selected === undefined || Object.hasOwn(scenarios, selected), "Unknown scenario");
const names = selected ? [selected] : Object.keys(scenarios);
const counts = (name, fallback) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
};
const warmups = counts("FARM_MARKDOWN_WARMUPS", 1000);
const requests = counts("FARM_MARKDOWN_REQUESTS", 3000);
assert.equal(requests % 10, 0, "Use ten complete measured batches");
const labels = Array.from(
  { length: 120 },
  (_, i) => `Benchmark item ${String(i + 1).padStart(3, "0")}`,
);
const expectedHtmlRows = labels.map((label, i) => `<span>${i + 1}</span><strong>${label}</strong>`);
const expectedMarkdownRows = labels.map((label, i) => `- ${i + 1}**${label}**`);
const normalize = (body) =>
  body
    .replace(/data-rendered-at="\d+"/g, 'data-rendered-at="TIME"')
    .replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, "<time>TIME</time>")
    .replace(/^\d{13}$/gm, "TIME");
const arm = process.argv[2];
if (arm === "baseline" || arm === "candidate") {
  const name = process.argv[3];
  assert.ok(Object.hasOwn(scenarios, name), "Expected a scenario name");
  const scenario = scenarios[name];
  process.env.NODE_ENV = "production";
  process.env.FARM_TELEMETRY_DISABLED = "1";
  let intercepted = false;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== entry.href) return result;
      assert.equal(String(result.source), source, "Entry changed during measurement");
      intercepted = true;
      return { ...result, source: arm === "baseline" ? baseline : source };
    },
  });
  const mod = await import(entry.href);
  assert.ok(intercepted);
  await mod.farmProductionLifecycle.start();
  let signature;
  const validate = ({ response, body, requestedAt, receivedAt }) => {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.ok(
      response.headers
        .get("content-type")
        .includes(scenario.markdown ? "text/markdown" : "text/html"),
    );
    let timestamp;
    if (scenario.markdown) {
      assert.deepEqual(
        body.split("\n").filter((line) => line.startsWith("- ")),
        expectedMarkdownRows,
      );
      timestamp = Number(body.match(/^\d{13}$/m)?.[0]);
    } else {
      assert.equal((body.match(/data-benchmark-marker="framework-benchmark-v1"/g) || []).length, 1);
      assert.ok(body.includes('data-item-count="120"'));
      assert.deepEqual(
        [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]),
        expectedHtmlRows,
      );
      timestamp = Number(body.match(/data-rendered-at="(\d+)"/)?.[1]);
    }
    assert.ok(
      Number.isSafeInteger(timestamp) && timestamp >= requestedAt && timestamp <= receivedAt,
      "Fresh dynamic render required",
    );
    const current = { bodyHash: hash(normalize(body)), headers: [...response.headers] };
    signature ??= current;
    assert.deepEqual(current, signature);
  };
  async function request() {
    const callbacks = [],
      pending = [];
    const requestedAt = Date.now();
    const response = await mod.fetch(
      new Request("http://localhost" + scenario.path, {
        headers: {
          "accept-encoding": "identity",
          ...(scenario.accept && { accept: scenario.accept }),
        },
      }),
      {
        onResponseFinished: (callback) => callbacks.push(callback),
        waitUntil: (promise) => pending.push(promise),
      },
    );
    const body = await response.text();
    for (const callback of callbacks) callback();
    await Promise.all(pending);
    return { response, body, requestedAt, receivedAt: Date.now() };
  }
  try {
    for (let i = 0; i < warmups; i++) validate(await request());
    const samples = [];
    for (let batch = 0; batch < 10; batch++) {
      const output = [];
      const thread = process.threadCpuUsage?.(),
        cpu = process.cpuUsage(),
        begin = performance.now();
      for (let i = 0; i < requests / 10; i++) output.push(await request());
      const wall = performance.now() - begin,
        used = process.cpuUsage(cpu);
      const threadUsed = thread && process.threadCpuUsage(thread);
      samples.push({
        wallMs: wall / output.length,
        cpuMs: (used.user + used.system) / 1000 / output.length,
        ...(threadUsed && {
          threadCpuMs: (threadUsed.user + threadUsed.system) / 1000 / output.length,
        }),
      });
      // Validate all 120 ordered rows, freshness and output equivalence outside timing.
      for (const result of output) validate(result);
    }
    console.log(
      JSON.stringify({ arm, scenario: name, sourceHash: hash(source), signature, samples }),
    );
  } finally {
    await mod.farmProductionLifecycle.close("diagnostic-complete");
  }
} else {
  assert.equal(
    arm,
    undefined,
    "usage: node benchmarks/frameworks/markdown-request-url.mjs [baseline|candidate scenario]",
  );
  const loadBefore = os.loadavg(),
    pairs = [];
  for (let repetition = 0; repetition < 5; repetition++) {
    for (const name of names) {
      const pair = { repetition: repetition + 1, scenario: name };
      for (const current of repetition % 2
        ? ["candidate", "baseline"]
        : ["baseline", "candidate"]) {
        const child = spawnSync(process.execPath, [import.meta.filename, current, name], {
          encoding: "utf8",
          timeout: 90000,
        });
        assert.equal(child.status, 0, child.stdout + child.stderr);
        pair[current] = JSON.parse(child.stdout);
        assert.equal(pair[current].sourceHash, hash(source));
      }
      assert.deepEqual(pair.baseline.signature, pair.candidate.signature);
      pairs.push(pair);
    }
  }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    names.map((name) => [
      name,
      Object.fromEntries(
        ["baseline", "candidate"].map((current) => [
          current,
          Object.fromEntries(
            Object.keys(pairs[0][current].samples[0]).map((metric) => [
              metric,
              median(
                pairs
                  .filter((pair) => pair.scenario === name)
                  .map(
                    (pair) =>
                      pair[current].samples.reduce((sum, sample) => sum + sample[metric], 0) / 10,
                  ),
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
        runnerHash: hash(readFileSync(import.meta.filename)),
        sourceHash: hash(source),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
        loadBefore,
        loadAfter: os.loadavg(),
        warmups,
        requests,
        scenarios: names,
        methodology:
          "Five alternating fresh-process pairs per scenario. Same built 120-row dynamic SSR fixture; baseline restores the helper's unconditional URL parse and removes the caller's URL hint in memory. Request construction, fetch, full body and lifecycle consumption measured; all ordered rows, freshness, headers and normalized body equivalence validated outside timing. Ten batches per process; summary is median of process means. Identity encoding. Not network latency or a published framework score.",
        entryBytes: {
          baseline: { raw: Buffer.byteLength(baseline), gzip: gzipSync(baseline).length },
          candidate: { raw: Buffer.byteLength(source), gzip: gzipSync(source).length },
        },
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
