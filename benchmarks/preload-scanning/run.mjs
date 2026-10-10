import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = "packages/farm/src/preload.ts";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const baselineRevision = git(
  "rev-parse",
  "--verify",
  "--end-of-options",
  `${process.argv[2] || "5a23cc145da41fd75b7224b1697b9adfdeb7f855"}^{commit}`,
).trim();
const baselineSource = git("show", `${baselineRevision}:${sourcePath}`);
const candidateSource = await readFile(
  new URL(sourcePath, new URL("../../", import.meta.url)),
  "utf8",
);
const load = (source) =>
  import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`
  );
const baseline = await load(baselineSource);
const candidate = await load(candidateSource);
const config = { mode: "enforce", maxImages: 1, maxFonts: 1 };
const rounds = 7;
const warmups = 100;
const loadBefore = os.loadavg();
const results = [];
const htmlHints =
  '<link rel="preload" as="image" href="/below.webp">' +
  '<link rel="preload" as="image" href="/hero.webp" fetchpriority="high">';
const headerHints = "</body.woff2>; rel=preload; as=font, </mono.woff2>; rel=preload; as=font";
// Farm fonts emit font preloads in <head>, so candidates end before the body.
const headFontHints =
  '<link rel="preload" href="/sans.woff2" as="font" type="font/woff2" crossorigin>' +
  '<link rel="preload" href="/mono.woff2" as="font" type="font/woff2" crossorigin>';

for (const items of [120, 1_200, 12_000]) {
  for (const workload of ["no-hints", "header-only", "html-hints", "head-font-hints"]) {
    const html =
      '<html><head><link rel="stylesheet" href="/app.css">' +
      '<link rel="modulepreload" href="/app.js">' +
      (workload === "head-font-hints" ? headFontHints : "") +
      "</head><body><ul>" +
      "<li><span>123</span><strong>Benchmark item 123</strong></li>".repeat(items) +
      "</ul>" +
      (workload === "html-hints" ? htmlHints : "") +
      "</body></html>";
    const linkHeader = workload === "header-only" ? headerHints : "";
    const expected = baseline.manageFarmDocumentPreloads(html, linkHeader, config);
    assert.deepEqual(candidate.manageFarmDocumentPreloads(html, linkHeader, config), expected);
    if (workload === "no-hints") {
      assert.deepEqual(expected, { html, linkHeader: "", warnings: [] });
    } else if (workload === "html-hints") {
      assert.equal(
        expected.html,
        html.replace('<link rel="preload" as="image" href="/below.webp">', ""),
      );
      assert.deepEqual(expected.warnings, [{ kind: "image", count: 2, budget: 1, removed: 1 }]);
    } else if (workload === "head-font-hints") {
      assert.equal(
        expected.html,
        html.replace(
          '<link rel="preload" href="/mono.woff2" as="font" type="font/woff2" crossorigin>',
          "",
        ),
      );
      assert.deepEqual(expected.warnings, [{ kind: "font", count: 2, budget: 1, removed: 1 }]);
    } else {
      assert.equal(expected.html, html);
      assert.equal(expected.linkHeader, "</body.woff2>; rel=preload; as=font");
      assert.deepEqual(expected.warnings, [{ kind: "font", count: 2, budget: 1, removed: 1 }]);
    }

    const variants = [
      ["baseline", baseline.manageFarmDocumentPreloads],
      ["candidate", candidate.manageFarmDocumentPreloads],
    ];
    const iterations = Math.max(20, Math.floor(120_000 / items));
    for (const [, manage] of variants) {
      for (let index = 0; index < warmups; index++) {
        assert.deepEqual(manage(html, linkHeader, config), expected);
      }
    }
    const samples = [];
    for (let round = 0; round < rounds; round++) {
      for (const [name, manage] of round % 2 === 0 ? variants : [...variants].reverse()) {
        let checksum = 0;
        const cpuStart = process.cpuUsage();
        const start = performance.now();
        for (let index = 0; index < iterations; index++) {
          const result = manage(html, linkHeader, config);
          checksum += result.html.length + result.linkHeader.length + result.warnings.length;
        }
        const elapsedMs = performance.now() - start;
        const cpu = process.cpuUsage(cpuStart);
        assert.equal(
          checksum,
          iterations *
            (expected.html.length + expected.linkHeader.length + expected.warnings.length),
        );
        samples.push({
          name,
          round,
          elapsedMsPerCall: elapsedMs / iterations,
          cpuMsPerCall: (cpu.user + cpu.system) / (1_000 * iterations),
        });
      }
    }
    results.push({ items, workload, bytes: Buffer.byteLength(html), iterations, samples });
  }
}

console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length,
        loadBefore,
        loadAfter: os.loadavg(),
        baselineRevision,
        candidateRevision: git("rev-parse", "HEAD").trim(),
        baselineSourceSha256: createHash("sha256").update(baselineSource).digest("hex"),
        candidateSourceSha256: createHash("sha256").update(candidateSource).digest("hex"),
        rounds,
        warmups,
      },
      note: "CPU microbenchmark, not whole-request latency. Working-tree source is measured; source hashes identify uncommitted changes. Rerun on an idle host before making release claims.",
      results,
    },
    null,
    2,
  ),
);
