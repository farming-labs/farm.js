// Paired production-browser diagnostic for nested keyed reconciliation.
// Build @farm.js/react first. Timings exclude startup, layout, and paint.
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
  },
});
assert.ok(values["baseline-ref"], "--baseline-ref must name the pre-change commit");
const sampleCount = Number(values.samples);
const warmupCount = Number(values.warmups);
const rowCount = Number(values.rows);
assert.ok(Number.isSafeInteger(sampleCount) && sampleCount > 0);
assert.ok(Number.isSafeInteger(warmupCount) && warmupCount >= 0);
assert.ok(Number.isSafeInteger(rowCount) && rowCount > 2);
const packageRoot = normalizePath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const repo = normalizePath(resolve(packageRoot, "../.."));
const { chromium } = createRequire(`${repo}/package.json`)("@playwright/test");
const runtime = `${packageRoot}/src/compiler-runtime.tsx`;
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const baselineCommit = git("rev-parse", "--verify", `${values["baseline-ref"]}^{commit}`);
const baseline = git("show", `${baselineCommit}:packages/farm-react/src/compiler-runtime.tsx`);
const candidate = readFileSync(runtime, "utf8");
assert.notEqual(candidate.trim(), baseline);
const bundles = new Map();
const sizes = {};
const entry = `${packageRoot}/fixtures/runtime-size/keyed-nested.tsx`;
const original = readFileSync(entry, "utf8");
for (const token of ["length: 1_000", "setGroups((current) => [...current])", "<li data-after>"])
  assert.ok(original.includes(token));

async function bundle(variant, input, fixture) {
  const result = await build({
    configFile: false,
    root: packageRoot,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    resolve: { alias: { "@farm.js/react/compiler-runtime": runtime } },
    plugins: [
      {
        name: "paired-nested-stable-order",
        enforce: "pre",
        load(id) {
          if (id === input) return fixture;
          if (id === runtime) return variant === "base" ? baseline : candidate;
        },
      },
      ...createFarmRendererPlugin({
        rendererOptions: {
          experimental: {
            compiler: variant === "react" ? false : { onUnsupported: "error" },
          },
        },
      }),
    ],
    build: { write: false, minify: "esbuild", rollupOptions: { input } },
  });
  const chunks = [result]
    .flat()
    .flatMap((part) => part.output)
    .filter((part) => part.type === "chunk");
  assert.equal(chunks.length, 1);
  return chunks[0].code;
}

for (const mixed of [false, true]) {
  const fixture = original
    .replace("length: 1_000", `length: ${rowCount}`)
    // Opaque updater deliberately bypasses specialized array-operation hints.
    .replace(
      "setGroups((current) => [...current])",
      "setGroups((current) => window.__updateGroups(current))",
    )
    .replace(
      "<li data-after>",
      `${mixed ? "{group.extra && <li data-extra>Extra</li>}" : ""}<li data-after>`,
    );
  for (const variant of ["base", "candidate", "react"]) {
    const key = `${mixed}-${variant}`;
    const code = await bundle(variant, entry, fixture);
    if (variant !== "react") {
      assert.ok(code.includes("FarmCompiledKeyedRows"));
      assert.ok(code.includes(mixed ? "mixed-ranges" : "keyed-ranges"));
    }
    bundles.set(key, code);
    sizes[key] = { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
  }
}

const isolation = {};
for (const fixture of ["direct", "keyed-plain"]) {
  const input = `${packageRoot}/fixtures/runtime-size/${fixture}.tsx`;
  const source = readFileSync(input, "utf8");
  const before = await bundle("base", input, source);
  const after = await bundle("candidate", input, source);
  assert.equal(after, before, `${fixture} must not retain the nested helper`);
  isolation[fixture] = {
    identical: true,
    raw: Buffer.byteLength(after),
    gzip: gzipSync(after, { level: 9 }).length,
  };
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const key = url.searchParams.get("key");
  if (!bundles.has(key)) return void res.writeHead(404).end();
  if (url.pathname === "/bundle") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundles.get(key));
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/bundle?key=${key}"></script></body></html>`,
    );
  }
});
let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  browser = await chromium.launch({ headless: true, executablePath: values["executable-path"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  async function sample(variant, mixed, operation, allocations = false) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?key=${mixed}-${variant}`);
    await page.waitForFunction(
      (count) => document.querySelectorAll("[data-id]").length === count,
      rowCount,
    );
    const result = await page.evaluate(
      async ({ rowCount, operation, mixed, allocations }) => {
        const updateRows = (current) => {
          const next = current.slice();
          if (operation === "swap-late")
            [next[next.length - 2], next[next.length - 1]] = [
              next[next.length - 1],
              next[next.length - 2],
            ];
          else if (operation === "rotate") next.push(next.shift());
          else if (operation === "update-all")
            return next.map((row) => ({ ...row, label: `${row.label}!` }));
          else next[0] = { ...next[0], label: "Row 0!" };
          return next;
        };
        window.__updateGroups = (groups) =>
          groups.map((group) => ({ ...group, rows: updateRows(group.rows) }));
        const expected = updateRows(
          Array.from({ length: rowCount }, (_, id) => ({ id, label: `Row ${id}` })),
        );
        const list = document.querySelector("ul");
        const before = [...list.querySelectorAll("[data-id]")];
        const staticBefore = list.querySelector("[data-before]");
        const staticAfter = list.querySelector("[data-after]");
        const retained = before[Math.floor(rowCount / 2)];
        retained.tabIndex = 0;
        retained.focus();
        const writes = { positions: 0, instances: 0 };
        const set = Map.prototype.set;
        if (allocations)
          Map.prototype.set = function (key, value) {
            if (typeof key === "string" && /^\d+$/.test(key)) {
              if (typeof value === "number") writes.positions += 1;
              else if (value?.element instanceof Element) writes.instances += 1;
            }
            return set.call(this, key, value);
          };
        let elapsed;
        try {
          elapsed = await new Promise((resolveElapsed, reject) => {
            const observer = new MutationObserver(() => {
              observer.disconnect();
              clearTimeout(deadline);
              resolveElapsed(performance.now() - start);
            });
            const deadline = setTimeout(() => {
              observer.disconnect();
              reject(new Error("No DOM update"));
            }, 10_000);
            observer.observe(list, { childList: true, subtree: true, characterData: true });
            const start = performance.now();
            document.querySelector("button").click();
          });
        } finally {
          Map.prototype.set = set;
        }
        const rows = [...list.querySelectorAll("[data-id]")];
        return {
          elapsed,
          correct:
            rows.length === rowCount &&
            rows.every(
              (row, index) =>
                row.dataset.id === String(expected[index].id) &&
                row.textContent === expected[index].label,
            ),
          retained: rows.every((row, index) => row === before[expected[index].id]),
          focus: document.activeElement === retained,
          anchors:
            staticBefore === list.firstElementChild &&
            staticAfter === list.lastElementChild &&
            Boolean(list.querySelector("[data-extra]")) === mixed,
          writes,
        };
      },
      { rowCount, operation, mixed, allocations },
    );
    assert.equal(result.correct, true);
    assert.equal(result.retained, true);
    assert.equal(result.focus, true);
    assert.equal(result.anchors, true);
    assert.deepEqual(errors, []);
    if (allocations)
      assert.deepEqual(
        result.writes,
        variant === "candidate" && operation.startsWith("update-")
          ? { positions: 0, instances: 0 }
          : { positions: rowCount, instances: rowCount },
      );
    return result.elapsed;
  }
  const loadBefore = loadavg();
  const results = {};
  for (const operation of ["update-one", "update-all", "swap-late", "rotate"]) {
    for (const mixed of [false, true]) {
      await sample("react", mixed, operation);
      for (const variant of ["base", "candidate"]) await sample(variant, mixed, operation, true);
      const timings = { base: [], candidate: [] };
      for (let round = -warmupCount; round < sampleCount; round += 1) {
        for (const variant of round % 2 ? ["base", "candidate"] : ["candidate", "base"]) {
          const elapsed = await sample(variant, mixed, operation);
          if (round >= 0) timings[variant].push(elapsed);
        }
      }
      results[`${operation}-${mixed ? "mixed" : "keyed"}`] = timings;
    }
  }
  console.log(
    JSON.stringify(
      {
        baselineCommit,
        candidateHeadCommit: git("rev-parse", "HEAD"),
        candidateRuntimeSource: "working tree",
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
        metric:
          "programmatic click to DOM mutation observer; excludes layout, paint and startup; allocation probes are untimed",
        sizes,
        isolation,
        results,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
