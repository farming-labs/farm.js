import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire, Module } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = repo + "/packages/farm-react";
const sha = process.env.SOURCE_REF || "WORKTREE";
const require = createRequire(root + "/package.json");
const esbuild = createRequire(require.resolve("tsup"))("esbuild");
const { chromium, expect } = createRequire(repo + "/package.json")("@playwright/test");
const hashes = {};
const pinned = {
  name: "pinned-source",
  setup(build) {
    build.onLoad({ filter: /[\\/]farm-react[\\/]src[\\/].*\.tsx?$/ }, (args) => {
      const file = relative(repo, args.path).split(sep).join("/"),
        contents =
          sha === "WORKTREE"
            ? readFileSync(args.path, "utf8")
            : execFileSync("git", ["show", sha + ":" + file], { cwd: repo, encoding: "utf8" });
      hashes[file] = createHash("sha256").update(contents).digest("hex");
      return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
    });
  },
};
async function load(file) {
  const built = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
    plugins: [pinned],
    logLevel: "silent",
  });
  const mod = new Module(file);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(dirname(file));
  mod._compile(built.outputFiles[0].text, file);
  return mod.exports;
}
const { compileReactModule } = await load(root + "/src/compiler.ts");
const { normalizeReactCompilerOptions } = await load(root + "/src/index.ts");
const cases = [
  {
    name: "conditionalScript",
    tag: '<div id="target">{value && <script>{"window.__scriptRuns.push(1)"}</script>}</div>',
  },
  {
    name: "keyedScript",
    rows: true,
    tag: '<div id="target">{items.map(item=><div key={item.id}><script>{"window.__scriptRuns.push(1)"}</script><span>{item.label}</span></div>)}</div>',
  },
  {
    name: "conditionalJsonScriptControl",
    tag: '<div id="target">{value && <script type="application/json">{"{}"}</script>}</div>',
  },
];
const modes = ["static", "hybrid"];
const hydration = [false, true];
const source = (test) => `import React,{useState,useEffect} from 'react';
export function Probe(){const [value,setValue]=useState(false);${test.rows ? "const [items,setItems]=useState([]);" : ""}return <main><button id="toggle" onClick={()=>{setValue(current=>!current);${test.rows ? 'setItems(rows=>rows.length?[]:[{id:1,label:"one"}]);' : ""}}}>Toggle</button>${test.tag}<output id="state">{String(value)}</output></main>;}
export function Boundary(){useEffect(()=>{window.__ready=true;},[]);return <Probe/>;}`;
const assets = new Map(),
  markup = new Map(),
  compilation = [],
  rejected = [];
for (const test of cases)
  for (const mode of modes) {
    const input = source(test),
      result = await compileReactModule(
        input,
        root + "/Scan.tsx",
        normalizeReactCompilerOptions({ reactivity: mode }),
      );
    compilation.push({
      name: test.name,
      mode,
      compiled: result.compiled,
      diagnostics: result.diagnostics,
    });
    if (!result.compiled.includes("Probe")) {
      rejected.push({ name: test.name, mode, diagnostics: result.diagnostics });
    }
    for (const hydrate of hydration)
      for (const [variant, code] of Object.entries({ off: input, on: result.code })) {
        const key = `/${test.name}-${mode}-${hydrate}-${variant}`;
        const entry =
          `window.__scriptRuns=[];\n` +
          code +
          `\nimport {createRoot,hydrateRoot} from 'react-dom/client';${hydrate ? 'hydrateRoot(document.querySelector("#app"),<Boundary/>,{onRecoverableError:error=>{throw error;}});' : 'createRoot(document.querySelector("#app")).render(<Boundary/>);'}`;
        const built = await esbuild.build({
          stdin: {
            contents: entry,
            loader: "tsx",
            sourcefile: root + "/Scan.tsx",
            resolveDir: root,
          },
          bundle: true,
          platform: "browser",
          format: "esm",
          minify: true,
          jsx: "automatic",
          write: false,
          define: { "process.env.NODE_ENV": '"production"', "import.meta.hot": "undefined" },
          alias: { "@farm.js/react/compiler-runtime": root + "/src/compiler-runtime.tsx" },
          plugins: [pinned],
          logLevel: "silent",
        });
        assets.set(key + ".js", built.outputFiles[0].text);
        if (hydrate) {
          const file = root + "/Server.tsx";
          const built = await esbuild.build({
            stdin: { contents: code, loader: "tsx", sourcefile: file, resolveDir: root },
            bundle: true,
            platform: "node",
            format: "cjs",
            packages: "external",
            write: false,
            jsx: "automatic",
            define: { "process.env.NODE_ENV": '"production"', "import.meta.hot": "undefined" },
            alias: { "@farm.js/react/compiler-runtime": root + "/src/compiler-runtime.tsx" },
            plugins: [pinned],
            logLevel: "silent",
          });
          const mod = new Module(file);
          mod.filename = file;
          mod.paths = Module._nodeModulePaths(root);
          mod._compile(built.outputFiles[0].text, file);
          markup.set(
            key,
            require("react-dom/server").renderToString(
              require("react").createElement(mod.exports.Boundary),
            ),
          );
        }
      }
  }
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (assets.has(path)) {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(assets.get(path));
    return;
  }
  if (assets.has(path + ".js")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="app">${markup.get(path) || ""}</div><script type="module" src="${path}.js"></script></body></html>`,
    );
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  for (const test of cases)
    for (const mode of modes)
      for (const hydrate of hydration) {
        const variants = {};
        for (const variant of ["off", "on"]) {
          const page = await browser.newPage();
          page.setDefaultTimeout(10000);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.route("**/*", (route) => {
            const u = new URL(route.request().url());
            return u.hostname === "127.0.0.1" ? route.continue() : route.abort();
          });
          await page.goto(
            `http://127.0.0.1:${server.address().port}/${test.name}-${mode}-${hydrate}-${variant}`,
          );
          await page.waitForFunction(() => window.__ready === true);
          const snapshots = [];
          for (let step = 0; step < 4; step++) {
            await expect(page.locator("#state")).toHaveText(String(step % 2 !== 0));
            snapshots.push(
              await page.locator("#target").evaluate((el) => ({
                scripts: [...window.__scriptRuns],
                text: el.textContent,
              })),
            );
            if (step < 3) await page.locator("#toggle").click();
          }
          variants[variant] = { snapshots, errors };
          await page.close();
        }
        assert.deepEqual(variants.on, variants.off, `${test.name} ${mode} hydration=${hydrate}`);
        assert.deepEqual(variants.on.errors, []);
        for (const snapshot of variants.on.snapshots) assert.deepEqual(snapshot.scripts, []);
        const equal = true;
        results.push({ name: test.name, mode, hydrate, equal, ...variants });
        console.log(JSON.stringify({ kind: "comparison", ...results.at(-1) }));
      }
  console.log(
    JSON.stringify({
      kind: "summary",
      sha,
      node: process.version,
      react: require("react").version,
      browser: browser.version(),
      comparisons: results.length,
      mismatches: results
        .filter((v) => !v.equal)
        .map(({ name, mode, hydrate }) => ({ name, mode, hydrate })),
      compilation,
      rejected,
      hashes,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
