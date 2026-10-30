// Time each server components engine spends on the same pages (RFC 0003): the browser's main
// thread on a first load, the latency of a client navigation, and the server's render throughput.
//
//   node benchmarks/server-components-payload/timing.mjs [--modes rsc,islands] [--runs 3]
//
// Uses the production builds measure.mjs leaves in app/.farm (run it first, or with
// --skip-build after a build). Chrome runs with 4x CPU throttling, roughly a mid-range phone.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const app = path.join(here, "app");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "node_modules", "@playwright", "test"));

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const modes = option("--modes", "rsc,islands").split(",");
const runs = Number(option("--runs", "3"));
const CPU_THROTTLE = 4;
const SECTIONS = {
  docs: ["/docs/p0", "/docs/p40", "/docs/p120"],
  shop: ["/shop/s0", "/shop/s60", "/shop/s120"],
  blog: ["/blog/b0", "/blog/b40", "/blog/b80"],
};
const NAVIGATIONS = 10;
const SERVER_SECONDS = 5;
const SERVER_CONCURRENCY = 16;

async function serve(mode, port) {
  const child = spawn(
    process.execPath,
    [path.join(app, ".farm", `.output-${mode}`, "server", "index.mjs")],
    {
      cwd: app,
      env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) },
      stdio: "ignore",
    },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/docs/p0`)).ok) return { url, stop: () => child.kill() };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`${mode} server did not start`);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Main-thread task and script time of a cold load, until the network and the thread go quiet. */
async function firstLoad(browser, url) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  const metric = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]),
    );
  const before = await metric();
  await page.goto(url, { waitUntil: "networkidle" });
  // Lazy work (idle callbacks, deferred hydration) finishes in the next quiet second.
  await page.waitForTimeout(1000);
  const after = await metric();
  await context.close();
  return {
    task: (after.TaskDuration - before.TaskDuration) * 1000,
    script: (after.ScriptDuration - before.ScriptDuration) * 1000,
  };
}

/**
 * Click "Next" until the new page is painted: in the page, from the click to the second animation
 * frame after the new heading is in the DOM (the first frame renders it). Measured in the page, so
 * neither engine gains from where its commit falls relative to the test's polling.
 */
async function navigations(browser, url, start, pageAt) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
  await page.goto(url + start, { waitUntil: "networkidle" });
  const times = [];
  for (let index = 0; index < NAVIGATIONS; index++) {
    const expected = pageAt(index + 1);
    const title = /<h1>([^<]*)<\/h1>/.exec(await (await fetch(url + expected)).text())?.[1] ?? "";
    const painted = page.evaluate(
      (heading) =>
        new Promise((resolve) => {
          let clickedAt = 0;
          document.addEventListener("click", () => (clickedAt = performance.now()), {
            capture: true,
            once: true,
          });
          const observer = new MutationObserver(() => {
            if (document.querySelector("h1")?.textContent !== heading) return;
            observer.disconnect();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - clickedAt)),
            );
          });
          observer.observe(document, { subtree: true, childList: true, characterData: true });
        }),
      title,
    );
    await page.click("[data-next]");
    times.push(Math.round(await painted));
    await page.waitForLoadState("networkidle");
  }
  await context.close();
  return times;
}

/** Requests per second for document requests, SERVER_CONCURRENCY at a time. */
async function throughput(url, prefix) {
  const pages = Array.from({ length: 100 }, (_, index) => `${prefix}${index}`);
  for (const pathname of pages.slice(0, 20)) await (await fetch(url + pathname)).text();
  const latencies = [];
  let next = 0;
  const deadline = Date.now() + SERVER_SECONDS * 1000;
  await Promise.all(
    Array.from({ length: SERVER_CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const startedAt = performance.now();
        const response = await fetch(url + pages[next++ % pages.length]);
        await response.arrayBuffer();
        latencies.push(performance.now() - startedAt);
      }
    }),
  );
  return { rps: latencies.length / SERVER_SECONDS, p50: median(latencies) };
}

const browser = await chromium.launch({ channel: "chrome" });
const rows = [];
try {
  for (const [index, mode] of modes.entries()) {
    const server = await serve(mode, 4381 + index);
    try {
      for (const [section, pathnames] of Object.entries(SECTIONS)) {
        const loads = [];
        for (let run = 0; run < runs; run++) {
          for (const pathname of pathnames)
            loads.push(await firstLoad(browser, server.url + pathname));
        }
        const prefix = pathnames[0].slice(0, pathnames[0].lastIndexOf("/") + 2);
        const navigation = await navigations(
          browser,
          server.url,
          pathnames[0],
          (i) => `${prefix}${i}`,
        );
        const load = await throughput(server.url, prefix);
        rows.push({
          section,
          mode,
          "first load main thread (ms)": Math.round(median(loads.map((entry) => entry.task))),
          "first load script (ms)": Math.round(median(loads.map((entry) => entry.script))),
          "navigation (ms)": median(navigation),
          "server req/s": Math.round(load.rps),
          "server p50 (ms)": Number(load.p50.toFixed(1)),
        });
      }
    } finally {
      server.stop();
    }
  }
} finally {
  await browser.close();
}
console.log(
  `Medians; Chrome with ${CPU_THROTTLE}x CPU throttling; server: ${SERVER_CONCURRENCY} concurrent document requests for ${SERVER_SECONDS} s.`,
);
console.table(rows);
