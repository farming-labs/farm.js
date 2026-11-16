// Production client route table benchmark (see README.md): the size of the client entry every
// page boots with, the time from a cold page load to hydration, and the first client navigation,
// on the dev-scale docs app at several route counts. Build @farm.js/core and @farm.js/cli in
// every checkout passed with --farm first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { createDevScaleFixture, MARKER } from "../dev-scale/fixture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chromium } = createRequire(path.join(repo, "package.json"))("@playwright/test");

const { values: args } = parseArgs({
  options: {
    // Checkouts to compare, as label=path (or a path). Repeat a path under two labels for an A/A
    // control. Every round runs each variant once, rotating which goes first.
    farm: { type: "string", multiple: true, default: [`current=${repo}`] },
    // Page routes besides the home page: 80% MDX docs pages, 20% TSX guides, as in dev-scale.
    routes: { type: "string", default: "100,1000" },
    modes: { type: "string", default: "islands,classic" },
    samples: { type: "string", default: "7" },
    profile: { type: "string", default: "desktop" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
const samples = Number(args.samples);
assert.ok(Number.isInteger(samples) && samples >= 1, "--samples must be an integer >= 1");
const routeCounts = args.routes.split(",").map(Number);
assert.ok(
  routeCounts.every((count) => Number.isInteger(count) && count >= 20),
  "--routes >= 20",
);
const modes = args.modes.split(",");
assert.ok(
  modes.every((mode) => mode === "islands" || mode === "classic"),
  "--modes",
);

/** Lighthouse's desktop and mobile throttling, applied through the DevTools protocol. */
const PROFILES = {
  desktop: { cpu: 1, latency: 40, download: 10_000_000 / 8, upload: 10_000_000 / 8 },
  mobile: { cpu: 4, latency: 150, download: 1_600_000 / 8, upload: 750_000 / 8 },
};
const profile = PROFILES[args.profile];
assert.ok(profile, `Unknown profile ${args.profile}`);

const variants = args.farm.map((entry, index) => {
  const [label, farmRepo] = entry.includes("=") ? entry.split("=", 2) : [`v${index}`, entry];
  const resolved = path.resolve(farmRepo);
  for (const built of ["packages/farm/dist/index.mjs", "packages/farm-cli/dist"]) {
    assert.ok(fs.existsSync(path.join(resolved, built)), `Build ${built} in ${resolved} first`);
  }
  return { label, farmRepo: resolved };
});

// The page loaded cold, the page its first client navigation opens, and a second one. All are
// TSX guides in the sidebar (plain <a> links, so nothing prefetches them) and none is async.
const START = "/guides/page-3";
const FIRST = "/guides/page-4";
const SECOND = "/guides/page-6";

const exitOf = (child) =>
  new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

function run(farmRepo, cwd, command, extraArgs, env = {}) {
  const child = spawn(
    process.execPath,
    [path.join(farmRepo, "packages/farm-cli/bin/farm.js"), command, ...extraArgs],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FARM_TELEMETRY_DISABLED: "1", NO_COLOR: "1", ...env },
    },
  );
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return { child, output };
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

const gzip = (buffer) => zlib.gzipSync(buffer, { level: 9 }).length;
const brotli = (buffer) => zlib.brotliCompressSync(buffer).length;

/** The client entry every page loads, and the route table chunk when the build has one. */
function measureOutput(app) {
  const publicDir = path.join(app, ".farm/.output/public");
  const entryFile = fs
    .readdirSync(publicDir)
    .find((file) => /^farm-client-h[0-9a-f]+\.js$/.test(file));
  assert.ok(entryFile, `no hashed client entry in ${publicDir}`);
  const entry = fs.readFileSync(path.join(publicDir, entryFile));
  const tableFile = fs
    .readdirSync(path.join(publicDir, "chunks"))
    .find((file) => /^farm-client-routes-h[0-9a-f]+\.js$/.test(file));
  const table = tableFile ? fs.readFileSync(path.join(publicDir, "chunks", tableFile)) : null;
  return {
    entryBytes: entry.length,
    entryGzip: gzip(entry),
    entryBrotli: brotli(entry),
    tableBytes: table ? table.length : 0,
    tableGzip: table ? gzip(table) : 0,
  };
}

async function buildApp(workspace, variant, routes, mode) {
  const mdxPages = Math.round(routes * 0.8);
  const fixture = createDevScaleFixture(workspace, {
    farmRepo: variant.farmRepo,
    mdxPages,
    tsxPages: routes - mdxPages,
    primitives: 60,
    mode,
  });
  const { child, output } = run(variant.farmRepo, fixture.app, "build", [
    "--preset",
    "node-server",
  ]);
  const { code, signal } = await exitOf(child);
  if (code !== 0) throw new Error(`farm build failed (${code ?? signal}):\n${output.join("")}`);
  return fixture.app;
}

async function startServer(app) {
  const port = await freePort();
  const output = [];
  // The Nitro node-server output, started directly.
  const server = spawn(process.execPath, [path.join(app, ".farm/.output/server/index.mjs")], {
    cwd: app,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1" },
  });
  server.stdout.on("data", (chunk) => output.push(String(chunk)));
  server.stderr.on("data", (chunk) => output.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited:\n${output.join("")}`);
    try {
      const response = await fetch(origin + START);
      if (response.ok && (await response.text()).includes(MARKER)) break;
    } catch {
      // Not listening yet.
    }
    assert.ok(Date.now() - started < 60_000, `server never served:\n${output.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    origin,
    async stop() {
      if (server.exitCode === null) {
        server.kill("SIGTERM");
        await exitOf(server);
      }
    },
  };
}

// Records when the guide on screen has hydrated: React has attached its props to the page's
// PlatformBadge button. Polled from before any page script runs.
const INIT_SCRIPT = () => {
  window.__bench = { hydrated: {} };
  const timer = setInterval(() => {
    const body = document.querySelector("[data-guide-body]");
    const badge = body?.closest("article")?.querySelector("[data-platform-badge]");
    if (!badge || !Object.keys(badge).some((key) => key.startsWith("__reactProps"))) return;
    const text = body.textContent;
    if (!(text in window.__bench.hydrated)) window.__bench.hydrated[text] = performance.now();
  }, 4);
  window.__benchTimer = timer;
};

const guideText = (pathname) => `guide body v0 for page ${pathname.split("-").pop()}`;

async function waitHydrated(page, pathname) {
  const text = guideText(pathname);
  await page.waitForFunction((value) => value in window.__bench.hydrated, text, {
    timeout: 60_000,
    polling: 10,
  });
  return page.evaluate((value) => window.__bench.hydrated[value], text);
}

/** A client navigation by a plain link click with no pointer before it (no prefetch, no hover). */
async function navigate(page, pathname) {
  const started = await page.evaluate((href) => {
    window.__benchDocument ??= Symbol("document");
    const anchor = document.querySelector(`a[href="${href}"]`);
    if (!anchor) throw new Error(`no link to ${href}`);
    const now = performance.now();
    anchor.click();
    return now;
  }, pathname);
  const hydrated = await waitHydrated(page, pathname);
  const sameDocument = await page.evaluate(() => typeof window.__benchDocument === "symbol");
  assert.ok(sameDocument, `navigating to ${pathname} loaded a new document`);
  return hydrated - started;
}

/** A new context with the cache off and the profile's network and CPU, on the start page. */
async function openStartPage(browser, origin) {
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
  const errors = [];
  const tableRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (/\/farm-client-routes-h[0-9a-f]+\.js$/.test(request.url())) tableRequests.push(request);
  });
  await page.goto(origin + START, { waitUntil: "load", timeout: 120_000 });
  const hydratedMs = await waitHydrated(page, START);
  // Settle, then check that loading the page did not fetch the route table.
  await page.waitForTimeout(200);
  return { context, page, errors, hydratedMs, tableAtLoad: tableRequests.length };
}

function assertNoClientErrors(errors) {
  const clientErrors = errors.filter((text) =>
    /must be used within|Could not hydrate|Hydration failed|did not match|route table/.test(text),
  );
  assert.deepEqual(clientErrors, [], "console errors");
}

async function waitGuide(page, pathname) {
  await page.waitForFunction(
    (text) => document.querySelector("[data-guide-body]")?.textContent === text,
    guideText(pathname),
  );
}

async function sample(browser, origin) {
  // A link clicked with nothing before it (no hover, no prefetch): the worst case for a table
  // that loads on the first navigation.
  const cold = await openStartPage(browser, origin);
  let result;
  try {
    const { page } = cold;
    const bootJs = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => /\.js(?:$|\?)/.test(entry.name))
        .reduce((total, entry) => total + entry.encodedBodySize, 0),
    );
    const firstNavigationMs = await navigate(page, FIRST);
    const secondNavigationMs = await navigate(page, SECOND);
    // Back and forward restore the earlier pages in the same document.
    await page.goBack();
    await waitGuide(page, FIRST);
    await page.goForward();
    await waitGuide(page, SECOND);
    assert.equal(
      await page.evaluate(() => typeof window.__benchDocument),
      "symbol",
      "back/forward loaded a new document",
    );
    assertNoClientErrors(cold.errors);
    result = {
      hydratedMs: cold.hydratedMs,
      bootJsTransfer: bootJs,
      tableFetchedAtLoad: cold.tableAtLoad > 0 ? 1 : 0,
      firstNavigationMs,
      secondNavigationMs,
    };
  } finally {
    await cold.context.close();
  }

  // As a person clicks: the pointer rests on the link for 100 ms first.
  const hover = await openStartPage(browser, origin);
  try {
    const { page } = hover;
    await page.evaluate(() => {
      window.__benchDocument = Symbol("document");
    });
    const link = page.locator(`a[href="${FIRST}"]`).first();
    await link.hover();
    await page.waitForTimeout(100);
    const started = await page.evaluate(() => performance.now());
    await link.click();
    const hydrated = await waitHydrated(page, FIRST);
    assert.equal(await page.evaluate(() => typeof window.__benchDocument), "symbol");
    assertNoClientErrors(hover.errors);
    result.firstNavigationAfterHoverMs = hydrated - started;
  } finally {
    await hover.context.close();
  }
  return result;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-route-table-")));
const browser = await chromium.launch(
  process.env.FARM_BENCH_CHROMIUM ? { executablePath: process.env.FARM_BENCH_CHROMIUM } : {},
);
const report = {
  profile: args.profile,
  samples,
  node: process.version,
  cpus: os.cpus().length,
  cases: [],
};
try {
  for (const mode of modes) {
    for (const routes of routeCounts) {
      const builds = [];
      for (const variant of variants) {
        const root = path.join(workspace, `${mode}-${routes}-${variant.label}`);
        fs.mkdirSync(root);
        const app = await buildApp(root, variant, routes, mode);
        builds.push({ variant, app, output: measureOutput(app), server: await startServer(app) });
        process.stderr.write(`built ${mode} ${routes} routes with ${variant.label}\n`);
      }
      const results = new Map(builds.map((build) => [build.variant.label, []]));
      try {
        for (let round = 0; round < samples; round++) {
          for (let offset = 0; offset < builds.length; offset++) {
            const build = builds[(round + offset) % builds.length];
            results.get(build.variant.label).push(await sample(browser, build.server.origin));
          }
        }
      } finally {
        for (const build of builds) await build.server.stop();
      }
      for (const build of builds) {
        const runs = results.get(build.variant.label);
        const medians = Object.fromEntries(
          Object.keys(runs[0]).map((key) => [key, median(runs.map((runResult) => runResult[key]))]),
        );
        const entry = {
          mode,
          routes,
          variant: build.variant.label,
          ...build.output,
          medians,
          runs,
        };
        report.cases.push(entry);
        console.log(
          `${mode.padEnd(8)} ${String(routes).padStart(5)} routes  ${build.variant.label.padEnd(12)}` +
            ` entry ${build.output.entryBytes} B (gzip ${build.output.entryGzip}, br ${build.output.entryBrotli})` +
            ` table ${build.output.tableBytes} B (gzip ${build.output.tableGzip})` +
            ` | hydrated ${medians.hydratedMs.toFixed(1)} ms, boot JS ${medians.bootJsTransfer} B,` +
            ` table at load ${medians.tableFetchedAtLoad}` +
            ` | 1st nav ${medians.firstNavigationMs.toFixed(1)} ms (after hover ${medians.firstNavigationAfterHoverMs.toFixed(1)}), 2nd nav ${medians.secondNavigationMs.toFixed(1)} ms`,
        );
      }
    }
  }
} finally {
  await browser.close();
  if (!args.keep) fs.rmSync(workspace, { recursive: true, force: true });
  else console.log(`kept ${workspace}`);
}
if (args.out) fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
