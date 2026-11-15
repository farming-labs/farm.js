// Production-browser root-text diagnostic, not an official framework benchmark.
// Build @farm.js/react first; run with BASE_REF=<git ref> and optional CHROME_PATH.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { cpus, release, loadavg } from "node:os";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = resolve(root, "../..");
const baseRef = process.env.BASE_REF;
assert(baseRef, "Set BASE_REF to the baseline git revision");
const require = createRequire(root + "/package.json");
const { build } = require("vite");
const { chromium } = createRequire(repo + "/package.json")("@playwright/test");
const runtime = root + "/src/compiler-runtime.tsx";
const entry = root + "/fixtures/runtime-size/direct.tsx";
const sources = {
  base: execFileSync("git", ["show", baseRef + ":packages/farm-react/src/compiler-runtime.tsx"], {
    cwd: repo,
    encoding: "utf8",
  }),
  candidate: readFileSync(runtime, "utf8"),
};
const fixture = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createCompiledComponentWithFeatures} from '@farm.js/react/compiler-runtime';
const n=2048;
const bindings=Array.from({length:n},(_,i)=>({kind:'text',target:i,path:[i+1],dependencies:[0],read:(_,state)=>['Value: ',state[0].get()]}));
const App=createCompiledComponentWithFeatures({displayName:'RootFanout',reactivity:'static',initialize:()=>[0],render(_,state,blocks){
return React.createElement('main',null,React.createElement('button',{onClick:()=>state[0].set(v=>v+1)},'Update'),...bindings.map((_,i)=>React.createElement('p',{key:i,ref:blocks.target(i)},'Value: ',state[0].get())));
},bindings},[]);
function Control(){const [value,setValue]=useState(0);return React.createElement('main',null,React.createElement('button',{onClick:()=>setValue(v=>v+1)},'Update'),...bindings.map((_,i)=>React.createElement('p',{key:i},'Value: ',value)));}
flushSync(()=>createRoot(document.body).render(React.createElement(location.search.includes('react')?Control:App)));
window.ready=true;
window.update=async()=>{document.querySelector('button').click();await Promise.resolve();await Promise.resolve();};`;
const bundles = new Map(),
  sizes = {};
for (const variant of ["base", "candidate"]) {
  let runtimeInjections = 0;
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    css: { postcss: { plugins: [] } },
    resolve: { alias: { "@farm.js/react/compiler-runtime": runtime } },
    plugins: [
      {
        name: "inject",
        enforce: "pre",
        load(id) {
          if (id === runtime) {
            runtimeInjections++;
            return sources[variant];
          }
          if (id === entry) return fixture;
        },
      },
    ],
    build: { write: false, minify: "esbuild", rollupOptions: { input: entry } },
  });
  assert.equal(runtimeInjections, 1);
  const chunks = result.output.filter((output) => output.type === "chunk");
  assert.equal(chunks.length, 1);
  const code = chunks[0].code;
  bundles.set(variant, code);
  sizes[variant] = { raw: Buffer.byteLength(code), gzip: gzipSync(code, { level: 9 }).length };
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
      '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><script type="module" src="/bundle?variant=' +
        variant +
        '"></script></body></html>',
    );
  }
});
let browser;
try {
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(0, "127.0.0.1", r);
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const samples = { base: [], candidate: [] };
  const firstUpdateSamples = { base: [], candidate: [] };
  for (const [variant, control] of [
    ["candidate", true],
    ...Array.from({ length: 7 }, (_, i) =>
      (i % 2 ? ["candidate", "base"] : ["base", "candidate"]).map((v) => [v, false]),
    ).flat(),
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      "http://127.0.0.1:" +
        server.address().port +
        "/?variant=" +
        variant +
        (control ? "&react=true" : ""),
    );
    await page.waitForFunction(() => window.ready);
    const result = await page.evaluate(async () => {
      const nodes = [...document.querySelectorAll("p")];
      if (nodes.length !== 2048) throw new Error("Wrong binding count");
      const firstStart = performance.now();
      await window.update();
      const firstUpdateMs = performance.now() - firstStart;
      if (!nodes.every((node) => node.textContent === "Value: 1"))
        throw new Error("First update output mismatch");
      for (let i = 1; i < 10; i++) await window.update();
      const start = performance.now();
      for (let i = 0; i < 100; i++) await window.update();
      const ms = (performance.now() - start) / 100;
      const after = [...document.querySelectorAll("p")];
      if (!nodes.every((node, i) => node === after[i] && node.textContent === "Value: 110"))
        throw new Error("Output/identity mismatch");
      return { ms, firstUpdateMs };
    });
    assert.deepEqual(errors, []);
    if (!control) {
      samples[variant].push(result.ms);
      firstUpdateSamples[variant].push(result.firstUpdateMs);
    }
    await page.close();
  }
  const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
  console.log(
    JSON.stringify(
      {
        baseRef,
        browser: browser.version(),
        node: process.version,
        cpu: cpus()[0].model,
        os: release(),
        load: loadavg(),
        sizes,
        samples,
        firstUpdateSamples,
        firstUpdateMedians: {
          base: median(firstUpdateSamples.base),
          candidate: median(firstUpdateSamples.candidate),
        },
        medians: { base: median(samples.base), candidate: median(samples.candidate) },
        workload:
          "2048 joined root text bindings; 10 warmups + 100 measured local updates; 7 alternating pairs, fresh pages; ordinary React correctness control; production Vite bundles, not frame latency or official framework benchmark",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
