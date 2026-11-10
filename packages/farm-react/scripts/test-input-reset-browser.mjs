// pnpm --filter @farm.js/react build, then node scripts/test-input-reset-browser.mjs
// Optional: --executable-path /path/to/chrome. Uses the actual renderer plugin.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build, createServer } from "vite";
import { createFarmRendererPlugin } from "../dist/vite.mjs";

const { values } = parseArgs({ options: { "executable-path": { type: "string" } } });
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(packageRoot, "../..");
const { chromium } = createRequire(`${repo}/package.json`)("@playwright/test");
const cacheDir = await mkdtemp(join(tmpdir(), "farm-input-reset-browser-"));
const entry = `${packageRoot}/fixtures/runtime-size/direct.tsx`;
const fixture = `
import React, {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
export function InputReset() {
  const [value, setValue] = useState('before');
  const [number, setNumber] = useState('1');
  const [rows, setRows] = useState([{id: 1, label: 'row before'}]);
  return <form>
    <output>{value}:{number}</output>
    <input id="text" value={value} readOnly />
    <input id="number" type="number" value={number} readOnly />
    <input id="uncontrolled" defaultValue="initial" />
    <button id="update" type="button" onClick={() => {setValue('after');setNumber('2');setRows(current => current.map(row => ({...row, label: 'row after'})));}}>Update</button>
    <button id="clear" type="button" onClick={() => {setValue('');setNumber('');}}>Clear</button>
    <button id="add" type="button" onClick={() => setRows(current => [...current, {id: 2, label: 'new row'}])}>Add</button>
    <button id="reverse" type="button" onClick={() => setRows(current => current.toReversed())}>Reverse</button>
    <button id="reset" type="reset">Reset</button>
    <ul>{rows.map(row => <li key={row.id}><input data-key={row.id} value={row.label} readOnly /></li>)}</ul>
  </form>;
}
createRoot(document.querySelector('#app')).render(<StrictMode><InputReset /></StrictMode>);
`;
const html = (production) =>
  `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="app"></div>${production ? "" : '<script type="module" src="/@vite/client"></script>'}<script type="module" src="${production ? "/bundle.js" : "/fixtures/runtime-size/direct.tsx"}"></script></body></html>`;

const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: values["executable-path"] });
  for (const production of [false, true]) {
    for (const reactivity of ["static", "hybrid"]) {
      const stories = [];
      for (const compiled of [false, true]) {
        const config = {
          configFile: false,
          root: packageRoot,
          cacheDir,
          logLevel: "error",
          css: { postcss: { plugins: [] } },
          resolve: {
            alias: {
              "@farm.js/react/compiler-runtime": `${packageRoot}/dist/compiler-runtime.mjs`,
            },
          },
          plugins: [
            {
              name: "input-reset-fixture",
              enforce: "pre",
              load(id) {
                if (id === entry) return fixture;
              },
              configureServer(server) {
                server.middlewares.use((req, res, next) => {
                  if (req.url !== "/") return next();
                  res.setHeader("content-type", "text/html");
                  res.end(html(false));
                });
              },
            },
            ...createFarmRendererPlugin({
              rendererOptions: {
                compiler: compiled ? { reactivity, onUnsupported: "error" } : false,
              },
            }),
            {
              name: "input-reset-compilation-proof",
              enforce: "post",
              transform(code, id) {
                if (id === entry)
                  assert.equal(code.includes("createCompiledComponentWithFeatures"), compiled);
              },
            },
          ],
        };
        let server;
        let close;
        let page;
        try {
          if (production) {
            const result = await build({
              ...config,
              build: { write: false, minify: "esbuild", rollupOptions: { input: entry } },
            });
            const chunks = [result]
              .flat()
              .flatMap((result) => result.output)
              .filter((output) => output.type === "chunk");
            assert.equal(chunks.length, 1);
            server = createHttpServer((req, res) => {
              if (req.url !== "/" && req.url !== "/bundle.js") {
                res.writeHead(404);
                res.end();
                return;
              }
              res.setHeader(
                "content-type",
                req.url === "/bundle.js" ? "text/javascript" : "text/html",
              );
              res.end(req.url === "/bundle.js" ? chunks[0].code : html(true));
            });
            await new Promise((resolve, reject) => {
              server.once("error", reject);
              server.listen(0, "127.0.0.1", resolve);
            });
            close = () =>
              new Promise((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
              );
          } else {
            const vite = await createServer({
              ...config,
              server: { host: "127.0.0.1", port: 0 },
              optimizeDeps: {
                include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
              },
            });
            close = () => vite.close();
            await vite.listen();
            server = vite.httpServer;
            const result = await vite.transformRequest("/fixtures/runtime-size/direct.tsx");
            assert.equal(result.code.includes("createCompiledComponentWithFeatures"), compiled);
          }
          page = await browser.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          page.on("requestfailed", (request) => errors.push(request.url()));
          page.on("console", (message) => {
            if (message.type() === "error") errors.push(message.text());
          });
          const response = await page.goto(`http://127.0.0.1:${server.address().port}/`);
          assert.equal(response.status(), 200);
          await page.waitForFunction(
            () => document.querySelector("output")?.textContent === "before:1",
          );
          await page.evaluate(() => {
            window.firstRow = document.querySelector('[data-key="1"]');
          });
          await page.locator("#uncontrolled").fill("user edit");
          const snapshots = [];
          const snapshot = async (label) => {
            const state = await page.evaluate(() => ({
              output: document.querySelector("output").textContent,
              inputs: [...document.querySelectorAll("input")].map((input) => ({
                value: input.value,
                defaultValue: input.defaultValue,
              })),
              identity: document.querySelector('[data-key="1"]') === window.firstRow,
            }));
            assert.equal(state.identity, true);
            snapshots.push({ label, ...state });
          };
          await snapshot("initial");
          await page.locator("#number").focus();
          // A real click would move focus away; programmatic click preserves it.
          await page.locator("#update").evaluate((button) => button.click());
          await page.waitForFunction(
            () => document.querySelector("output").textContent === "after:2",
          );
          assert.equal(await page.locator("#number").evaluate((input) => input.defaultValue), "1");
          await snapshot("focused number update");
          await page.locator("#number").evaluate((input) => input.blur());
          assert.equal(await page.locator("#number").evaluate((input) => input.defaultValue), "2");
          await snapshot("number blur");
          for (const id of ["reset", "add", "reverse", "update", "reset", "clear", "reset"]) {
            await page.locator(`#${id}`).click();
            // Await the queued compiler update, then snapshot after browser default actions.
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
            await snapshot(id);
          }
          await page.locator("#update").click();
          await page.waitForFunction(
            () => document.querySelector("output").textContent === "after:2",
          );
          await page.locator("#text").focus();
          await page.locator("#text").evaluate((input) => input.setSelectionRange(1, 3));
          await page.locator("#update").evaluate((button) => button.click());
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          assert.deepEqual(
            await page
              .locator("#text")
              .evaluate((input) => [
                document.activeElement === input,
                input.selectionStart,
                input.selectionEnd,
              ]),
            [true, 1, 3],
          );
          await snapshot("selection");
          assert.deepEqual(errors, []);
          stories.push(snapshots);
          results.push({ production, reactivity, compiled, steps: snapshots.length, errors });
        } finally {
          try {
            await page?.close();
          } finally {
            await close?.();
          }
        }
      }
      assert.deepEqual(
        stories[1],
        stories[0],
        `${production ? "production" : "development"} ${reactivity} input reset parity`,
      );
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await browser?.close();
  await rm(cacheDir, { recursive: true, force: true });
}
