// Bytes a docs-shaped app sends with each server components engine (RFC 0003).
//
//   node benchmarks/server-components-payload/measure.mjs [--skip-build] [--modes rsc,islands]
//
// Builds app/ once per mode, serves the production build, and records in Chrome:
// - first load: the HTML document and the JavaScript of a cold visit to several pages;
// - navigation: what ten client navigations through the "Next" link fetch.
// Bodies are measured decoded, and compressed here with brotli (quality 5, what servers use on
// the fly), so both engines are compared on the same encoding.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");
const app = path.join(here, "app");
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(repositoryRoot, "node_modules", "@playwright", "test"));

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const modesArg = args[args.indexOf("--modes") + 1];
const modes = args.includes("--modes") ? modesArg.split(",") : ["rsc", "islands"];
// docs: a server layout with client islands (segment navigation applies).
// shop: a layout that hydrates as one root around a client provider; pages pass a shared catalog
// to a client component (values in the server-tree payload apply, segments do not).
const SCENARIOS = [
  {
    name: "docs",
    firstLoad: ["/docs/p0", "/docs/p40", "/docs/p120", "/docs/p200", "/docs/p299"],
    start: "/docs/p0",
    page: (index) => `/docs/p${index}`,
  },
  {
    name: "shop",
    firstLoad: ["/shop/s0", "/shop/s30", "/shop/s60", "/shop/s90", "/shop/s120"],
    start: "/shop/s0",
    page: (index) => `/shop/s${index}`,
  },
];
const NAVIGATIONS = 10;

const br = (buffer) =>
  zlib.brotliCompressSync(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function run(command, commandArgs, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", ...options });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

/** The app borrows the contract example's installed packages, linked by real path for Nitro. */
async function linkDependencies() {
  const source = path.join(repositoryRoot, "examples", "server-components", "node_modules");
  const names = [
    "react",
    "react-dom",
    "react-server-dom-webpack",
    "vite",
    "@farm.js/core",
    "@farm.js/cli",
    "@farm.js/plugin",
    "@vitejs/plugin-rsc",
  ];
  for (const name of names) {
    const destination = path.join(app, "node_modules", ...name.split("/"));
    if (existsSync(destination)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(
      await realpath(path.join(source, ...name.split("/"))),
      destination,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

async function build(mode) {
  await rm(path.join(app, ".farm", `.output-${mode}`), { recursive: true, force: true });
  await run(
    process.execPath,
    [
      path.join(repositoryRoot, "packages", "farm-cli", "bin", "farm.js"),
      "build",
      "--preset",
      "node-server",
    ],
    {
      cwd: app,
      env: { ...process.env, FARM_SERVER_COMPONENTS_MODE: mode, FARM_SKIP_RSC_INSTALL: "1" },
    },
  );
}

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

/** Records decoded response bodies by resource type while `action` runs. */
async function record(page, action) {
  const bodies = [];
  const pending = [];
  const onResponse = (response) => {
    const type = response.request().resourceType();
    if (!["document", "script", "fetch", "xhr"].includes(type)) return;
    pending.push(
      response
        .body()
        .then((body) => bodies.push({ type, url: response.url(), body }))
        .catch(() => {}),
    );
  };
  page.on("response", onResponse);
  await action();
  await page.waitForLoadState("networkidle");
  await Promise.all(pending);
  page.off("response", onResponse);
  return bodies;
}

function sum(bodies, types) {
  const selected = bodies.filter((entry) => types.includes(entry.type));
  return {
    count: selected.length,
    raw: selected.reduce((total, entry) => total + entry.body.length, 0),
    br: selected.reduce((total, entry) => total + br(entry.body), 0),
  };
}

async function measure(mode, url, browser, scenario) {
  const errors = [];
  const firstLoad = [];
  for (const pathname of scenario.firstLoad) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const bodies = await record(page, () => page.goto(url + pathname));
    firstLoad.push({
      pathname,
      document: sum(bodies, ["document"]),
      javascript: sum(bodies, ["script"]),
    });
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url + scenario.start);
  await page.waitForLoadState("networkidle");
  const navigations = [];
  for (let index = 0; index < NAVIGATIONS; index++) {
    const expected = scenario.page(index + 1);
    const bodies = await record(page, async () => {
      await page.click("[data-next]");
      await page.waitForURL(`**${expected}`);
      await page.waitForFunction(
        (title) => document.querySelector("h1")?.textContent === title,
        await (await fetch(`${url}${expected}`)).text().then((html) => {
          const match = /<h1>([^<]*)<\/h1>/.exec(html);
          return match ? match[1] : "";
        }),
      );
    });
    if (bodies.some((entry) => entry.type === "document")) {
      throw new Error(`${mode}: navigation to ${expected} reloaded the document`);
    }
    navigations.push({
      pathname: expected,
      data: sum(bodies, ["fetch", "xhr"]),
      javascript: sum(bodies, ["script"]),
    });
  }
  await context.close();
  return { mode, scenario: scenario.name, firstLoad, navigations, errors };
}

function average(entries, pick) {
  const values = entries.map(pick);
  return {
    raw: values.reduce((total, value) => total + value.raw, 0) / values.length,
    br: values.reduce((total, value) => total + value.br, 0) / values.length,
  };
}

await linkDependencies();
if (!skipBuild) for (const mode of modes) await build(mode);

const browser = await chromium.launch({ channel: "chrome" });
const results = [];
try {
  for (const [index, mode] of modes.entries()) {
    const server = await serve(mode, 4281 + index);
    try {
      for (const scenario of SCENARIOS) {
        results.push(await measure(mode, server.url, browser, scenario));
      }
    } finally {
      server.stop();
    }
  }
} finally {
  await browser.close();
}

const rows = results.map((result) => {
  const documentAverage = average(result.firstLoad, (entry) => entry.document);
  const javascriptAverage = average(result.firstLoad, (entry) => entry.javascript);
  const dataAverage = average(result.navigations, (entry) => entry.data);
  const navigationJavascript = average(result.navigations, (entry) => entry.javascript);
  return {
    scenario: result.scenario,
    mode: result.mode,
    "document (br)": kb(documentAverage.br),
    "document (raw)": kb(documentAverage.raw),
    "first-load JS (br)": kb(javascriptAverage.br),
    "navigation data (br)": kb(dataAverage.br),
    "navigation data (raw)": kb(dataAverage.raw),
    "navigation JS (br)": kb(navigationJavascript.br),
    "page errors": result.errors.length,
  };
});
console.table(rows);
for (const result of results) {
  if (result.errors.length) console.log(`${result.mode} errors:`, result.errors.slice(0, 5));
}
await mkdir(path.join(here, "results"), { recursive: true });
await writeFile(
  path.join(here, "results", "latest.json"),
  `${JSON.stringify({ date: new Date().toISOString(), rows, results: results.map(({ errors, ...rest }) => ({ ...rest, errors: errors.length })) }, null, 2)}\n`,
);
