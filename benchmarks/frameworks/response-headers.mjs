// Request-level cost of Farm's header-only response rebuilds on the maintained
// Farm fixture, not a cross-framework score. Farm edits headers in place on
// responses it built itself (Markdown negotiation, configured headers, the
// preload marker strip, compression Vary). The *-copy arms turn ownership off,
// so every header-only step copies and rebuilds the Response as before.
// Build the maintained Farm fixture first.
// Requires Node 24.11+ (registerHooks).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const entry = new URL("./apps/farm/.farm/ssr/_virtual_farm-ssr-entry.js", import.meta.url);
const arms = {
  "identity-owned": { encoding: "identity", owned: true },
  "identity-copy": { encoding: "identity", owned: false },
  "br-owned": { encoding: "br", owned: true },
  "br-copy": { encoding: "br", owned: false },
};
const normalize = (html) =>
  html
    .replace(/data-rendered-at="\d+"/g, 'data-rendered-at="TIME"')
    .replace(/<time\b[^>]*>[\s\S]*?<\/time>/g, "<time>TIME</time>");
const name = process.argv[2];

if (name) {
  const arm = arms[name];
  assert.ok(arm, `unknown arm ${name}`);
  process.env.NODE_ENV = "production";
  process.env.FARM_TELEMETRY_DISABLED = "1";
  let entrySha256;
  registerHooks({
    load(url, context, next) {
      const result = next(url, context);
      if (url !== entry.href) return result;
      let source = String(result.source);
      entrySha256 = createHash("sha256").update(source).digest("hex");
      // Every arm loads the entry through the same replacement; an untouched
      // module string runs measurably slower than a replaced one.
      // Every arm loads byte-identical source; the arm only changes an
      // environment switch, so no arm differs in what V8 compiles.
      const owned = /farmOwnedResponses\.has\(response\)/g;
      assert.equal([...source.matchAll(owned)].length, 2, "build the candidate first");
      source =
        'const __benchOwned = process.env.BENCH_OWNED !== "0";\n' +
        source.replace(owned, "(__benchOwned && farmOwnedResponses.has(response))");
      return { ...result, source };
    },
  });
  const mod = await import(entry.href);
  await mod.farmProductionLifecycle.start();
  let expected, compressedBytes;
  async function request(check = false) {
    const callbacks = [],
      pending = [];
    const response = await mod.fetch(
      new Request("http://localhost/", { headers: { "accept-encoding": arm.encoding } }),
      {
        onResponseFinished(callback) {
          callbacks.push(callback);
        },
        waitUntil(promise) {
          pending.push(promise);
        },
      },
    );
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-encoding"),
      arm.encoding === "identity" ? null : arm.encoding,
    );
    if (check) {
      const html =
        arm.encoding === "br"
          ? brotliDecompressSync(body).toString()
          : arm.encoding === "gzip"
            ? gunzipSync(body).toString()
            : body.toString();
      assert.equal((html.match(/<li\b/g) || []).length, 120);
      expected = normalize(html);
    }
    compressedBytes = body.length;
    for (const callback of callbacks) callback();
    await Promise.all(pending);
  }
  try {
    await request(true);
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
    console.log(
      JSON.stringify({
        arm: name,
        warmups: 1000,
        requests: 3000,
        samples,
        bytes: compressedBytes,
        normalizedHtml: expected,
        entrySha256,
      }),
    );
  } finally {
    await mod.farmProductionLifecycle.close("benchmark-complete");
  }
} else {
  const names = Object.keys(arms);
  const rounds = [];
  const loadBefore = os.loadavg();
  for (let round = 0; round < 5; round++) {
    // Rotate the arm order every round so no arm always runs first or last.
    const order = names.slice(round % names.length).concat(names.slice(0, round % names.length));
    for (const current of order) {
      const child = spawnSync(process.execPath, [import.meta.filename, current], {
        encoding: "utf8",
        timeout: 120000,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !/^(NODE_OPTIONS|NODE_ENV|NODE_PATH|FARM_|NITRO_|VITE_|BENCH_|PORT$|HOST$)/.test(
                  key,
                ),
            ),
          ),
          BENCH_OWNED: arms[current].owned ? "1" : "0",
        },
      });
      assert.equal(child.status, 0, child.stdout + child.stderr);
      rounds.push({ round: round + 1, ...JSON.parse(child.stdout) });
    }
  }
  assert.ok(rounds.every((row) => row.normalizedHtml === rounds[0].normalizedHtml));
  assert.ok(rounds.every((row) => row.entrySha256 === rounds[0].entrySha256));
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const mean = (row, metric) =>
    row.samples.reduce((sum, sample) => sum + sample[metric], 0) / row.samples.length;
  const summary = Object.fromEntries(
    names.map((current) => {
      const rows = rounds.filter((row) => row.arm === current);
      return [
        current,
        {
          wallMs: median(rows.map((row) => mean(row, "wallMs"))),
          cpuMs: median(rows.map((row) => mean(row, "cpuMs"))),
          bytes: rows[0].bytes,
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        provisional: true,
        methodology:
          "In-process SSR of the maintained fixture with each Accept-Encoding, reading the full (compressed) body; first response decompressed and compared with every other arm. *-copy arms turn response ownership off, so every header-only step copies and rebuilds. Five rounds with rotating arm order, one fresh process per arm per round; median of round means. Every arm loads byte-identical source. Not network latency or a publishable comparison.",
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
