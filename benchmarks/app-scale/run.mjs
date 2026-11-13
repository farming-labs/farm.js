// Dev startup and build times of a generated 100+ route app (see README.md).
// Build @farm.js/core and @farm.js/cli first; run with Node 22+.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: args } = parseArgs({
  options: {
    routes: { type: "string", default: process.env.FARM_APP_SCALE_ROUTES ?? "120" },
    icons: { type: "string", default: process.env.FARM_APP_SCALE_ICONS ?? "1500" },
    rounds: { type: "string", default: process.env.FARM_APP_SCALE_ROUNDS ?? "3" },
    keep: { type: "boolean", default: false },
  },
});
const routeCount = Number(args.routes);
const iconCount = Number(args.icons);
const rounds = Number(args.rounds);
for (const [name, value, min] of [
  ["routes", routeCount, 2],
  ["icons", iconCount, 1],
  ["rounds", rounds, 1],
]) {
  assert.ok(Number.isInteger(value) && value >= min, `--${name} must be an integer >= ${min}`);
}

const cli = path.join(repo, "packages/farm-cli/bin/farm.js");
for (const built of ["packages/farm/dist/index.mjs", "packages/farm-cli/dist"]) {
  assert.ok(fs.existsSync(path.join(repo, built)), `Build ${built} first (see README.md)`);
}

const MARKER = "farm-app-scale";
const MARKDOWN_SHARE = 0.8;

function write(root, file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function link(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  fs.symlinkSync(target, linkPath, "junction");
}

/**
 * An app shaped like a docs site: mostly Markdown pages, some TSX pages, one layout with a
 * sidebar of icons from icon-kit. icon-kit is shaped like lucide-react: a CommonJS `main`, ES
 * modules only through `module`, and a barrel over one module per icon.
 */
function createApp(root) {
  const nodeModules = path.join(root, "node_modules");
  link(path.join(repo, "packages/farm"), path.join(nodeModules, "@farm.js/core"));
  link(path.join(repo, "packages/farm-cli"), path.join(nodeModules, "@farm.js/cli"));
  for (const name of ["react", "react-dom"]) {
    link(
      fs.realpathSync(path.join(repo, "packages/farm/node_modules", name)),
      path.join(nodeModules, name),
    );
  }
  write(
    root,
    "node_modules/icon-kit/package.json",
    JSON.stringify({
      name: "icon-kit",
      version: "1.0.0",
      main: "dist/cjs/index.js",
      module: "dist/esm/index.mjs",
      sideEffects: false,
      peerDependencies: { react: "*" },
    }),
  );
  write(root, "node_modules/icon-kit/dist/cjs/index.js", "module.exports = {};\n");
  const barrel = [];
  for (let index = 0; index < iconCount; index++) {
    write(
      root,
      `node_modules/icon-kit/dist/esm/icons/icon-${index}.mjs`,
      `import { createElement } from "react";
export default function Icon${index}(props) {
  return createElement("svg", { ...props, "data-icon": ${index}, viewBox: "0 0 24 24" },
    createElement("path", { d: "M${index % 24} 0L24 ${index % 24}" }));
}
`,
    );
    barrel.push(`export { default as Icon${index} } from "./icons/icon-${index}.mjs";`);
  }
  write(root, "node_modules/icon-kit/dist/esm/index.mjs", `${barrel.join("\n")}\n`);

  const markdownCount = Math.round(routeCount * MARKDOWN_SHARE);
  const pages = [];
  for (let index = 0; index < routeCount; index++) {
    const markdown = index < markdownCount;
    const pathname = markdown ? `/docs/page-${index}` : `/guides/page-${index}`;
    pages.push({ pathname, title: `Page ${index}`, icon: index % iconCount });
    const dir = `src/app${pathname}`;
    if (markdown) {
      write(
        root,
        `${dir}/page.md`,
        `---
title: Page ${index}
description: Generated page ${index}
---

# Page ${index}

Paragraph ${index} with **bold** text, \`code\`, and a [link](/docs/page-${(index + 1) % markdownCount}).

- one
- two
- three

\`\`\`ts
export const value${index} = ${index};
\`\`\`
`,
      );
    } else {
      // Prerendered at build time, with a client component to hydrate.
      write(
        root,
        `${dir}/page.tsx`,
        `"use ssg";
import { Icon${index % iconCount}, Icon${(index + 7) % iconCount} } from "icon-kit";
import { Callout } from "../../../components/callout";
import { CopyButton } from "../../../components/copy-button";

export const metadata = { title: "Page ${index}" };

export default function Page() {
  return (
    <article>
      <h1><Icon${index % iconCount} /> Page ${index}</h1>
      <Callout icon={<Icon${(index + 7) % iconCount} />}>Guide ${index}</Callout>
      <CopyButton text="page-${index}" />
    </article>
  );
}
`,
      );
    }
  }
  const navIcons = [...new Set(pages.slice(0, 40).map((page) => page.icon))];
  write(
    root,
    "src/components/copy-button.tsx",
    `"use client";
import { useState } from "react";
import { Icon1, Icon2 } from "icon-kit";

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" data-copy={text} onClick={() => setCopied(true)}>
      {copied ? <Icon2 /> : <Icon1 />} Copy
    </button>
  );
}
`,
  );
  write(
    root,
    "src/components/callout.tsx",
    `export function Callout({ icon, children }) {
  return <aside className="callout">{icon}{children}</aside>;
}
`,
  );
  write(
    root,
    "src/app/layout.tsx",
    `import { ${navIcons.map((icon) => `Icon${icon}`).join(", ")} } from "icon-kit";

const pages = ${JSON.stringify(pages.slice(0, 40).map(({ pathname, title, icon }) => ({ pathname, title, icon })))};
const icons = { ${navIcons.map((icon) => `${icon}: Icon${icon}`).join(", ")} };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body data-marker="${MARKER}">
        <nav>
          {pages.map(({ pathname, title, icon }) => {
            const Icon = icons[icon];
            return <a key={pathname} href={pathname}><Icon /> {title}</a>;
          })}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
`,
  );
  write(
    root,
    "src/app/page.tsx",
    `export default function Home() {
  return <h1>Home</h1>;
}
`,
  );
  write(
    root,
    "package.json",
    JSON.stringify({ name: "farm-app-scale", private: true, type: "module" }),
  );
  write(
    root,
    "farm.config.ts",
    `export default { telemetry: false, images: { provider: "none" } };\n`,
  );
  return { firstMarkdown: pages[0].pathname, firstGuide: pages[markdownCount]?.pathname };
}

function run(root, command, extraArgs = []) {
  return spawn(process.execPath, [cli, command, ...extraArgs], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CI: "1", FARM_TELEMETRY_DISABLED: "1" },
  });
}

function collect(child) {
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return output;
}

function exitOf(child) {
  return new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
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

async function fetchPage(origin, pathname) {
  const response = await fetch(origin + pathname, { headers: { accept: "text/html" } });
  const html = await response.text();
  assert.equal(response.status, 200, `${pathname}: HTTP ${response.status}`);
  assert.ok(html.includes(`data-marker="${MARKER}"`), `${pathname}: the layout did not render`);
  return html;
}

/** Process spawn until the port accepts a connection, and until two pages are fully read. */
async function measureDev(root, pages) {
  const port = await freePort();
  const started = performance.now();
  const child = run(root, "dev", ["--port", String(port)]);
  const output = collect(child);
  const exited = exitOf(child);
  try {
    while (!(await portOpen(port))) {
      if (child.exitCode !== null) throw new Error(`farm dev exited:\n${output.join("")}`);
      if (performance.now() - started > 180_000)
        throw new Error(`farm dev never listened:\n${output.join("")}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const portOpenMs = performance.now() - started;
    const origin = `http://127.0.0.1:${port}`;
    const markdownHtml = await fetchPage(origin, pages.firstMarkdown);
    assert.ok(markdownHtml.includes("<h1>Page 0</h1>"), "the Markdown page did not render");
    const firstPageMs = performance.now() - started;
    if (pages.firstGuide) {
      const guideHtml = await fetchPage(origin, pages.firstGuide);
      assert.ok(guideHtml.includes('class="callout"'), "the TSX page did not render");
      assert.ok(guideHtml.includes("data-copy="), "the client component did not render");
    }
    const secondPageMs = performance.now() - started - firstPageMs;
    return { portOpenMs, firstPageMs, secondPageMs };
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  }
}

async function measureBuild(root) {
  const started = performance.now();
  const child = run(root, "build", ["--preset", "node-server"]);
  const output = collect(child);
  const { code, signal } = await exitOf(child);
  const ms = performance.now() - started;
  if (code !== 0) throw new Error(`farm build failed (${code ?? signal}):\n${output.join("")}`);
  assert.ok(
    fs.existsSync(path.join(root, ".farm/.output/server/index.mjs")),
    "farm build produced no server",
  );
  return ms;
}

function removeCaches(root) {
  for (const dir of [".farm", "node_modules/.vite"]) {
    fs.rmSync(path.join(root, dir), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "farm-app-scale-")));
const samples = {
  coldDevPortOpenMs: [],
  coldDevFirstPageMs: [],
  warmDevPortOpenMs: [],
  warmDevFirstPageMs: [],
  warmDevSecondPageMs: [],
  coldBuildMs: [],
  warmBuildMs: [],
};
try {
  const pages = createApp(root);
  for (let round = 0; round < rounds; round++) {
    // Cold: no .farm and no Vite dependency cache, as after a fresh clone and install.
    removeCaches(root);
    const cold = await measureDev(root, pages);
    samples.coldDevPortOpenMs.push(cold.portOpenMs);
    samples.coldDevFirstPageMs.push(cold.firstPageMs);
    // Warm: the caches the cold start left, as on a developer's next `farm dev`.
    const warm = await measureDev(root, pages);
    samples.warmDevPortOpenMs.push(warm.portOpenMs);
    samples.warmDevFirstPageMs.push(warm.firstPageMs);
    samples.warmDevSecondPageMs.push(warm.secondPageMs);
    removeCaches(root);
    samples.coldBuildMs.push(await measureBuild(root));
    // Warm: the build directory and caches the previous build left.
    samples.warmBuildMs.push(await measureBuild(root));
    process.stderr.write(`round ${round + 1}/${rounds} done\n`);
  }
} finally {
  if (args.keep) process.stderr.write(`fixture kept at ${root}\n`);
  else fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

const round1 = (value) => Math.round(value);
const report = {
  benchmark: "app-scale",
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  cpus: os.availableParallelism(),
  routes: routeCount,
  markdownRoutes: Math.round(routeCount * MARKDOWN_SHARE),
  icons: iconCount,
  rounds,
  medianMs: Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, round1(median(values))]),
  ),
  samplesMs: Object.fromEntries(
    Object.entries(samples).map(([key, values]) => [key, values.map(round1)]),
  ),
};
for (const [key, value] of Object.entries(report.medianMs)) {
  process.stderr.write(`${key.padEnd(22)} ${String(value).padStart(7)} ms\n`);
}
console.log(JSON.stringify(report, null, 2));
