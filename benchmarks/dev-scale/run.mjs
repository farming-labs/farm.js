// `farm dev` startup, first-request, revisit and HMR times on a docs-sized workspace app
// (see README.md). Build @farm.js/core and @farm.js/cli in every checkout passed with --farm first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { createDevScaleFixture, MARKER } from "./fixture.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: {
    // Checkouts to compare, as label=path (or a path). Repeat a path under two labels for an A/A
    // control. Every round runs each variant once, alternating their order.
    farm: { type: "string", multiple: true, default: [`current=${repo}`] },
    mdx: { type: "string", default: process.env.FARM_DEV_SCALE_MDX ?? "800" },
    tsx: { type: "string", default: process.env.FARM_DEV_SCALE_TSX ?? "200" },
    primitives: { type: "string", default: "60" },
    samples: { type: "string", default: process.env.FARM_DEV_SCALE_SAMPLES ?? "10" },
    out: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});
const mdxPages = Number(args.mdx);
const tsxPages = Number(args.tsx);
const samples = Number(args.samples);
for (const [name, value, min] of [
  ["mdx", mdxPages, 2],
  ["tsx", tsxPages, 2 * Number(args.samples) + 2],
  ["samples", samples, 1],
]) {
  assert.ok(Number.isInteger(value) && value >= min, `--${name} must be an integer >= ${min}`);
}

const variants = args.farm.map((entry, index) => {
  const [label, farmRepo] = entry.includes("=") ? entry.split("=", 2) : [`v${index}`, entry];
  const resolved = path.resolve(farmRepo);
  for (const built of ["packages/farm/dist/index.mjs", "packages/farm-cli/dist"]) {
    assert.ok(fs.existsSync(path.join(resolved, built)), `Build ${built} in ${resolved} first`);
  }
  return { label, farmRepo: resolved };
});

const { chromium } = createRequire(path.join(repo, "package.json"))("@playwright/test");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function fetchPage(origin, pathname, expected) {
  const started = performance.now();
  const response = await fetch(origin + pathname, { headers: { accept: "text/html" } });
  const html = await response.text();
  const ms = performance.now() - started;
  assert.equal(response.status, 200, `${pathname}: HTTP ${response.status}`);
  assert.ok(html.includes(`data-marker="${MARKER}"`), `${pathname}: the layout did not render`);
  if (expected) assert.ok(html.includes(expected), `${pathname}: missing ${expected}`);
  return { ms, bytes: html.length };
}

/**
 * The first page a fresh server renders. A connection refused after the port opened is retried
 * while the server runs, and counted: on a shared machine another process can take the port
 * freePort returned, and a server that restarts closes its port too, so the count is reported.
 */
async function firstPage(dev, pathname) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fetchPage(dev.origin, pathname, "mdx body");
      return attempt;
    } catch (error) {
      if (error?.cause?.code !== "ECONNREFUSED" || attempt >= 100 || !dev.running()) {
        process.stderr.write(dev.output.join("").slice(-4000));
        throw error;
      }
      process.stderr.write(`retrying ${pathname}: connection refused while farm dev runs\n`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function startDev(variant, app) {
  const port = await freePort();
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [path.join(variant.farmRepo, "packages/farm-cli/bin/farm.js"), "dev", "--port", String(port)],
    {
      cwd: app,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FARM_TELEMETRY_DISABLED: "1" },
    },
  );
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  while (!(await portOpen(port))) {
    if (child.exitCode !== null) throw new Error(`farm dev exited:\n${output.join("")}`);
    if (performance.now() - started > 180_000) throw new Error(`farm dev never listened`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    origin: `http://127.0.0.1:${port}`,
    started,
    portOpenMs: performance.now() - started,
    output,
    running: () => child.exitCode === null && child.signalCode === null,
    async stop() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
    },
  };
}

function removeCaches(app) {
  for (const dir of [".farm", "node_modules/.vite"]) {
    fs.rmSync(path.join(app, dir), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

/** Replaces `<label> v<n>` in a file with a fresh version and returns the new text to wait for. */
let editCounter = 0;
function edit(file, label) {
  const source = fs.readFileSync(file, "utf8");
  const pattern = new RegExp(`${label} v\\d+`);
  assert.ok(pattern.test(source), `${file} has no "${label} vN"`);
  const next = `${label} v${++editCounter}`;
  fs.writeFileSync(file, source.replace(pattern, next));
  return next;
}

/**
 * Time from the write to `text` showing in the open page. A full reload replaces `window`, so the
 * marker set before the write tells an HMR update from a reload. An edit the page never shows is
 * a missed update: the page is reloaded by hand so the session can go on.
 */
const EDIT_TIMEOUT_MS = Number(process.env.FARM_DEV_SCALE_EDIT_TIMEOUT ?? 30_000);
async function timeEdit(page, write, check, timeoutMs = EDIT_TIMEOUT_MS) {
  await page.evaluate(() => {
    window.__devScaleMarker = true;
  });
  const started = performance.now();
  const expected = write();
  for (;;) {
    let seen = false;
    try {
      seen = await page.evaluate(check, expected);
    } catch {
      // The page is reloading.
    }
    if (seen) break;
    if (performance.now() - started > timeoutMs) {
      await page.reload({ waitUntil: "load" });
      return { ms: null, reloaded: null, missed: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const ms = performance.now() - started;
  let reloaded = true;
  try {
    reloaded = !(await page.evaluate(() => window.__devScaleMarker === true));
  } catch {}
  return { ms, reloaded, missed: false };
}

const textVisible = (text) => document.body?.innerText.includes(text) ?? false;

async function visit(page, url) {
  const started = performance.now();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.farmHydrated === "true", null, {
    timeout: 60_000,
  });
  return performance.now() - started;
}

async function session(variant, fixture, round, browser) {
  const result = {};
  const { app } = fixture;
  // A route no earlier server in this round has rendered, so its modules are not on disk caches'
  // hot path any more than the others.
  const guide = (offset) => fixture.tsx[(2 + round * 2 + offset) % fixture.tsx.length];
  const doc = (offset) => fixture.mdx[(1 + round * 3 + offset) % fixture.mdx.length];

  removeCaches(app);
  let dev = await startDev(variant, app);
  try {
    result.coldPortOpenMs = dev.portOpenMs;
    result.coldFirstPageRetries = await firstPage(dev, fixture.mdx[0]);
    result.coldFirstPageMs = performance.now() - dev.started;

    const newGuide = await fetchPage(dev.origin, guide(0), "guide body");
    result.newTsxRouteMs = newGuide.ms;
    result.htmlBytes = newGuide.bytes;
    result.newMdxRouteMs = (await fetchPage(dev.origin, doc(0), "mdx body")).ms;
    result.revisitTsxHttpMs = (await fetchPage(dev.origin, guide(0), "guide body")).ms;

    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    const guideUrl = dev.origin + guide(1);
    result.newRouteBrowserMs = await visit(page, guideUrl);
    result.revisitBrowserMs = await visit(page, guideUrl);

    const ui = fixture.ui;
    const guideFile = path.join(app, `src/app${guide(1)}/page.tsx`);
    const edits = [
      ["clientComponentHmr", path.join(ui, "src/copy-button.tsx"), "copy label"],
      ["serverComponentHmr", path.join(app, "src/components/guide-footer.tsx"), "guide footer"],
      ["pageHmr", guideFile, "guide body"],
      ["layoutHmr", path.join(app, "src/app/layout.tsx"), "root layout"],
    ];
    for (const [metric, file, label] of edits) {
      const { ms, reloaded, missed } = await timeEdit(page, () => edit(file, label), textVisible);
      result[metric] = ms;
      result[`${metric}Reload`] = reloaded;
      result[`${metric}Missed`] = missed;
      await page.waitForFunction(() => document.documentElement.dataset.farmHydrated === "true");
    }
    const css = path.join(app, "src/app/globals.css");
    const cssEdit = await timeEdit(
      page,
      () => {
        const color = `rgb(1, 2, ${(++editCounter % 200) + 3})`;
        fs.writeFileSync(
          css,
          fs.readFileSync(css, "utf8").replace(/rgb\(1, 2, \d+\)/, color.replace("rgb", "rgb")),
        );
        return color;
      },
      (color) => {
        const element = document.querySelector(".callout");
        return element ? getComputedStyle(element).color === color : false;
      },
    );
    result.cssHmr = cssEdit.ms;
    result.cssHmrReload = cssEdit.reloaded;
    result.cssHmrMissed = cssEdit.missed;

    await visit(page, dev.origin + doc(1));
    const mdxFile = path.join(app, `src/app${doc(1)}/page.mdx`);
    const mdxEdit = await timeEdit(page, () => edit(mdxFile, "mdx body"), textVisible);
    result.mdxHmr = mdxEdit.ms;
    result.mdxHmrReload = mdxEdit.reloaded;
    result.mdxHmrMissed = mdxEdit.missed;
    // Provider/consumer splits and hydration mismatches, on every page the session opened.
    const hydrationErrors = errors.filter((text) =>
      /must be used within|Could not hydrate|Hydration failed|did not match/.test(text),
    );
    result.hydrationErrors = hydrationErrors.length;
    if (hydrationErrors.length > 0) result.firstHydrationError = hydrationErrors[0].slice(0, 300);
    await context.close();
  } finally {
    await dev.stop();
  }

  dev = await startDev(variant, app);
  try {
    result.warmPortOpenMs = dev.portOpenMs;
    result.warmFirstPageRetries = await firstPage(dev, fixture.mdx[0]);
    result.warmFirstPageMs = performance.now() - dev.started;
  } finally {
    await dev.stop();
  }
  return result;
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-dev-scale-")));
const results = Object.fromEntries(variants.map((variant) => [variant.label, []]));
// A Chromium build other than the one @playwright/test expects, such as a preinstalled one.
const browser = await chromium.launch(
  process.env.FARM_DEV_SCALE_CHROMIUM
    ? { executablePath: process.env.FARM_DEV_SCALE_CHROMIUM }
    : {},
);
try {
  // One fixture per checkout: each links its own core, CLI and React.
  const fixtures = new Map();
  for (const variant of variants) {
    if (fixtures.has(variant.farmRepo)) continue;
    const root = path.join(workspace, String(fixtures.size));
    fs.mkdirSync(root);
    fixtures.set(
      variant.farmRepo,
      createDevScaleFixture(root, {
        farmRepo: variant.farmRepo,
        mdxPages,
        tsxPages,
        primitives: Number(args.primitives),
      }),
    );
  }
  for (let round = 0; round < samples; round++) {
    const order = round % 2 === 0 ? variants : [...variants].reverse();
    for (const variant of order) {
      const result = await session(variant, fixtures.get(variant.farmRepo), round, browser);
      results[variant.label].push(result);
      process.stderr.write(
        `round ${round + 1}/${samples} ${variant.label}: ${JSON.stringify(
          Object.fromEntries(
            Object.entries(result).map(([key, value]) => [
              key,
              typeof value === "number" ? Math.round(value) : value,
            ]),
          ),
        )}\n`,
      );
    }
  }
} finally {
  await browser.close();
  if (args.keep) process.stderr.write(`fixture kept at ${workspace}\n`);
  else fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

const summary = {};
for (const [label, runs] of Object.entries(results)) {
  summary[label] = {};
  for (const key of Object.keys(runs[0])) {
    const all = runs.map((run) => run[key]);
    const values = all.filter((value) => typeof value === "number");
    const timed = values.length > 0 || key.endsWith("Ms") || key.endsWith("Hmr");
    summary[label][key] =
      timed && values.length === 0
        ? { median: null, p95: null, missed: all.length }
        : timed
          ? {
              median: Math.round(quantile(values, 0.5)),
              p95: Math.round(quantile(values, 0.95)),
              min: Math.round(Math.min(...values)),
              max: Math.round(Math.max(...values)),
            }
          : { true: all.filter((value) => value === true).length, of: all.length };
  }
}
const report = {
  benchmark: "dev-scale",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpus: os.availableParallelism(),
  loadavg: os.loadavg(),
  mdxPages,
  tsxPages,
  samples,
  variants,
  summary,
  runs: results,
};
const json = JSON.stringify(report, null, 2);
if (args.out) fs.writeFileSync(args.out, json);
console.log(json);
