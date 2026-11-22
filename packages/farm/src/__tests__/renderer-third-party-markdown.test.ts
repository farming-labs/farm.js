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
 * A `page.md` route renders with the app's renderer. This renderer is only the contract, and as
 * strict as the conformance suite asks a renderer to be: it renders synchronously, rejects an
 * async component, and refuses any element it didn't create, such as a React element.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
  if (typeof type !== "string") throw new Error("plain-renderer can't render element type " + String(type));
  let attributes = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "dangerouslySetInnerHTML") continue;
    if (value == null || value === false || typeof value === "function" || typeof value === "object") continue;
    attributes += " " + (name === "className" ? "class" : name) + (value === true ? "" : '="' + escape(value) + '"');
  }
  const inner = props.dangerouslySetInnerHTML ? props.dangerouslySetInnerHTML.__html : render(props.children);
  return "<" + type + attributes + ">" + inner + "</" + type + ">";
}
export function renderToString(node) {
  return render(node);
}
`,
  "server.js": `export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "plain";
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

const mdx = { components: "./src/mdx-components.js" };

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-markdown-"));
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
      mdx,
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
    "src/app/harvest/page.js": `import { createElement as h } from "plain-renderer";
export default async function Harvest() {
  const rows = await Promise.resolve(12);
  return h("p", { id: "harvest" }, "rows: ", rows);
}
`,
    "src/app/notes/page.md": `---
title: Field notes
---

# Field notes

Plain **Markdown**, rendered by the app renderer.

## Crops

| Crop  | Rows |
| ----- | ---- |
| Wheat | 12   |
`,
    "src/mdx-components.js": `import { createElement as h } from "plain-renderer";
export const components = {
  h2(props) {
    return h("h2", { className: "plain-heading" }, props.children);
  },
};
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

async function expectMarkdownPage(origin: string) {
  const page = await fetch(`${origin}/notes`);
  const html = await page.text();
  expect(page.status, html).toBe(200);
  expect(html).toContain('<main id="plain-layout">');
  expect(html).toContain('<article class="farm-markdown" data-farm-markdown-page="">');
  expect(html).toContain("<h1>Field notes</h1>");
  expect(html).toContain("<p>Plain <strong>Markdown</strong>, rendered by the app renderer.</p>");
  // The page's MDX components are the app's own, built with its renderer.
  expect(html).toContain('<h2 class="plain-heading">Crops</h2>');
  expect(html).toContain("<td>Wheat</td>");
  expect(html).toMatch(/<title>Field notes<\/title>/);

  // The source is still served as Markdown.
  const source = await fetch(`${origin}/notes.md`);
  expect(source.status).toBe(200);
  expect(source.headers.get("content-type")).toContain("text/markdown");
  expect(await source.text()).toContain("| Wheat | 12   |");

  // Farm awaits any async page itself, as it does `page.md`, so the renderer gets its elements.
  const harvest = await fetch(`${origin}/harvest`);
  const harvestHtml = await harvest.text();
  expect(harvest.status, harvestHtml).toBe(200);
  expect(harvestHtml).toContain('<p id="harvest">rows: 12</p>');
}

describe("page.md and async pages on a third-party renderer", () => {
  it("renders in a production build", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    cleanups.push(() => server.stop());

    await expectMarkdownPage(server.origin);
  }, 240_000);

  it("renders in development", async () => {
    const root = await createApp();
    const server: ViteDevServer = await createServer({
      root,
      renderer,
      mdx,
      images: { provider: "none" },
    });
    cleanups.push(() => server.close());
    const port = await getAvailablePort();
    await server.listen(port);

    await expectMarkdownPage(`http://127.0.0.1:${port}`);
  }, 60_000);
});
