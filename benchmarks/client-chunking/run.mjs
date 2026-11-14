// Client chunking and modulepreload benchmark (see README.md). Builds the generated fixture with
// a baseline checkout and with this checkout, then measures chunks, per-route JS, preloads and
// page loads in Chromium over HTTP/1.1. Build @farm.js/core and @farm.js/cli in both first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { analyzeBuild, percentile } from "./analyze.mjs";
import { createApp, MARKER } from "./fixture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repo, "node_modules", "@playwright", "test"));

const { values: args } = parseArgs({
  options: {
    baseline: { type: "string" },
    "baseline-core": { type: "string" },
    "baseline-cli": { type: "string" },
    runs: { type: "string", default: "10" },
    warmups: { type: "string", default: "2" },
    profiles: { type: "string", default: "desktop,mobile" },
    "app-groups": { type: "boolean", default: false },
    "skip-load": { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const runs = Number(args.runs);
const warmups = Number(args.warmups);
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs must be an integer >= 1");
assert.ok(Number.isInteger(warmups) && warmups >= 0, "--warmups must be an integer >= 0");

const current = {
  core: path.join(repo, "packages/farm"),
  cli: path.join(repo, "packages/farm-cli"),
};
const baseline = args.baseline
  ? {
      core: path.join(path.resolve(args.baseline), "packages/farm"),
      cli: path.join(path.resolve(args.baseline), "packages/farm-cli"),
    }
  : args["baseline-core"]
    ? { core: path.resolve(args["baseline-core"]), cli: path.resolve(args["baseline-cli"]) }
    : current;
for (const packages of [current, baseline]) {
  for (const built of [
    path.join(packages.core, "dist/index.mjs"),
    path.join(packages.cli, "dist"),
  ]) {
    assert.ok(fs.existsSync(built), `Build ${built} first (see README.md)`);
  }
}

/** Lighthouse's desktop and mobile throttling presets, applied through the DevTools protocol. */
const PROFILES = {
  desktop: { cpu: 1, latency: 40, download: 10_000_000 / 8, upload: 10_000_000 / 8 },
  mobile: { cpu: 4, latency: 150, download: 1_600_000 / 8, upload: 750_000 / 8 },
};
const profiles = args.profiles.split(",").map((name) => {
  assert.ok(PROFILES[name], `Unknown profile ${name}`);
  return { name, ...PROFILES[name] };
});

// The grouping the original report applied in the app: React, shared node_modules, shared code.
const APP_GROUPS = `vite: { build: { rolldownOptions: { output: { codeSplitting: { groups: [
  { name: "react", test: /node_modules[\\\\/](react|react-dom|scheduler)[\\\\/]/, priority: 30 },
  { name: "vendor", test: /node_modules/, minShareCount: 2, maxSize: 500000, priority: 20 },
  { name: "shared", minShareCount: 2, maxSize: 500000, priority: 10 },
] } } } } }`;

function spawnCli(packages, root, command, extraArgs, env = {}) {
  return spawn(process.execPath, [path.join(packages.cli, "bin/farm.js"), command, ...extraArgs], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", FARM_TELEMETRY_DISABLED: "1", ...env },
  });
}

function collect(child) {
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return output;
}

const exitOf = (child) =>
  new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

async function buildVariant(name, packages, config) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `farm-chunking-${name}-`)));
  const routes = createApp(root, { corePath: packages.core, cliPath: packages.cli, config });
  const child = spawnCli(packages, root, "build", ["--preset", "node-server"]);
  const output = collect(child);
  const { code, signal } = await exitOf(child);
  if (code !== 0)
    throw new Error(`${name}: farm build failed (${code ?? signal}):\n${output.join("")}`);
  process.stderr.write(`built ${name}\n`);
  return { name, packages, root, routes, build: analyzeBuild(root, routes) };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(variant) {
  const port = await freePort();
  const child = spawnCli(variant.packages, variant.root, "start", ["--port", String(port)], {
    NITRO_HOST: "127.0.0.1",
  });
  const output = collect(child);
  const origin = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`farm start exited:\n${output.join("")}`);
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok && (await response.text()).includes(MARKER)) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() - started > 60_000)
      throw new Error(`farm start never served:\n${output.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    origin,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await exitOf(child);
      }
    },
  };
}

// Records LCP, long tasks and the moment the page's first counter has hydrated (React has
// attached its props to the element), before any page script runs.
const INIT_SCRIPT = () => {
  const bench = { lcp: 0, longTasks: [], hydratedAt: 0 };
  window.__bench = bench;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) bench.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) bench.longTasks.push([entry.startTime, entry.duration]);
  }).observe({ type: "longtask", buffered: true });
  const timer = setInterval(() => {
    const button = document.querySelector("[data-counter]");
    if (button && Object.keys(button).some((key) => key.startsWith("__reactProps"))) {
      bench.hydratedAt = performance.now();
      clearInterval(timer);
    }
  }, 20);
};

async function measureLoad(browser, origin, route, profile) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(INIT_SCRIPT);
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latency,
    downloadThroughput: profile.download,
    uploadThroughput: profile.upload,
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  const failed = [];
  const errors = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(origin + route, { waitUntil: "load", timeout: 180_000 });
  await page.waitForFunction(() => window.__bench.hydratedAt > 0, null, {
    timeout: 120_000,
    polling: 100,
  });
  // Let LCP and trailing long tasks settle.
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const { lcp, longTasks, hydratedAt } = window.__bench;
    const end = Math.max(navigation.loadEventEnd, hydratedAt);
    const scripts = performance
      .getEntriesByType("resource")
      .filter((entry) => /\.js(?:$|\?)/.test(entry.name));
    return {
      dcl: navigation.domContentLoadedEventEnd,
      load: navigation.loadEventEnd,
      lcp,
      fcp,
      hydrated: hydratedAt,
      // Total blocking time between first contentful paint and hydration (or load, if later).
      tbt: longTasks
        .filter(([start]) => start >= fcp && start <= end)
        .reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0),
      protocol: navigation.nextHopProtocol,
      jsRequests: scripts.length,
      jsTransferBytes: scripts.reduce((sum, entry) => sum + entry.transferSize, 0),
    };
  });
  await context.close();
  return { ...metrics, failed: failed.length, errors: errors.length };
}

/** Same content, no errors, no failed requests, and a working counter on every sample route. */
async function checkCorrectness(browser, servers, routes) {
  const results = {};
  for (const route of routes) {
    const seen = {};
    for (const [name, server] of Object.entries(servers)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.addInitScript(INIT_SCRIPT);
      const errors = [];
      const failed = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("response", (response) => {
        if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
      });
      await page.goto(server.origin + route, { waitUntil: "load" });
      await page.waitForFunction(() => window.__bench.hydratedAt > 0, null, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ").trim();
      const counter = page.locator("[data-counter]").first();
      const before = await counter.innerText();
      await counter.click();
      await page.waitForFunction(
        ([selector, previous]) => document.querySelector(selector)?.textContent !== previous,
        [`[data-counter="${await counter.getAttribute("data-counter")}"]`, before],
        { timeout: 5_000 },
      );
      const after = await counter.innerText();
      const highlighted = await page.locator("[data-highlighted]").count();
      await context.close();
      seen[name] = { text, before, after, highlighted, errors, failed };
    }
    const names = Object.keys(seen);
    results[route] = {
      sameContent: names.every((name) => seen[name].text === seen[names[0]].text),
      sameLazyContent: names.every((name) => seen[name].highlighted === seen[names[0]].highlighted),
      counterWorks: names.every(
        (name) => seen[name].after !== seen[name].before && seen[name].after.endsWith(":1"),
      ),
      errors: Object.fromEntries(names.map((name) => [name, seen[name].errors])),
      failedRequests: Object.fromEntries(names.map((name) => [name, seen[name].failed])),
    };
  }
  return results;
}

const summarize = (values) => ({
  median: Math.round(percentile(values, 0.5)),
  p95: Math.round(percentile(values, 0.95)),
  min: Math.round(Math.min(...values)),
  max: Math.round(Math.max(...values)),
});

const variants = [];
const servers = {};
const report = {
  benchmark: "client-chunking",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpus: os.availableParallelism(),
  loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
  runs,
  warmups,
};
let browser;
try {
  variants.push(await buildVariant("before", baseline));
  variants.push(await buildVariant("after", current));
  if (args["app-groups"])
    variants.push(await buildVariant("after-app-groups", current, APP_GROUPS));
  report.builds = Object.fromEntries(
    variants.map((variant) => {
      const { perRoute: _perRoute, ...build } = variant.build;
      return [variant.name, build];
    }),
  );
  // Per-route static JS of every route, against the baseline.
  const base = variants[0].build.perRoute;
  report.perRouteGzipChange = Object.fromEntries(
    variants.slice(1).map((variant) => {
      const deltas = Object.keys(base).map(
        (route) => variant.build.perRoute[route].staticJsGzip - base[route].staticJsGzip,
      );
      return [
        variant.name,
        {
          routesIncreased: deltas.filter((delta) => delta > 0).length,
          routesDecreased: deltas.filter((delta) => delta < 0).length,
          routes: deltas.length,
          maxIncreaseBytes: Math.max(0, ...deltas),
          medianChangeBytes: percentile(deltas, 0.5),
        },
      ];
    }),
  );

  // The route with the most preloads and the route at the median, by the baseline build.
  const byPreloads = Object.entries(base).sort(
    ([, a], [, b]) => a.modulepreloads - b.modulepreloads,
  );
  const timedRoutes = [
    byPreloads[byPreloads.length - 1][0],
    byPreloads[Math.floor(byPreloads.length / 2)][0],
  ];
  report.timedRoutes = Object.fromEntries(
    timedRoutes.map((route) => [
      route,
      Object.fromEntries(
        variants.map((variant) => [
          variant.name,
          {
            modulepreloads: variant.build.perRoute[route].modulepreloads,
            staticJsGzip: variant.build.perRoute[route].staticJsGzip,
          },
        ]),
      ),
    ]),
  );

  for (const variant of variants) servers[variant.name] = await startServer(variant);
  // A second server of the baseline build: the A/A control for the page-load numbers.
  servers["before-aa"] = await startServer(variants[0]);
  browser = await chromium.launch();

  // Home, the timed routes, a route with the chart package and one with the lazy highlighter.
  const source = (file) => fs.readFileSync(path.join(variants[0].root, file), "utf8");
  const componentsWith = (text) =>
    fs
      .readdirSync(path.join(variants[0].root, "src/components"))
      .filter((file) => /^c\d+\.tsx$/.test(file) && source(`src/components/${file}`).includes(text))
      .map((file) => `components/${file.slice(0, -4)}"`);
  const routeImporting = (components) =>
    variants[0].routes.find((route) => {
      const page = source(`src/app${route === "/" ? "" : route}/page.tsx`);
      return components.some((component) => page.includes(component));
    });
  const sampleRoutes = [
    ...new Set(
      [
        "/",
        ...timedRoutes,
        routeImporting(componentsWith("chart-kit")),
        routeImporting(componentsWith("code-block")),
      ].filter(Boolean),
    ),
  ];
  report.correctness = await checkCorrectness(browser, servers, sampleRoutes);

  if (!args["skip-load"]) {
    const names = Object.keys(servers);
    const samples = {};
    for (const profile of profiles) {
      for (const route of timedRoutes) {
        for (const name of names) samples[`${profile.name} ${route} ${name}`] = [];
      }
    }
    // Rotate which variant goes first every round, so each sees the same host-load window.
    for (let round = 0; round < warmups + runs; round++) {
      for (const profile of profiles) {
        for (const route of timedRoutes) {
          const order = names.map((_, index) => names[(index + round) % names.length]);
          for (const name of order) {
            const sample = await measureLoad(browser, servers[name].origin, route, profile);
            if (round >= warmups) samples[`${profile.name} ${route} ${name}`].push(sample);
          }
        }
      }
      process.stderr.write(`round ${round + 1}/${warmups + runs}\n`);
    }
    report.protocols = [
      ...new Set(Object.values(samples).flatMap((values) => values.map((value) => value.protocol))),
    ];
    report.pageLoad = Object.fromEntries(
      Object.entries(samples).map(([key, values]) => [
        key,
        Object.fromEntries(
          [
            "dcl",
            "load",
            "lcp",
            "tbt",
            "hydrated",
            "jsRequests",
            "jsTransferBytes",
            "failed",
            "errors",
          ].map((metric) => [metric, summarize(values.map((value) => value[metric]))]),
        ),
      ]),
    );
  }
} finally {
  if (browser) await browser.close();
  await Promise.all(Object.values(servers).map((server) => server.stop()));
  for (const variant of variants) {
    if (args.keep) process.stderr.write(`${variant.name} kept at ${variant.root}\n`);
    else fs.rmSync(variant.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

report.loadAverageAfter = os.loadavg().map((value) => Number(value.toFixed(2)));
const json = JSON.stringify(report, null, 2);
if (args.out) fs.writeFileSync(args.out, `${json}\n`);
console.log(json);
