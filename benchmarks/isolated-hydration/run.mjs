import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchmarkDirectory, "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "node_modules", "@playwright", "test"));
const generatedDirectory = path.join(benchmarkDirectory, ".generated");
const resultsDirectory = path.join(benchmarkDirectory, "results");
const iterations = Number(process.env.BENCH_ITERATIONS || 25);
const warmups = Number(process.env.BENCH_WARMUPS || 5);
const serverIterations = Number(process.env.BENCH_SERVER_ITERATIONS || iterations);
const serverWarmups = Number(process.env.BENCH_SERVER_WARMUPS || warmups);
const serverSentinel = "FARM_ISOLATED_HYDRATION_SERVER_OWNER_SENTINEL";
const requestedShapes = new Set(
  (process.env.BENCH_SHAPES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const requestedModes = new Set(
  (process.env.BENCH_MODES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const isPartialRun = requestedShapes.size > 0 || requestedModes.size > 0;
const shapes = [
  { id: "leaf", boundaries: 1, staticNodes: 768, includeRsc: true },
  { id: "siblings", boundaries: 4, staticNodes: 384, includeRsc: true },
  { id: "stress-8", boundaries: 8, staticNodes: 128, includeRsc: false },
  { id: "stress-16", boundaries: 16, staticNodes: 128, includeRsc: false },
  { id: "stress-32", boundaries: 32, staticNodes: 128, includeRsc: false },
  { id: "stress-64", boundaries: 64, staticNodes: 128, includeRsc: false },
].filter((shape) => requestedShapes.size === 0 || requestedShapes.has(shape.id));
const activeChildren = new Set();

function assertSupportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported = (major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major > 24;
  if (!supported) {
    throw new Error(
      "Use Node 22.19+ below 23, or Node 24.11+ for comparable isolated hydration results. Current: " +
        process.versions.node,
    );
  }
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function readGuardMaximum() {
  const source = await readFile(
    path.join(repositoryRoot, "packages", "farm", "src", "utils", "client-component.ts"),
    "utf8",
  );
  const match = source.match(/FARM_ISOLATED_HYDRATION_MAX_BOUNDARIES\s*=\s*(\d+)/);
  if (!match) throw new Error("Could not read the isolated hydration boundary guard");
  return Number(match[1]);
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction));
  return sorted[index];
}

function seededRandom(seed = 0x5f3759df) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function summarize(samples) {
  if (samples.length === 0) return { p50: 0, p95: 0, medianCi95: [0, 0], samples };
  const random = seededRandom(samples.length * 7919);
  const bootstrapMedians = [];
  for (let sampleIndex = 0; sampleIndex < 2_000; sampleIndex += 1) {
    const resample = Array.from(
      { length: samples.length },
      () => samples[Math.floor(random() * samples.length)],
    );
    bootstrapMedians.push(percentile(resample, 0.5));
  }
  return {
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    medianCi95: [
      round(percentile(bootstrapMedians, 0.025)),
      round(percentile(bootstrapMedians, 0.975)),
    ],
    samples: samples.map((sample) => round(sample)),
  };
}

function sumSizes(buffers) {
  return buffers.reduce(
    (total, buffer) => ({
      raw: total.raw + buffer.byteLength,
      gzip: total.gzip + gzipSync(buffer, { level: 9 }).byteLength,
      brotli: total.brotli + brotliCompressSync(buffer).byteLength,
    }),
    { raw: 0, gzip: 0, brotli: 0 },
  );
}

async function walkFiles(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(absolutePath)));
    else files.push(absolutePath);
  }
  return files;
}

function run(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? repositoryRoot,
      env: {
        ...process.env,
        NO_COLOR: "1",
        NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192",
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => {
      activeChildren.delete(child);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${arguments_.join(" ")} exited ${code}\n${output}`));
    });
  });
}

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(url, child, readLogs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes(serverSentinel)) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Server at ${url} did not become ready\n${readLogs()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function staticMarkup(nodeCount) {
  return Array.from(
    { length: nodeCount },
    (_, index) =>
      `<article data-static-node="${index}"><h2>Server row ${index}</h2><p>Static account and product summary ${index} stays owned by the server layout.</p></article>`,
  ).join("\n");
}

function counterSource(index) {
  return `
"use client";

import { useState } from "react";

export default function Counter${index}() {
  const [count, setCount] = useState(0);
  return <button data-counter="${index}" onClick={() => setCount((value) => value + 1)}>counter-${index}:{count}</button>;
}
`.trim();
}

async function linkFixtureDependency(root, name, source) {
  const destination = path.join(root, "node_modules", ...name.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(
    await realpath(source),
    destination,
    process.platform === "win32" ? "junction" : "dir",
  );
}

async function linkFixtureDependencies(root, rsc) {
  const simpleModules = path.join(repositoryRoot, "examples", "simple-demo", "node_modules");
  const rscModules = path.join(repositoryRoot, "examples", "rsc-demo", "node_modules");
  const rendererModules = rsc ? rscModules : simpleModules;
  await linkFixtureDependency(root, "@farm.js/core", path.join(repositoryRoot, "packages", "farm"));
  await linkFixtureDependency(root, "react", path.join(rendererModules, "react"));
  await linkFixtureDependency(root, "react-dom", path.join(rendererModules, "react-dom"));
  if (!rsc) return;

  await linkFixtureDependency(
    root,
    "@farm.js/plugin",
    path.join(repositoryRoot, "packages", "farmjs-plugin"),
  );
  for (const dependency of [
    "@vitejs/plugin-react",
    "@vitejs/plugin-rsc",
    "rsc-html-stream",
    "react-server-dom-webpack",
    "vite",
  ]) {
    await linkFixtureDependency(root, dependency, path.join(rscModules, ...dependency.split("/")));
  }
}

function layoutSource(shape, rsc) {
  const componentPrefix = rsc ? "./components" : "../components";
  const imports = Array.from(
    { length: shape.boundaries },
    (_, index) => `import Counter${index} from "${componentPrefix}/counter-${index}";`,
  ).join("\n");
  const counters = Array.from(
    { length: shape.boundaries },
    (_, index) => `<Counter${index} />`,
  ).join("\n");
  const type = rsc ? ": { children: React.ReactNode }" : "";
  const reactImport = rsc ? 'import React from "react";\n' : "";
  return `
${reactImport}${imports}

const serverOwnerSentinel = "${serverSentinel}";

export default function RootLayout({ children }${type}) {
  return (
    <section data-server-owner={serverOwnerSentinel} data-layout-retained="true">
      <nav><a href="/" data-nav-home>Home</a><a href="/next" data-nav-next>Next</a></nav>
      <div data-client-leaves>${counters}</div>
      <div data-static-layout>${staticMarkup(shape.staticNodes)}</div>
      {children}
    </section>
  );
}
`.trim();
}

async function writeStandardFixture(root, shape, isolated) {
  await linkFixtureDependencies(root, false);
  const sourceRoot = path.join(root, "src");
  await mkdir(path.join(sourceRoot, "app", "next"), { recursive: true });
  await mkdir(path.join(sourceRoot, "components"), { recursive: true });
  await Promise.all(
    Array.from({ length: shape.boundaries }, (_, index) =>
      writeFile(path.join(sourceRoot, "components", `counter-${index}.tsx`), counterSource(index)),
    ),
  );
  await writeFile(path.join(sourceRoot, "app", "globals.css"), "");
  await writeFile(path.join(sourceRoot, "app", "layout.tsx"), layoutSource(shape, false));
  await writeFile(
    path.join(sourceRoot, "app", "page.tsx"),
    'export default function Page() { return <main data-page="home"><h1>Home page</h1></main>; }\n',
  );
  await writeFile(
    path.join(sourceRoot, "app", "next", "page.tsx"),
    'export default function Page() { return <main data-page="next"><h1>Next page</h1></main>; }\n',
  );
  await writeFile(
    path.join(root, "farm.config.ts"),
    `import { defineConfig } from "@farm.js/core";\nexport default defineConfig({ images: { provider: "none" }, experimental: { isolatedClientHydration: "${isolated ? "enabled" : "off"}" } });\n`,
  );
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: `farm-isolated-${shape.id}-${isolated ? "on" : "off"}`, private: true, type: "module" }, null, 2)}\n`,
  );
}

async function writeRscFixture(root, shape) {
  await linkFixtureDependencies(root, true);
  const sourceRoot = path.join(root, "src");
  await mkdir(path.join(sourceRoot, "next"), { recursive: true });
  await mkdir(path.join(sourceRoot, "components"), { recursive: true });
  await Promise.all(
    Array.from({ length: shape.boundaries }, (_, index) =>
      writeFile(path.join(sourceRoot, "components", `counter-${index}.tsx`), counterSource(index)),
    ),
  );
  await writeFile(path.join(sourceRoot, "layout.tsx"), layoutSource(shape, true));
  await writeFile(
    path.join(sourceRoot, "page.tsx"),
    'import React from "react";\nexport default function Page() { return <main data-page="home"><h1>Home page</h1></main>; }\n',
  );
  await writeFile(
    path.join(sourceRoot, "next", "page.tsx"),
    'import React from "react";\nexport default function Page() { return <main data-page="next"><h1>Next page</h1></main>; }\n',
  );
  await writeFile(
    path.join(root, "vite.config.ts"),
    `
import rsc from "@vitejs/plugin-rsc";
import react from "@vitejs/plugin-react";
import { defineConfig, nitro } from "@farm.js/plugin/rsc";

export default defineConfig({
  srcDir: "src",
  routesDir: "",
  outDir: "dist",
  experimental: { optimizedBoundary: true },
  plugins: [
    rsc({
      serverHandler: false,
      entries: {
        rsc: "./.farm/rsc-entries/entry.rsc.tsx",
        ssr: "./.farm/rsc-entries/entry.ssr.tsx",
        client: "./.farm/rsc-entries/entry.browser.tsx",
      },
    }),
    react(),
    nitro({ server: { environmentName: "rsc" }, config: { preset: "node-server" } }),
  ],
});
`.trim(),
  );
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: `farm-rsc-${shape.id}`, private: true, type: "module" }, null, 2)}\n`,
  );
}

async function buildVariant(shape, mode) {
  const root = path.join(generatedDirectory, `${shape.id}-${mode}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const buildStart = performance.now();
  if (mode === "rsc") {
    await writeRscFixture(root, shape);
    const viteBin = path.join(
      repositoryRoot,
      "examples",
      "rsc-demo",
      "node_modules",
      ".bin",
      "vite",
    );
    const buildRsc = () =>
      run(viteBin, ["build"], {
        cwd: root,
        env: { NITRO_PRESET: "node-server" },
      });
    await buildRsc();
    // The first clean invocation materializes Farm's generated RSC entries.
    // Older Vite RSC releases then require one normal invocation to consume them.
    if (!existsSync(path.join(root, ".output", "server", "index.mjs"))) await buildRsc();
  } else {
    await writeStandardFixture(root, shape, mode === "isolated");
    await run(
      process.execPath,
      [
        path.join(repositoryRoot, "packages", "farm-cli", "bin", "farm.js"),
        "build",
        "--preset",
        "node-server",
      ],
      {
        cwd: root,
        env:
          mode === "isolated" && shape.id.startsWith("stress-")
            ? {
                FARM_INTERNAL_BENCHMARK: "isolated-hydration",
                FARM_INTERNAL_ISOLATED_HYDRATION_BENCHMARK_ROOT: generatedDirectory,
                FARM_INTERNAL_ISOLATED_HYDRATION_BENCHMARK_LIMIT: "1024",
              }
            : {},
      },
    );
  }
  const buildMs = performance.now() - buildStart;
  const clientDirectory =
    mode === "rsc" ? path.join(root, ".output", "public") : path.join(root, ".farm", "client");
  const clientFiles = (await walkFiles(clientDirectory)).filter((file) => file.endsWith(".js"));
  const clientBuffers = await Promise.all(clientFiles.map((file) => readFile(file)));
  const clientText = Buffer.concat(clientBuffers).toString("utf8");
  if (mode !== "route-wide" && clientText.includes(serverSentinel)) {
    throw new Error(`${shape.id}/${mode} leaked its server-layout sentinel into client JavaScript`);
  }
  if (mode === "route-wide" && !clientText.includes(serverSentinel)) {
    throw new Error(`${shape.id}/${mode} did not include the route-wide layout control`);
  }
  return {
    root,
    mode,
    buildMs: round(buildMs),
    clientDirectory,
    clientFiles,
    clientJavaScript: sumSizes(clientBuffers),
    serverEntry:
      mode === "rsc"
        ? path.join(root, ".output", "server", "index.mjs")
        : path.join(root, ".farm", ".output", "server", "index.mjs"),
  };
}

async function startVariant(variant) {
  const port = await availablePort();
  let logs = "";
  const child = spawn(process.execPath, [variant.serverEntry], {
    cwd: variant.root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChildren.add(child);
  child.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  child.on("exit", () => activeChildren.delete(child));
  const url = `http://127.0.0.1:${port}/`;
  await waitForServer(url, child, () => logs);
  return { child, url, logs: () => logs };
}

function markerBytes(html) {
  const markers = [
    ...html.matchAll(/<farm-client-boundary\b[^>]*>|<\/farm-client-boundary>/g),
    ...html.matchAll(/<script\b[^>]*data-farm-client-props[^>]*>[\s\S]*?<\/script>/g),
  ];
  return markers.reduce((total, match) => total + Buffer.byteLength(match[0]), 0);
}

async function measureServer(url) {
  for (let index = 0; index < serverWarmups; index += 1) {
    await fetch(url).then((response) => response.arrayBuffer());
  }
  const samples = [];
  let html = "";
  for (let index = 0; index < serverIterations; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(url);
    html = await response.text();
    samples.push(performance.now() - startedAt);
  }
  return {
    responseMs: summarize(samples),
    htmlBytes: Buffer.byteLength(html),
    markerBytes: markerBytes(html),
  };
}

function metric(metrics, name) {
  return metrics.find((item) => item.name === name)?.value ?? 0;
}

async function waitForHydration(page, mode, boundaryCount) {
  return page.evaluate(
    ({ hydrationMode, expectedBoundaries }) =>
      new Promise((resolve) => {
        const check = () => {
          if (hydrationMode === "isolated") {
            if (
              document.querySelectorAll('farm-client-boundary[data-farm-hydrated="true"]')
                .length === expectedBoundaries
            ) {
              resolve(performance.now());
              return;
            }
          } else {
            const button = document.querySelector('[data-counter="0"]');
            if (button && Object.keys(button).some((key) => key.startsWith("__reactProps$"))) {
              resolve(performance.now());
              return;
            }
          }
          requestAnimationFrame(check);
        };
        check();
      }),
    { hydrationMode: mode, expectedBoundaries: boundaryCount },
  );
}

async function clickAndMeasure(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!(target instanceof HTMLElement)) throw new Error(`Missing ${targetSelector}`);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve(performance.now() - startedAt);
      });
      observer.observe(target, { subtree: true, characterData: true, childList: true });
      const startedAt = performance.now();
      target.click();
    });
  }, selector);
}

async function navigateAndMeasure(page, destination) {
  return page.evaluate((nextPage) => {
    const link = document.querySelector(`[data-nav-${nextPage}]`);
    if (!(link instanceof HTMLElement)) throw new Error(`Missing navigation link for ${nextPage}`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Navigation to ${nextPage} did not commit`));
      }, 10_000);
      const observer = new MutationObserver(() => {
        if (!document.querySelector(`[data-page="${nextPage}"]`)) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolve(performance.now() - startedAt);
      });
      observer.observe(document.body, { subtree: true, childList: true });
      const startedAt = performance.now();
      link.click();
    });
  }, destination);
}

async function measureColdBrowser(browser, variant, shape) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("Profiler.enable");
  await session.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const before = await session.send("Performance.getMetrics");
  const navigationStartedAt = performance.now();
  await page.goto(variant.url, { waitUntil: "domcontentloaded" });
  const responseEnd = await page.evaluate(
    () => performance.getEntriesByType("navigation")[0]?.responseEnd ?? 0,
  );
  const hydrationEnd = await waitForHydration(page, variant.mode, shape.boundaries);
  const firstInteractionMs = await clickAndMeasure(page, '[data-counter="0"]');
  const after = await session.send("Performance.getMetrics");
  const coverage = await session.send("Profiler.takePreciseCoverage");
  await session.send("Profiler.stopPreciseCoverage");
  const resourceEntries = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
    })),
  );
  const origin = new URL(variant.url).origin;
  const executedScripts = coverage.result.filter(
    (script) =>
      script.url.startsWith(origin) &&
      script.functions.some((fn) => fn.ranges.some((range) => range.count > 0)),
  );
  const result = {
    totalInteractiveMs: performance.now() - navigationStartedAt,
    hydrationMs: Math.max(0, hydrationEnd - responseEnd),
    firstInteractionMs,
    scriptMs:
      (metric(after.metrics, "ScriptDuration") - metric(before.metrics, "ScriptDuration")) * 1_000,
    compileMs:
      (metric(after.metrics, "V8CompileDuration") - metric(before.metrics, "V8CompileDuration")) *
      1_000,
    heapBytes: metric(after.metrics, "JSHeapUsedSize"),
    requestCount: requests.filter((url) => url.startsWith(origin)).length,
    scriptRequestCount: resourceEntries.filter((entry) => {
      if (!entry.name.startsWith(origin)) return false;
      return /\.(?:m?js)(?:$|[?#])/.test(entry.name);
    }).length,
    executedScriptResources: new Set(executedScripts.map((script) => script.url)).size,
  };
  await context.close();
  return result;
}

async function measureWarmNavigation(browser, variant, shape) {
  const page = await browser.newPage();
  await page.goto(variant.url, { waitUntil: "domcontentloaded" });
  await waitForHydration(page, variant.mode, shape.boundaries);
  const counterCount = await page.locator("[data-counter]").count();
  if (counterCount !== shape.boundaries) {
    throw new Error(
      `${shape.id}/${variant.mode} rendered ${counterCount} counters, expected ${shape.boundaries}`,
    );
  }
  for (let index = 0; index < counterCount; index += 1) {
    await clickAndMeasure(page, `[data-counter="${index}"]`);
  }
  const samples = [];
  const retainedLayout = await page.locator("[data-server-owner]").elementHandle();
  for (let index = 0; index < warmups + iterations; index += 1) {
    const destination = index % 2 === 0 ? "next" : "home";
    const navigationMs = await navigateAndMeasure(page, destination);
    if (index >= warmups) samples.push(navigationMs);
  }
  const stateRetained = (await page.locator("[data-counter]").allTextContents()).every(
    (value, index) => value === `counter-${index}:1`,
  );
  const layoutRetained = retainedLayout
    ? await retainedLayout.evaluate(
        (element) => element === document.querySelector("[data-server-owner]"),
      )
    : false;
  await page.close();
  if (!stateRetained || !layoutRetained) {
    throw new Error(
      `${shape.id}/${variant.mode} did not retain client state and layout DOM during navigation`,
    );
  }
  return summarize(samples);
}

async function measureBrowser(browser, variant, shape) {
  const coldSamples = [];
  for (let index = 0; index < warmups + iterations; index += 1) {
    const sample = await measureColdBrowser(browser, variant, shape);
    if (index >= warmups) coldSamples.push(sample);
  }
  const summarizeKey = (key) => summarize(coldSamples.map((sample) => sample[key]));
  return {
    totalInteractiveMs: summarizeKey("totalInteractiveMs"),
    hydrationMs: summarizeKey("hydrationMs"),
    firstInteractionMs: summarizeKey("firstInteractionMs"),
    scriptMs: summarizeKey("scriptMs"),
    compileMs: summarizeKey("compileMs"),
    heapBytes: summarizeKey("heapBytes"),
    requestCount: summarizeKey("requestCount"),
    scriptRequestCount: summarizeKey("scriptRequestCount"),
    executedScriptResources: summarizeKey("executedScriptResources"),
    rootCount: variant.mode === "isolated" ? shape.boundaries : 1,
    warmNavigationMs: await measureWarmNavigation(browser, variant, shape),
  };
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function comparisonRows(results) {
  const rows = [];
  for (const [shape, modes] of Object.entries(results.shapes)) {
    for (const [mode, result] of Object.entries(modes)) {
      rows.push(
        `| ${shape} | ${mode} | ${formatBytes(result.clientJavaScript.raw)} | ${formatBytes(result.clientJavaScript.gzip)} | ${formatBytes(result.clientJavaScript.brotli)} | ${result.clientChunks} | ${formatBytes(result.server.htmlBytes)} | ${formatBytes(result.server.markerBytes)} |`,
      );
    }
  }
  return rows;
}

function runtimeRows(results) {
  const rows = [];
  for (const [shape, modes] of Object.entries(results.shapes)) {
    for (const [mode, result] of Object.entries(modes)) {
      rows.push(
        `| ${shape} | ${mode} | ${result.server.responseMs.p50.toFixed(2)} ms | ${result.browser.scriptMs.p50.toFixed(2)} ms | ${result.browser.compileMs.p50.toFixed(2)} ms | ${result.browser.hydrationMs.p50.toFixed(2)} ms | ${result.browser.firstInteractionMs.p50.toFixed(2)} ms | ${result.browser.requestCount.p50} / ${result.browser.scriptRequestCount.p50} / ${result.browser.executedScriptResources.p50} | ${formatBytes(result.browser.heapBytes.p50)} | ${result.browser.rootCount} | ${result.browser.warmNavigationMs.p50.toFixed(2)} ms |`,
      );
    }
  }
  return rows;
}

function findCrossover(results) {
  const stressShapes = shapes.filter((shape) => shape.id.startsWith("stress-"));
  for (const shape of stressShapes) {
    const modes = results.shapes[shape.id];
    const routeWide = modes["route-wide"];
    const isolated = modes.isolated;
    if (!routeWide || !isolated) continue;
    const allowedHydration = Math.max(
      routeWide.browser.hydrationMs.medianCi95[1],
      routeWide.browser.hydrationMs.p50 * 1.05,
    );
    const allowedInteraction = Math.max(
      routeWide.browser.firstInteractionMs.medianCi95[1],
      routeWide.browser.firstInteractionMs.p50 * 1.05,
    );
    if (
      isolated.browser.hydrationMs.p50 > allowedHydration ||
      isolated.browser.firstInteractionMs.p50 > allowedInteraction
    ) {
      return shape.boundaries;
    }
  }
  return null;
}

function allowedRegression(control) {
  return Math.max(control.medianCi95[1], control.p50 * 1.05);
}

function validateResults(results) {
  const leaf = results.shapes.leaf;
  if (leaf?.isolated && leaf["route-wide"]) {
    if (leaf.isolated.clientJavaScript.gzip >= leaf["route-wide"].clientJavaScript.gzip) {
      throw new Error("The representative isolated fixture did not reduce gzip client JavaScript");
    }
    if (
      leaf.isolated.browser.hydrationMs.medianCi95[1] >=
      leaf["route-wide"].browser.hydrationMs.medianCi95[0]
    ) {
      throw new Error("The representative hydration confidence intervals are not separated");
    }
  }

  for (const shape of shapes.filter(
    (candidate) => candidate.boundaries <= results.guardMaximumBoundaries,
  )) {
    const modes = results.shapes[shape.id];
    if (!modes?.isolated || !modes["route-wide"]) continue;
    if (
      modes.isolated.browser.hydrationMs.p50 >
        allowedRegression(modes["route-wide"].browser.hydrationMs) ||
      modes.isolated.browser.firstInteractionMs.p50 >
        allowedRegression(modes["route-wide"].browser.firstInteractionMs)
    ) {
      throw new Error(`${shape.id} exceeded the accepted route-wide latency budget`);
    }
    if (
      modes.rsc &&
      (modes.isolated.browser.hydrationMs.p50 > allowedRegression(modes.rsc.browser.hydrationMs) ||
        modes.isolated.browser.firstInteractionMs.p50 >
          allowedRegression(modes.rsc.browser.firstInteractionMs))
    ) {
      throw new Error(`${shape.id} exceeded the accepted RSC latency control`);
    }
  }

  if (results.crossoverBoundaryCount) {
    const acceptedCandidates = shapes
      .filter((shape) => shape.boundaries < results.crossoverBoundaryCount)
      .map((shape) => shape.boundaries);
    if (acceptedCandidates.length === 0) return;
    const acceptedBoundaryCount = Math.max(...acceptedCandidates);
    if (acceptedBoundaryCount !== results.guardMaximumBoundaries) {
      throw new Error(
        `Measured crossover requires a ${acceptedBoundaryCount}-root guard, found ${results.guardMaximumBoundaries}`,
      );
    }
  }
}

function createMarkdown(results) {
  const crossover = results.crossoverBoundaryCount;
  return [
    "# Isolated hydration benchmark",
    "",
    `Generated ${results.generatedAt} on ${results.environment.platform} ${results.environment.arch}, Node ${results.environment.node}, ${results.environment.browser}.`,
    `${iterations} measured browser and server iterations after ${warmups} warmups. Latency cells show p50; raw samples, p95, and bootstrap median confidence intervals are in \`latest.json\`.`,
    "",
    "## Transfer and document cost",
    "",
    "| shape | mode | client JS raw | client JS gzip | client JS Brotli | chunks | HTML | markers |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...comparisonRows(results),
    "",
    "## Server and browser cost",
    "",
    "Requests are reported as total / script resources / executed script resources.",
    "",
    "| shape | mode | SSR response | script | compile | hydration | first interaction | requests | heap | roots | warm nav |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...runtimeRows(results),
    "",
    crossover
      ? `The first measured stress regression beyond the 5% or confidence-interval budget occurred at ${crossover} independent roots. The deterministic guard therefore keeps plans with ${results.guardMaximumBoundaries} or fewer statically bounded isolated roots and sends larger or data-dependent plans through route-wide hydration.`
      : "No crossover was observed in the measured stress range. The guard remains conservative at the largest accepted fixture.",
    "",
    "The RSC rows are controls built with Farm's RSC plugin and optimized server boundary enabled. They use the same layout, counters, and navigation workload; they are not treated as route-wide fallbacks for the standard renderer.",
    "",
  ].join("\n");
}

async function main() {
  await rm(generatedDirectory, { recursive: true, force: true });
  await mkdir(generatedDirectory, { recursive: true });
  const executablePath =
    process.env.FARM_BENCH_CHROME_PATH ||
    (process.platform === "darwin" &&
    existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath } : undefined);
  const browserVersion = await browser.version();
  const results = {
    generatedAt: new Date().toISOString(),
    iterations,
    warmups,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      node: process.version,
      browser: browserVersion,
    },
    guardMaximumBoundaries: await readGuardMaximum(),
    shapes: {},
  };

  try {
    for (const shape of shapes) {
      results.shapes[shape.id] = {};
      const modes = (
        shape.includeRsc ? ["route-wide", "isolated", "rsc"] : ["route-wide", "isolated"]
      ).filter((mode) => requestedModes.size === 0 || requestedModes.has(mode));
      for (const mode of modes) {
        process.stdout.write(`\n== ${shape.id} / ${mode} ==\n`);
        const variant = await buildVariant(shape, mode);
        const running = await startVariant(variant);
        variant.url = running.url;
        try {
          const server = await measureServer(running.url);
          const browserMetrics = await measureBrowser(browser, variant, shape);
          results.shapes[shape.id][mode] = {
            buildMs: variant.buildMs,
            clientJavaScript: variant.clientJavaScript,
            clientChunks: variant.clientFiles.length,
            server,
            browser: browserMetrics,
          };
          process.stdout.write(
            `JS ${formatBytes(variant.clientJavaScript.gzip)}, hydrate ${browserMetrics.hydrationMs.p50.toFixed(2)}ms, interaction ${browserMetrics.firstInteractionMs.p50.toFixed(2)}ms, heap ${formatBytes(browserMetrics.heapBytes.p50)}, nav ${browserMetrics.warmNavigationMs.p50.toFixed(2)}ms\n`,
          );
        } catch (error) {
          throw new Error(`${String(error)}\n${running.logs()}`);
        } finally {
          await stopChild(running.child);
        }
      }
    }
  } finally {
    await browser.close();
  }

  results.crossoverBoundaryCount = findCrossover(results);
  if (isPartialRun) {
    await mkdir(generatedDirectory, { recursive: true });
    await writeFile(
      path.join(generatedDirectory, "partial-results.json"),
      `${JSON.stringify(results, null, 2)}\n`,
    );
    process.stdout.write(
      "\nPartial results written to benchmarks/isolated-hydration/.generated/partial-results.json; canonical results were not changed.\n",
    );
    return;
  }
  validateResults(results);
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    path.join(resultsDirectory, "latest.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  await writeFile(path.join(resultsDirectory, "latest.md"), `${createMarkdown(results)}\n`);
  process.stdout.write(
    "\nResults written to benchmarks/isolated-hydration/results/latest.{json,md}\n",
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of activeChildren) child.kill("SIGTERM");
  });
}

if (process.argv.includes("--verify-results")) {
  assertSupportedNode();
  if (isPartialRun) {
    throw new Error("BENCH_SHAPES and BENCH_MODES cannot be used with --verify-results");
  }
  const recorded = JSON.parse(await readFile(path.join(resultsDirectory, "latest.json"), "utf8"));
  const currentGuard = await readGuardMaximum();
  if (recorded.guardMaximumBoundaries !== currentGuard) {
    throw new Error(
      `Recorded guard ${recorded.guardMaximumBoundaries} does not match source guard ${currentGuard}`,
    );
  }
  validateResults(recorded);
  process.stdout.write("Recorded isolated hydration results satisfy the cost guards.\n");
} else {
  assertSupportedNode();
  await main();
}
