// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { REACT_RENDERER } from "../renderer";
import { createServer } from "../server/create-server";
import { createFarmClientOptimizeDepsConfig } from "../server/vite-config";

/**
 * Farm's browser entry imports the renderer's client module, which no app file imports, so
 * Vite's dependency scan cannot see it. The official renderers list it in `optimizeDeps`; a
 * custom renderer that did not had it found on the first page request, and Vite bundled its
 * dependencies again while that page loaded. When the client module shares code with the JSX
 * runtime, the new bundle replaced chunks the page had already loaded, and Vite reloaded it.
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
};

const runtime = `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
`;

/**
 * An app whose renderer package is installed in node_modules, or, with `linked`, lives in the
 * app's workspace and is linked into node_modules as a package manager links a workspace package.
 */
async function createApp({ linked = false } = {}): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-renderer-client-prebundle-"));
  roots.push(root);
  const rendererDir = linked ? "packages/plain-renderer" : "node_modules/plain-renderer";
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/page.js": "export default function Page() {\n  return null;\n}\n",
    "node_modules/plain-renderer/package.json": JSON.stringify({
      name: "plain-renderer",
      type: "module",
      exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
    }),
    "node_modules/plain-renderer/server.js": `${runtime}export const name = "plain";
export function renderToString() { return ""; }
`,
    "node_modules/plain-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
    "node_modules/plain-renderer/vite.js":
      "export function createFarmRendererPlugin() { return []; }\n",
  };
  for (const [relativePath, source] of Object.entries(files)) {
    const file = path.join(root, relativePath.replace("node_modules/plain-renderer", rendererDir));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  }
  // The app resolves Farm from its own node_modules, as an installed app does.
  await fs.mkdir(path.join(root, "node_modules/@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules/@farm.js/core"), "junction");
  if (linked) {
    await fs.symlink(
      path.join(root, rendererDir),
      path.join(root, "node_modules/plain-renderer"),
      "junction",
    );
  }
  return root;
}

async function discoveredDependencies(root: string): Promise<string[]> {
  const server = await createServer({ root, renderer, images: { provider: "none" } });
  servers.push(server);
  const optimizer = server.environments.client.depsOptimizer;
  if (!optimizer) throw new Error("The client environment has no dependency optimizer.");
  await optimizer.init();
  await optimizer.scanProcessing;
  return Object.keys(optimizer.metadata.discovered);
}

describe("the development dependency optimizer", () => {
  it("pre-bundles the renderer's client module before the first request", async () => {
    expect(await discoveredDependencies(await createApp())).toContain("plain-renderer/client");
  }, 60_000);

  // Vite serves a linked package as source. Pre-bundling the client module of a renderer linked
  // from the workspace copied the renderer's own runtime into the bundle, while the app's
  // components imported the source copy: a component's hook read a different copy than the one
  // the renderer set, and the page never hydrated.
  it("leaves a renderer linked from the workspace to be served as source", async () => {
    expect(await discoveredDependencies(await createApp({ linked: true }))).not.toContain(
      "plain-renderer/client",
    );
  }, 60_000);

  // Farm's browser entry imports the first three on every page, and Vite's scan skips the API
  // client because the development server excludes `@farm.js/core/api`. Found on the first
  // request instead, they made Vite bundle again and reload the page while it loaded.
  it("pre-bundles Farm's browser modules before the first request", async () => {
    const discovered = await discoveredDependencies(await createApp());
    for (const entry of [
      "@farm.js/core/internal/client-runtime",
      "@farm.js/core/internal/spa-router",
      "@farm.js/core/router",
      "@farm.js/core/api/client",
    ]) {
      expect(discovered).toContain(entry);
    }
  }, 60_000);

  // A renderer's bindings import Farm's renderer API, and an app's components reach it only
  // through them, from files Vite's scan may not read (a `.leaf` page). Served as source from a
  // linked renderer, its own imports were found on the first request instead, and Vite bundled
  // again and reloaded the page about two seconds after it loaded.
  it("pre-bundles Farm's renderer API for a renderer linked from the workspace", async () => {
    for (const linked of [false, true]) {
      expect(await discoveredDependencies(await createApp({ linked }))).toContain(
        "@farm.js/core/renderer-client",
      );
    }
  }, 60_000);

  it("leaves out a client module given as a file path", () => {
    for (const client of ["./renderer/client.ts", path.join(packageRoot, "renderer/client.ts")]) {
      expect(
        createFarmClientOptimizeDepsConfig([], { ...renderer, client })?.include,
      ).not.toContain(client);
    }
  });

  it("adds nothing for React, whose entry imports react-dom/client", () => {
    const include = createFarmClientOptimizeDepsConfig([], REACT_RENDERER)?.include;
    expect(include).not.toContain(REACT_RENDERER.client);
    expect(include).not.toContain("@farm.js/core/renderer-client");
  });
});
