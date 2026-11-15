// Opt-in production-browser allocation diagnostic, not a JS Framework Benchmark score.
// Build first, then run with BASE_REF=<git ref> and optionally CHROME_PATH=<executable>.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpus, release, loadavg } from "node:os";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(root, "../..");
const require = createRequire(`${root}/package.json`);
const { build } = require("vite");
const { chromium } = createRequire(`${repo}/package.json`)("@playwright/test");
const { normalizeReactCompilerOptions } = await import(`${root}/dist/index.mjs`);
const ts = require("typescript");
const runtime = `${root}/src/compiler-runtime.tsx`;
const entry = `${root}/fixtures/runtime-size/keyed-plain.tsx`;
const runtimeSource = readFileSync(runtime, "utf8");
const baseRef = process.env.BASE_REF;
assert(baseRef, "Set BASE_REF to the baseline git revision");
const baselineSource = execFileSync(
  "git",
  ["show", baseRef + ":packages/farm-react/src/compiler-runtime.tsx"],
  { cwd: repo, encoding: "utf8" },
);
const compilerSource = readFileSync(`${root}/src/compiler.ts`, "utf8");
const baselineCompilerSource = execFileSync(
  "git",
  ["show", baseRef + ":packages/farm-react/src/compiler.ts"],
  { cwd: repo, encoding: "utf8" },
);
assert(baselineSource !== runtimeSource || baselineCompilerSource !== compilerSource);
// Compile the trusted Git/worktree sources with the same dependencies and options.
// This also isolates compiler-only changes instead of using today's compiler for both arms.
function loadCompiler(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(require, module, module.exports);
  return module.exports.compileReactModule;
}
const compilers = {
  base: loadCompiler(baselineCompilerSource),
  candidate: loadCompiler(compilerSource),
};
const compilerOptions = normalizeReactCompilerOptions({
  onUnsupported: "error",
  reactivity: "hybrid",
});
const bindingCount = Number(process.env.FARM_ALLOCATION_BINDINGS || 1);
assert([1, 3].includes(bindingCount), "FARM_ALLOCATION_BINDINGS must be 1 or 3");
let fixture = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
const count = Number(new URLSearchParams(location.search).get('rows'));
let nextId = 1;
function makeRows(n) { return Array.from({length:n}, () => { const id=nextId++; return {id,label:'Row '+id}; }); }
export function Table() {
  const [rows,setRows] = useState([]);
  const [selected,setSelected] = useState(-1);
  return <main>
    <button id="create" onClick={() => setRows(makeRows(count))}>Create</button>
    <button id="update" onClick={() => setRows(current => current.map((row,index) => index%10===0 ? {...row,label:row.label+'!'} : row))}>Update</button>
    <button id="all" onClick={() => setRows(current => current.map(row => ({...row,label:row.label+'?'})))}>All</button>
    <button id="append" onClick={() => setRows(current => [...current,...makeRows(1000)])}>Append</button>
    <button id="remove" onClick={() => setRows(current => current.filter((row,index) => index!==0))}>Remove</button>
    <button id="clear" onClick={() => setRows([])}>Clear</button>
    <ul>{rows.map(row => <li data-id={row.id} className={selected===row.id?'selected':''} key={row.id} onClick={() => setSelected(row.id)}><span>{row.id}</span><strong>{row.label}</strong></li>)}</ul>
  </main>;
}
createRoot(document.body).render(<Table/>);`;
if (bindingCount === 3) {
  fixture = fixture.replace("<strong>", "<strong title={row.label} data-label={row.label}>");
}
const bundles = new Map();
const sizes = {};
const proofs = {};
for (const variant of ["base", "candidate", "react"]) {
  const candidate = variant.startsWith("candidate");
  let changed = 0;
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    resolve: { alias: { "@farm.js/react/compiler-runtime": runtime } },
    plugins: [
      {
        name: "diagnostic-source",
        enforce: "pre",
        load(id) {
          if (id === entry) return fixture;
          if (id === runtime) {
            changed++;
            return candidate ? runtimeSource : baselineSource;
          }
        },
        async transform(code, id) {
          if (id !== entry || variant === "react") return;
          const result = await compilers[variant](code, id, compilerOptions);
          assert.deepEqual(result.diagnostics, []);
          assert.deepEqual(result.compiled, ["Table"]);
          return { code: result.code, map: result.map };
        },
      },
    ],
    build: { write: false, minify: "esbuild", rollupOptions: { input: entry } },
  });
  const chunks = [result]
    .flat()
    .flatMap((r) => r.output)
    .filter((r) => r.type === "chunk");
  assert.equal(chunks.length, 1);
  const code = chunks[0].code;
  if (variant !== "react") assert(code.includes("FarmCompiledKeyedRows"));
  if (candidate) assert.equal(changed, 1, "exactly one runtime injection");
  bundles.set(variant, code);
  sizes[variant] = { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
  proofs[variant] = {
    runtimeInjections: changed,
    compiled: code.includes("FarmCompiledKeyedRows"),
  };
}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const variant = url.searchParams.get("variant");
  if (!bundles.has(variant)) return void res.writeHead(404).end();
  if (url.pathname === "/bundle") {
    res.setHeader("content-type", "text/javascript");
    res.end(bundles.get(variant));
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/bundle?variant=${variant}"></script></body></html>`,
    );
  }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const samples = { base: [], candidate: [] };
  // Check the same fixture with the compiler disabled before profiling it.
  const control = await browser.newPage();
  await control.goto(`http://127.0.0.1:${server.address().port}/?variant=react&rows=10000`);
  await control.locator("#create").click();
  await control.waitForFunction(() => document.querySelectorAll("li").length === 10000);
  await control.locator("#all").click();
  await control.waitForFunction(
    () => document.querySelector("li strong")?.textContent === "Row 1?",
  );
  await control.close();
  for (let round = 0; round < 5; round++)
    for (const variant of round % 2 ? ["candidate", "base"] : ["base", "candidate"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/?variant=${variant}&rows=10000`);
      await page.waitForSelector("#create");
      await page.evaluate(async () => {
        const list = document.querySelector("ul");
        const click = (id) =>
          new Promise((resolve, reject) => {
            const observer = new MutationObserver(() => {
              observer.disconnect();
              clearTimeout(deadline);
              resolve();
            });
            const deadline = setTimeout(() => {
              observer.disconnect();
              reject(new Error(`No DOM commit for ${id}`));
            }, 10000);
            observer.observe(list, { subtree: true, childList: true, characterData: true });
            document.querySelector(id).click();
          });
        globalThis.update = () => click("#all");
        await click("#create");
        for (let i = 0; i < 5; i++) await globalThis.update();
      });
      const session = await page.context().newCDPSession(page);
      await session.send("HeapProfiler.collectGarbage");
      await session.send("HeapProfiler.startSampling", {
        samplingInterval: 512,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      await page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await globalThis.update();
      });
      const { profile } = await session.send("HeapProfiler.stopSampling");
      let bytes = 0;
      const visit = (node) => {
        bytes += node.selfSize;
        for (const child of node.children || []) visit(child);
      };
      visit(profile.head);
      samples[variant].push(bytes / 20);
      assert.deepEqual(errors, []);
      assert.equal(await page.locator("li").count(), 10000);
      assert.equal(await page.locator("li strong").first().textContent(), "Row 1" + "?".repeat(25));
      assert(
        await page.evaluate(
          (bindings) =>
            [...document.querySelectorAll("li")].every((row, index) => {
              const label = `Row ${index + 1}${"?".repeat(25)}`;
              const strong = row.querySelector("strong");
              return (
                row.dataset.id === String(index + 1) &&
                strong.textContent === label &&
                (bindings === 1 || (strong.title === label && strong.dataset.label === label))
              );
            }),
          bindingCount,
        ),
      );
      console.log(JSON.stringify({ round, variant, sampledBytesPerUpdate: bytes / 20 }));
      await page.close();
    }
  console.log(
    JSON.stringify(
      {
        baseRef,
        bindingCount,
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: repo,
          encoding: "utf8",
        }).trim(),
        cpu: cpus()[0]?.model,
        osRelease: release(),
        load: loadavg(),
        sizes,
        proofs,
        samples,
        browser: await browser.version(),
        node: process.version,
        metric:
          "CDP allocation sampling, 512-byte interval including collected objects; 20 all-row updates per sample; 5 paired samples; not retained heap size",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
