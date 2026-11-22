// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, parse } from "es-module-lexer";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";
import { startProductionServer } from "./production-server";

/**
 * The renderer contract is the named exports of its server and client modules: the development
 * server reads them, and so does the conformance suite. The generated production SSR entry and
 * both client entries imported each module's default export instead, so a renderer that exported
 * only the contract built nowhere but development.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots: string[] = [];
const servers: ViteDevServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

const renderer = {
  name: "plain",
  vite: "plain-renderer/vite",
  server: "plain-renderer/server",
  client: "plain-renderer/client",
  capabilities: { functionComponents: true },
};

/** A minimal renderer whose modules export the contract by name and have no default export. */
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
export function renderToString(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(renderToString).join("");
  if (!isValidElement(node)) return escape(node);
  const { type, props } = node;
  if (type === Fragment) return renderToString(props.children);
  if (typeof type === "function") return renderToString(type(props));
  let attributes = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "dangerouslySetInnerHTML") continue;
    if (value == null || value === false || typeof value === "function" || typeof value === "object") continue;
    attributes += " " + (name === "className" ? "class" : name) + (value === true ? "" : '="' + escape(value) + '"');
  }
  const inner = props.dangerouslySetInnerHTML
    ? props.dangerouslySetInnerHTML.__html
    : renderToString(props.children);
  return "<" + type + attributes + ">" + inner + "</" + type + ">";
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

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-named-exports-"));
  roots.push(root);
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
    "src/app/page.js": `"use client";
import { createElement as h } from "plain-renderer";
export default function Page() {
  return h("p", null, "rendered by plain");
}
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

describe("a renderer that exports its contract only by name", () => {
  it("builds and serves in production", async () => {
    const root = await createApp();
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const server = await startProductionServer(path.join(root, ".farm", ".output", "server"));
    try {
      const response = await fetch(`${server.origin}/`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('<main id="plain-layout">');
      expect(html).toContain("rendered by plain");
      expect(html).toMatch(/<script type="module" src="\/farm-client-[^"]+\.js"/);
    } finally {
      await server.stop();
    }
  }, 240_000);

  it("imports the client module by name in development", async () => {
    const root = await createApp();
    const server = await createServer({ root, renderer, images: { provider: "none" } });
    servers.push(server);
    await server.listen(await getAvailablePort());

    const entry = (await server.transformRequest("/@farm/client"))?.code ?? "";
    await init;
    const [imports] = parse(entry);
    const rendererImports = imports
      .filter((entryImport) => entryImport.n?.includes("plain-renderer"))
      .map((entryImport) => entry.slice(entryImport.ss, entryImport.se));
    expect(rendererImports.length).toBeGreaterThan(0);
    // A default binding (`import React, …` or `import React from …`) needs an export the
    // contract does not require, and fails to link in the browser.
    for (const statement of rendererImports) {
      expect(statement).not.toMatch(/^import\s+[\w$]+\s*(,|from\b)/);
    }
  }, 60_000);
});
