// Real Farm development/HMR control for the production-only compiler cache.
// Build core and React first. Node 24+, CHROME_PATH selects an installed browser.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageRoot = join(workspace, "packages/farm-react");
const { chromium, expect } = createRequire(join(workspace, "package.json"))("@playwright/test");
const root = await mkdtemp(join(packageRoot, ".tmp-compiler-cache-dev-"));
const evidence = await mkdtemp(join(tmpdir(), "farm-compiler-cache-dev-"));
process.env.FARM_CACHE_BENCH_CHILD = "candidate";
process.env.FARM_CACHE_BENCH_STATS = join(evidence, "stats.json");
process.env.FARM_TELEMETRY_DISABLED = "1";
await import("./benchmark-compiler-build.mjs");
const { createServer } = await import("@farm.js/core/server");
const source = (step, label) => `"use client";
import {useState} from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return <main><button onClick={() => setCount(value => value + ${step})}>${label}</button>
    <output data-count={count}>{count}</output><input aria-label="Draft" defaultValue="draft"/>
    <a href="/other">Other</a></main>;
}`;
let server, browser;
try {
  await mkdir(join(root, "node_modules/@farm.js"), { recursive: true });
  for (const [name, directory] of [
    ["core", "farm"],
    ["react", "farm-react"],
  ]) {
    await symlink(
      join(workspace, "packages", directory),
      join(root, "node_modules/@farm.js", name),
      "junction",
    );
  }
  await mkdir(join(root, "src/app/other"), { recursive: true });
  await mkdir(join(root, "src/components"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    join(root, "farm.config.ts"),
    `import {react} from '@farm.js/react'; export default {
    renderer:react({compiler:true}), telemetry:false, vite:{server:{host:'127.0.0.1',port:0}}
  };`,
  );
  await writeFile(
    join(root, "src/app/layout.tsx"),
    `export default function Layout({children}) {return <html><body>{children}</body></html>;}`,
  );
  const entry = join(root, "src/components/counter.tsx");
  await writeFile(entry, source(1, "Original increment"));
  await writeFile(
    join(root, "src/app/page.tsx"),
    `"use client"; import {Counter} from '../components/counter'; export default function Page(){return <Counter/>;}`,
  );
  await writeFile(
    join(root, "src/app/other/page.tsx"),
    `"use client"; export default function Other(){return <main><h1>Other route</h1><a href="/">Back</a></main>;}`,
  );
  server = await createServer({ root });
  await server.listen(0);
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const stats = globalThis.__farmBuildCacheProbe;
  const html = await (await fetch(origin)).text();
  assert(html.includes('data-count="0"'), "SSR output missing");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Original increment" }).click();
  await expect(page.locator("output")).toHaveText("1");
  const transformed = await (await fetch(origin + "/src/components/counter.tsx")).text();
  assert(transformed.includes("createCompiledComponent"), "Fixture did not compile");
  const warmCalls = stats.compiles;
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await page.getByRole("button", { name: "Original increment" }).click();
    await expect(page.locator("output")).toHaveText("1");
  }
  assert.equal(stats.compiles, warmCalls, "Warm reload unexpectedly recompiles");
  await page.getByLabel("Draft").fill("keep this draft");
  await page.evaluate(() => {
    window.probeDocument = document;
    window.probeInput = document.querySelector("input");
  });
  await writeFile(entry, source(2, "Edited increment"));
  await expect(page.getByRole("button", { name: "Edited increment" })).toBeVisible();
  await expect(page.locator("output")).toHaveText("1");
  await page.getByRole("button", { name: "Edited increment" }).click();
  await expect(page.locator("output")).toHaveText("3");
  assert((await (await fetch(origin)).text()).includes("Edited increment"));
  await writeFile(entry, source(1, "Original increment"));
  await expect(page.getByRole("button", { name: "Original increment" })).toBeVisible();
  await page.getByRole("button", { name: "Original increment" }).click();
  await expect(page.locator("output")).toHaveText("4");
  await expect(page.getByLabel("Draft")).toHaveValue("keep this draft");
  assert(
    await page.evaluate(
      () =>
        window.probeDocument === document && window.probeInput === document.querySelector("input"),
    ),
  );
  await page.getByRole("link", { name: "Other", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Other route" })).toBeVisible();
  await page.getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Original increment" })).toBeVisible();
  assert(
    await page.evaluate(() => window.probeDocument === document),
    "Navigation reloaded the document",
  );
  await page.getByRole("button", { name: "Original increment" }).click();
  await expect(page.locator("output")).toHaveText("1");
  assert.deepEqual(errors, []);
  await browser.close();
  browser = undefined;
  await server.close();
  server = undefined;
  assert.equal(stats.compiles, stats.transforms, "Development used the production cache");
  assert.deepEqual(stats.scopes, [], "Development allocated a build cache");
  console.log(
    JSON.stringify({ passed: true, warmReloadCompiles: 0, compiles: stats.compiles, evidence }),
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
