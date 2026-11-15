// Focused production-browser diagnostic, not a cross-framework benchmark.
// Build @farm.js/react first, then pass the commit immediately before this change.
// Example: node scripts/benchmark-row-event-index.mjs --baseline-ref <sha>
// Use --operations filter,slice for removals and --reactivity static for static scheduling.
// Use --executable-path for an existing Chrome; otherwise use Playwright Chromium.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { cpus, loadavg, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { build, normalizePath } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";

const { values } = parseArgs({
  options: {
    "baseline-ref": { type: "string" },
    "executable-path": { type: "string" },
    samples: { type: "string", default: "35" },
    warmups: { type: "string", default: "5" },
    rows: { type: "string", default: "10000" },
    operations: { type: "string", default: "append,prepend" },
    reactivity: { type: "string", default: "hybrid" },
  },
});
assert.ok(values["baseline-ref"], "--baseline-ref must name the pre-change commit");
const sampleCount = Number(values.samples);
const warmupCount = Number(values.warmups);
const rowCount = Number(values.rows);
const operations = values.operations.split(",");
assert.ok(operations.length > 0);
assert.ok(
  operations.every((operation) => ["append", "prepend", "filter", "slice"].includes(operation)),
);
assert.ok(["static", "hybrid"].includes(values.reactivity));
assert.ok(Number.isSafeInteger(sampleCount) && sampleCount > 0);
assert.ok(Number.isSafeInteger(warmupCount) && warmupCount >= 0);
assert.ok(Number.isSafeInteger(rowCount) && rowCount > 1);
const packageRoot = normalizePath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const repo = normalizePath(resolve(packageRoot, "../.."));
const { chromium } = createRequire(`${repo}/package.json`)("@playwright/test");
const runtime = `${packageRoot}/src/compiler-runtime.tsx`;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const baselineCommit = git("rev-parse", "--verify", `${values["baseline-ref"]}^{commit}`);
const baseline = git("show", `${baselineCommit}:packages/farm-react/src/compiler-runtime.tsx`);
const candidate = readFileSync(runtime, "utf8");
assert.notEqual(candidate.trim(), baseline, "baseline and candidate runtime must differ");
// Both variants use the current compiler. Older baselines need the equivalent
// broad runtime exports before append/filter/prepend-only selection existed.
const legacyAppendControl = !baseline.includes("export const keyedRowsAppendOnlyRuntimeFeature");
const legacyFilterControl = !baseline.includes("export const keyedRowsFilterOnlyRuntimeFeature");
const legacyPrependControl = !baseline.includes("export const keyedRowsPrependOnlyRuntimeFeature");
const bundles = new Map();
const sizes = {};

for (const operation of operations) {
  for (const delegated of [false, true]) {
    for (const variant of ["base", "candidate", "react"]) {
      const key = `${operation}-${delegated}-${variant}`;
      const entry = `${packageRoot}/fixtures/runtime-size/keyed-${operation}.tsx`;
      const original = readFileSync(entry, "utf8");
      const legacyFeature =
        operation === "append" && legacyAppendControl
          ? ["keyedRowsAppendOnlyRuntimeFeature", "keyedRowsHintedRuntimeFeature"]
          : ["filter", "slice"].includes(operation) && legacyFilterControl
            ? ["keyedRowsFilterOnlyRuntimeFeature", "keyedRowsFilterHintedRuntimeFeature"]
            : operation === "prepend" && legacyPrependControl
              ? ["keyedRowsPrependOnlyRuntimeFeature", "keyedRowsPrependHintedRuntimeFeature"]
              : undefined;
      let replacedFeature = false;
      assert.ok(original.includes("length: 1_000"));
      let fixture = original.replace("length: 1_000", `length: ${rowCount}`);
      if (operation === "filter") {
        assert.ok(fixture.includes("row.id !== 500"));
        fixture = fixture.replace("row.id !== 500", `row.id !== ${Math.floor(rowCount / 2)}`);
      }
      if (delegated) {
        assert.ok(fixture.includes("<li data-id="));
        fixture = fixture.replace(
          "<li data-id=",
          "<li onClick={() => window.__rowClicks.push(row.id)} data-id=",
        );
      }
      const result = await build({
        configFile: false,
        root: packageRoot,
        logLevel: "silent",
        css: { postcss: { plugins: [] } },
        resolve: { alias: { "@farm.js/react/compiler-runtime": runtime } },
        plugins: [
          {
            name: "paired-event-index-fixture",
            enforce: "pre",
            load(id) {
              if (id === entry) return fixture;
              if (id === runtime) return variant === "base" ? baseline : candidate;
            },
          },
          ...createFarmRendererPlugin({
            rendererOptions: {
              experimental: {
                compiler:
                  variant === "react"
                    ? false
                    : { onUnsupported: "error", reactivity: values.reactivity },
              },
            },
          }),
          {
            name: "legacy-runtime-control",
            enforce: "post",
            transform(code, id) {
              if (variant !== "base" || !legacyFeature || id !== entry) return;
              const control = code.replaceAll(legacyFeature[0], () => {
                replacedFeature = true;
                return legacyFeature[1];
              });
              return { code: control, map: null };
            },
          },
        ],
        build: { write: false, minify: "esbuild", rollupOptions: { input: entry } },
      });
      const chunks = [result]
        .flat()
        .flatMap((part) => part.output)
        .filter((part) => part.type === "chunk");
      assert.equal(chunks.length, 1);
      const code = chunks[0].code;
      if (variant === "base" && legacyFeature) {
        assert.ok(replacedFeature, "legacy control must replace the unavailable feature");
      }
      if (variant !== "react") {
        assert.ok(code.includes("FarmCompiledKeyedRows"));
        assert.ok(
          code.includes(
            operation === "append"
              ? variant === "base" && legacyAppendControl
                ? "keyed-rows:hinted"
                : "keyed-rows:append-only"
              : operation === "prepend"
                ? variant === "base" && legacyPrependControl
                  ? "keyed-rows:prepend-hinted"
                  : "keyed-rows:prepend-only"
                : variant === "base" && legacyFilterControl
                  ? "keyed-rows:filter-hinted"
                  : "keyed-rows:filter-only",
          ),
        );
        if (delegated) assert.match(code, /delegateEvents:!0/);
      }
      bundles.set(key, code);
      sizes[key] = { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
    }
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = url.searchParams.get("key");
  if (!bundles.has(key)) {
    res.writeHead(404).end();
    return;
  }
  if (url.pathname === "/bundle") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundles.get(key));
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script>window.__rowClicks=[]</script><script type="module" src="/bundle?key=${key}"></script></body></html>`,
    );
  }
});
let browser;
let page;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  browser = await chromium.launch({ headless: true, executablePath: values["executable-path"] });
  page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  async function sample(key, operation, delegated) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?key=${key}`);
    await page.waitForFunction(
      (count) => document.querySelectorAll("li").length === count,
      rowCount,
    );
    const result = await page.evaluate(
      async ({ operation, rowCount, delegated }) => {
        const list = document.querySelector("ul");
        const before = new Map([...list.children].map((row) => [row.dataset.id, row]));
        const removal = operation === "filter" || operation === "slice";
        const expectedCount = rowCount + (removal ? -1 : 1);
        const button = document.querySelector("button");
        button.focus();
        let started;
        const elapsed = await new Promise((resolveElapsed, reject) => {
          const observer = new MutationObserver(() => {
            if (list.children.length !== expectedCount) return;
            observer.disconnect();
            clearTimeout(deadline);
            resolveElapsed(performance.now() - started);
          });
          const deadline = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Row update did not complete"));
          }, 10_000);
          observer.observe(list, { childList: true });
          started = performance.now();
          button.click();
        });
        const rows = [...list.children];
        const expected =
          operation === "append"
            ? [...Array(rowCount + 1).keys()]
            : operation === "prepend"
              ? [rowCount, ...Array(rowCount).keys()]
              : [...Array(rowCount).keys()].filter(
                  (id) => id !== (operation === "filter" ? Math.floor(rowCount / 2) : 0),
                );
        const eventIndexes = [0, Math.floor(rows.length / 2), rows.length - 1];
        if (delegated) {
          for (const index of eventIndexes) rows[index].click();
        }
        return {
          elapsed,
          correct: rows.every(
            (row, index) =>
              row.dataset.id === String(expected[index]) &&
              row.textContent === `Row ${expected[index]}`,
          ),
          retained: rows.every(
            (row) => !before.has(row.dataset.id) || before.get(row.dataset.id) === row,
          ),
          focus: document.activeElement === button,
          calls: window.__rowClicks,
          expectedCalls: delegated ? eventIndexes.map((index) => expected[index]) : [],
        };
      },
      { operation, rowCount, delegated },
    );
    assert.equal(result.correct, true, key);
    assert.equal(result.retained, true, key);
    assert.equal(result.focus, true, key);
    assert.deepEqual(result.calls, result.expectedCalls, key);
    assert.deepEqual(errors, []);
    return result.elapsed;
  }
  const loadBefore = loadavg();
  const results = {};
  for (const operation of operations) {
    for (const delegated of [false, true]) {
      await sample(`${operation}-${delegated}-react`, operation, delegated);
      const timings = { base: [], candidate: [] };
      for (let round = -warmupCount; round < sampleCount; round += 1) {
        const order = round % 2 ? ["base", "candidate"] : ["candidate", "base"];
        for (const variant of order) {
          const elapsed = await sample(
            `${operation}-${delegated}-${variant}`,
            operation,
            delegated,
          );
          if (round >= 0) timings[variant].push(elapsed);
        }
      }
      results[`${operation}-${delegated}`] = timings;
    }
  }
  console.log(
    JSON.stringify(
      {
        baselineCommit,
        candidateHeadCommit: git("rev-parse", "HEAD"),
        candidateRuntimeSource: "working tree",
        compilerControl:
          "current compiler for both; equivalent broad feature substituted only when absent from baseline",
        legacyAppendControl,
        legacyFilterControl,
        legacyPrependControl,
        operations,
        reactivity: values.reactivity,
        baselineRuntimeSha256: createHash("sha256").update(baseline).digest("hex"),
        candidateRuntimeSha256: createHash("sha256").update(candidate).digest("hex"),
        node: process.version,
        browser: await browser.version(),
        platform: process.platform,
        arch: process.arch,
        osRelease: release(),
        cpu: cpus()[0]?.model,
        loadBefore,
        loadAfter: loadavg(),
        rowCount,
        sampleCount,
        warmupCount,
        metric: "programmatic click to DOM mutation observer; excludes layout, paint and startup",
        sizes,
        results,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await page?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }
}
