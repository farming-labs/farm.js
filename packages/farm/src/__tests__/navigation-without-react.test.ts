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
 * `notFound()` and `redirect()` come from `@farm.js/core/navigation`, which also exports React's
 * router hooks and so imports React. An app on another renderer doesn't install React, so a page
 * that called `notFound()` answered 500 in development ("Cannot find package 'react'") and failed
 * `farm build`. The monorepo hid it: core's own node_modules has React, so every test resolved it.
 * These tests check what the entry resolves to, and that the build output never imports React.
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
  const rest = { ...props };
  if (children.length > 0) rest.children = children.length === 1 ? children[0] : children;
  return { $$plain: true, type, props: rest };
}
export function isValidElement(value) {
  return typeof value === "object" && value !== null && value.$$plain === true;
}
export function renderToString(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(renderToString).join("");
  if (!isValidElement(node)) return String(node);
  const { type, props } = node;
  if (type === Fragment) return renderToString(props.children);
  if (typeof type === "function") return renderToString(type(props));
  return "<" + type + ">" + renderToString(props.children) + "</" + type + ">";
}
`,
  "server.js": `export { Fragment, Suspense, createElement, isValidElement, renderToString } from "./index.js";
export const name = "plain";
`,
  "client.js": `export { Fragment, Suspense, createElement, isValidElement } from "./index.js";
export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
  "vite.js": "export function createFarmRendererPlugin() { return []; }\n",
};

async function createApp(config: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-navigation-without-react-"));
  roots.push(root);
  const coreLink = path.join(root, "node_modules", "@farm.js", "core");
  await fs.mkdir(path.dirname(coreLink), { recursive: true });
  await fs.symlink(await fs.realpath(packageRoot), coreLink, "junction");
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({ ...config, images: { provider: "none" }, telemetry: false })};\n`,
    "src/app/crops/[name]/page.js": `import { createElement as h } from "plain-renderer";
import { notFound } from "@farm.js/core/navigation";
export default function Crop({ params }) {
  if (params.name !== "wheat") notFound();
  return h("p", null, "Crop: " + params.name);
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

async function resolveNavigation(server: ViteDevServer, root: string) {
  const page = path.join(root, "src", "app", "crops", "[name]", "page.js");
  const resolve = async (environment: "client" | "ssr") => {
    const resolved = await server.environments[environment].pluginContainer.resolveId(
      "@farm.js/core/navigation",
      page,
    );
    return path
      .relative(packageRoot, resolved?.id ?? "")
      .split(path.sep)
      .join("/");
  };
  return { client: await resolve("client"), ssr: await resolve("ssr") };
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(file) : [file];
    }),
  );
  return nested.flat();
}

describe("@farm.js/core/navigation in an app on another renderer", () => {
  it("resolves to the entry without React, and notFound() answers 404 in development", async () => {
    const root = await createApp({ renderer });
    const server = await createServer({ root, renderer, images: { provider: "none" } });
    servers.push(server);
    await server.listen(await getAvailablePort());

    expect(await resolveNavigation(server, root)).toEqual({
      client: "dist/internal/navigation-neutral.mjs",
      ssr: "dist/internal/navigation-neutral.mjs",
    });

    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;
    const found = await fetch(`${origin}/crops/wheat`);
    expect(found.status).toBe(200);
    expect(await found.text()).toContain("<p>Crop: wheat</p>");
    const missing = await fetch(`${origin}/crops/oats`);
    expect(missing.status).toBe(404);
    await missing.body?.cancel();
  }, 60_000);

  it("builds a server that never imports React, and notFound() answers 404", async () => {
    const root = await createApp({ renderer });
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDir = path.join(root, ".farm", ".output", "server");
    const serverFiles = await listFiles(serverDir);
    expect(serverFiles.some((file) => file.split(path.sep).includes("react"))).toBe(false);
    for (const file of serverFiles.filter((name) => /\.m?js$/.test(name))) {
      const source = await fs.readFile(file, "utf8");
      expect(source, path.relative(serverDir, file)).not.toMatch(
        /\bfrom\s*["']react(?:-dom)?(?:\/[^"']*)?["']|import\(\s*["']react(?:-dom)?["']\s*\)/,
      );
    }

    const server = await startProductionServer(serverDir);
    try {
      const found = await fetch(`${server.origin}/crops/wheat`);
      expect(found.status).toBe(200);
      expect(await found.text()).toContain("<p>Crop: wheat</p>");
      const missing = await fetch(`${server.origin}/crops/oats`);
      expect(missing.status).toBe(404);
      await missing.body?.cancel();
    } finally {
      await server.stop();
    }
  }, 240_000);
});

describe("@farm.js/core/navigation with React's API", () => {
  it("keeps the entry with React's hooks in a React app", async () => {
    const root = await createApp({});
    const server = await createServer({ root, images: { provider: "none" } });
    servers.push(server);

    expect(await resolveNavigation(server, root)).toEqual({
      client: "dist/navigation.mjs",
      ssr: "dist/navigation.mjs",
    });
  }, 60_000);

  it("keeps the entry in a Preact app, whose plugin runs React's hooks on preact/compat", async () => {
    const preactRenderer = { ...renderer, name: "preact" };
    const root = await createApp({ renderer: preactRenderer });
    const server = await createServer({
      root,
      renderer: preactRenderer,
      images: { provider: "none" },
    });
    servers.push(server);

    expect(await resolveNavigation(server, root)).toEqual({
      client: "dist/navigation.mjs",
      ssr: "dist/navigation.mjs",
    });
  }, 60_000);
});
