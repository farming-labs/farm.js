// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * Programmatic pages render with the app's renderer, and a page that hydrates builds its browser
 * copy with the renderer's client module. The server module is server rendering, which the browser
 * bundle must not carry: Preact's imports Node's `stream` and failed the client build. This one
 * carries a marker instead.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER_ONLY_MARKER = "plain-renderer: server only";
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so servers stop before the directories they serve are removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const rendererFiles: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "plain-renderer",
    type: "module",
    exports: {
      ".": "./index.js",
      "./server": "./server.js",
      "./client": "./client.js",
      "./vite": "./vite.js",
    },
  }),
  "index.js": `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  const { key: _key, ref: _ref, ...rest } = props || {};
  if (children.length > 0) rest.children = children.length === 1 ? children[0] : children;
  return { $$plain: true, type, props: rest };
}
export function isValidElement(value) {
  return typeof value === "object" && value !== null && value.$$plain === true;
}
const escape = (value) => String(value).replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
function render(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(render).join("");
  if (typeof node === "string" || typeof node === "number") return escape(node);
  if (!isValidElement(node)) throw new Error("plain-renderer can't render " + Object.prototype.toString.call(node));
  const { type, props } = node;
  if (type === Fragment) return render(props.children);
  if (typeof type === "function") {
    const result = type(props);
    if (result && typeof result.then === "function") {
      throw new Error("plain-renderer doesn't render async components: " + (type.name || "anonymous"));
    }
    return render(result);
  }
  let attributes = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || value == null || value === false || typeof value === "function" || typeof value === "object") continue;
    attributes += " " + name + '="' + escape(value) + '"';
  }
  return "<" + type + attributes + ">" + render(props.children) + "</" + type + ">";
}
export function renderToString(node) {
  return render(node);
}
`,
  "server.js": `export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "plain";
export const serverOnly = ${JSON.stringify(SERVER_ONLY_MARKER)};
`,
  "client.js": `export { Fragment, Suspense, createElement, isValidElement } from "./index.js";
export function createRoot(container) {
  return { render() {}, unmount() { container.replaceChildren(); } };
}
export function hydrateRoot(container) {
  return createRoot(container);
}
`,
  "vite.js": "export function createFarmRendererPlugin() { return []; }\n",
};

const renderer = {
  name: "plain",
  vite: "plain-renderer/vite",
  server: "plain-renderer/server",
  client: "plain-renderer/client",
  capabilities: { functionComponents: true },
};

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-programmatic-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const coreLink = path.join(root, "node_modules", "@farm.js", "core");
  await fs.mkdir(path.dirname(coreLink), { recursive: true });
  await fs.symlink(await fs.realpath(packageRoot), coreLink, "junction");
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({
      renderer,
      images: { provider: "none" },
      telemetry: false,
    })};\n`,
    "src/app/layout.js": `import { createElement as h } from "plain-renderer";
export default function Layout(props) {
  return h("main", { id: "plain-layout" }, props.children);
}
`,
    "src/app/page.js": `import { createElement as h } from "plain-renderer";
export default function Home() {
  return h("p", null, "home");
}
`,
    "src/features/plain.js": `import { createElement as h } from "plain-renderer";
export function Plain() {
  return h("p", { id: "plain" }, "plain programmatic page");
}
`,
    "src/features/crop.js": `import { createElement as h } from "plain-renderer";
export const hydrate = true;
export function Crop(props) {
  return h("p", { id: "crop" }, props.params.name, " rows: ", props.data.rows);
}
`,
    "src/features/slow.js": `import { createElement as h } from "plain-renderer";
export function Slow(props) {
  return h("p", { id: "slow" }, "slow rows: ", props.data.rows);
}
export function SlowPending() {
  return h("p", { id: "slow-pending" }, "loading");
}
`,
    "src/routes.js": `import { defineRoutes } from "@farm.js/core";
import { Plain } from "./features/plain.js";
import { Crop } from "./features/crop.js";
import { Slow, SlowPending } from "./features/slow.js";
export default defineRoutes(({ page }) => [
  page("/plain", { component: Plain }),
  page("/crops/[name]", { component: Crop, data: { main: async () => ({ rows: 12 }) } }),
  page("/slow", { component: Slow, pending: SlowPending, data: { main: async () => ({ rows: 7 }) } }),
]);
`,
    ...Object.fromEntries(
      Object.entries(rendererFiles).map(([file, source]) => [
        `node_modules/plain-renderer/${file}`,
        source,
      ]),
    ),
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function expectProgrammaticPages(origin: string) {
  for (const [route, expected] of [
    ["/plain", '<p id="plain">plain programmatic page</p>'],
    ["/crops/wheat", '<p id="crop">wheat rows: 12</p>'],
    ["/slow", '<p id="slow">slow rows: 7</p>'],
  ] as const) {
    const response = await fetch(origin + route);
    const html = await response.text();
    expect(response.status, `${route}: ${html}`).toBe(200);
    expect(html).toContain('<main id="plain-layout">');
    expect(html).toContain(expected);
  }
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(file) : [file];
    }),
  );
  return nested.flat();
}

describe("programmatic pages on a third-party renderer", () => {
  it("render in a production build, and their browser copies skip the server renderer", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    cleanups.push(() => server.stop());

    await expectProgrammaticPages(server.origin);

    const browserScripts = (await listFiles(path.join(root, ".farm", ".output", "public"))).filter(
      (file) => file.endsWith(".js"),
    );
    expect(browserScripts.length).toBeGreaterThan(0);
    for (const file of browserScripts) {
      expect(await fs.readFile(file, "utf8"), file).not.toContain(SERVER_ONLY_MARKER);
    }
  }, 240_000);

  it("render in development", async () => {
    const root = await createApp();
    const server: ViteDevServer = await createServer({
      root,
      renderer,
      images: { provider: "none" },
    });
    cleanups.push(() => server.close());
    const port = await getAvailablePort();
    await server.listen(port);

    await expectProgrammaticPages(`http://127.0.0.1:${port}`);
  }, 60_000);
});
