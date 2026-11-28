// Serves a copy of a renderer example with prefetch() and scrollRestoration() registered and two
// pages to navigate between, for tests/e2e-renderer-plugins. Like the DevTools compatibility test,
// the copy reuses the example's installed dependencies and leaves the example untouched.
//
//   node tests/e2e-renderer-plugins/serve.mjs <leaf|preact|solid|vue|svelte> <dev|production> <port>
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXAMPLES = {
  leaf: "custom-renderer",
  preact: "preact-renderer",
  solid: "solid-renderer",
  vue: "vue-renderer",
  svelte: "svelte-renderer",
};

const [renderer, server, port] = process.argv.slice(2);
if (
  !Object.hasOwn(EXAMPLES, renderer ?? "") ||
  (server !== "dev" && server !== "production") ||
  !/^\d+$/.test(port ?? "")
) {
  console.error(
    "Usage: node tests/e2e-renderer-plugins/serve.mjs <leaf|preact|solid|vue|svelte> <dev|production> <port>",
  );
  process.exit(2);
}

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const example = path.join(workspace, "examples", EXAMPLES[renderer]);

// A long page with an intent link below the fold and a viewport link further down, and a short
// page to navigate to. Plain anchors: the plugins exist for links that are not core `Link`s.
const LONG_PAGE = `<main>
  <h1 id="probe-title">Plugin probe</h1>
  <div style="height: 3000px"></div>
  <a id="probe-link" href="/plugin-probe/target">Go to target</a>
  <div style="height: 1500px"></div>
  <a id="probe-viewport" data-farm-prefetch="viewport" href="/plugin-probe/target?via=viewport">Viewport link</a>
</main>
`;
const TARGET_PAGE = `<main>
  <h1 id="probe-target">Probe target</h1>
  <a id="probe-back" href="/plugin-probe">Back to probe</a>
</main>
`;

function component(markup) {
  const body = markup
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return `export default function Page() {\n  return (\n${body}\n  );\n}\n`;
}

const PAGE_FILES = {
  leaf: (markup) => ["page.leaf", markup],
  preact: (markup) => ["page.tsx", component(markup)],
  solid: (markup) => ["page.tsx", component(markup)],
  vue: (markup) => ["page.vue", `<template>\n${markup}</template>\n`],
  svelte: (markup) => ["page.svelte", markup],
};

const link = (source, target) =>
  symlink(source, target, process.platform === "win32" ? "junction" : "dir");

async function createApp(root) {
  for (const name of ["src", "public", "package.json", "tsconfig.json"]) {
    const source = path.join(example, name);
    if (existsSync(source)) await cp(source, path.join(root, name), { recursive: true });
  }
  // The repository's .gitignore keeps build output out of Tailwind's source scan in the example;
  // outside the repository the copy needs its own.
  await writeFile(path.join(root, ".gitignore"), ".farm\nnode_modules\n");

  const manifest = JSON.parse(await readFile(path.join(example, "package.json"), "utf8"));
  const dependencies = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  for (const name of dependencies) {
    const target = path.join(root, "node_modules", name);
    await mkdir(path.dirname(target), { recursive: true });
    await link(await realpath(path.join(example, "node_modules", name)), target);
  }
  for (const name of ["prefetch", "scroll-restoration"]) {
    const target = path.join(root, "node_modules", "@farm.js", name);
    await mkdir(path.dirname(target), { recursive: true });
    await link(path.join(workspace, "packages", `farm-${name}`), target);
  }

  await cp(path.join(example, "farm.config.ts"), path.join(root, "farm.example.config.ts"));
  await writeFile(
    path.join(root, "farm.config.ts"),
    `import { prefetch } from "@farm.js/prefetch";
import { scrollRestoration } from "@farm.js/scroll-restoration";
import config from "./farm.example.config";

// The example's config with both plugins. Its packages link into the workspace, which Vite only
// serves from outside the copy when allowed.
export default {
  ...config,
  plugins: [...(config.plugins ?? []), prefetch(), scrollRestoration()],
  vite: {
    ...config.vite,
    server: {
      ...config.vite?.server,
      fs: { ...config.vite?.server?.fs, allow: [${JSON.stringify(root)}, ${JSON.stringify(workspace)}] },
    },
  },
};
`,
  );

  for (const [route, markup] of [
    ["plugin-probe", LONG_PAGE],
    ["plugin-probe/target", TARGET_PAGE],
  ]) {
    const [file, source] = PAGE_FILES[renderer](markup);
    const directory = path.join(root, "src", "app", route);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, file), source);
  }
}

const farm = path.join(workspace, "packages", "farm-cli", "bin", "farm.js");
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), `farm-renderer-plugins-${renderer}-${server}-`)),
);
let child = null;
let stopping = false;

function run(args, env = {}) {
  child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, FARM_TELEMETRY_DISABLED: "1", FARM_SKIP_NPM_INSTALL: "1", ...env },
    stdio: "inherit",
  });
  return child;
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  process.exit(code);
}

process.once("SIGTERM", () => void stop(0));
process.once("SIGINT", () => void stop(0));

try {
  await createApp(root);
  if (server === "production") {
    const [code] = await once(run([farm, "build", "--preset", "node-server"]), "exit");
    if (code !== 0) throw new Error(`farm build exited with ${code}`);
    run([path.join(root, ".farm", ".output", "server", "index.mjs")], {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: port,
    });
  } else {
    run([farm, "dev", "--host", "127.0.0.1", "--port", port]);
  }
  const [code] = await once(child, "exit");
  if (!stopping) await stop(code ?? 1);
} catch (error) {
  if (!stopping) {
    console.error(error);
    await stop(1);
  }
}
