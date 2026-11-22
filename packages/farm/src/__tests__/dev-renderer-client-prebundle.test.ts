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

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-renderer-client-prebundle-"));
  roots.push(root);
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
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("the development dependency optimizer", () => {
  it("pre-bundles the renderer's client module before the first request", async () => {
    const root = await createApp();
    const server = await createServer({ root, renderer, images: { provider: "none" } });
    servers.push(server);

    const optimizer = server.environments.client.depsOptimizer;
    if (!optimizer) throw new Error("The client environment has no dependency optimizer.");
    await optimizer.init();
    await optimizer.scanProcessing;

    expect(Object.keys(optimizer.metadata.discovered)).toContain("plain-renderer/client");
  }, 60_000);

  it("leaves out a client module given as a file path", () => {
    for (const client of ["./renderer/client.ts", path.join(packageRoot, "renderer/client.ts")]) {
      expect(
        createFarmClientOptimizeDepsConfig([], { ...renderer, client })?.include,
      ).not.toContain(client);
    }
  });

  it("adds nothing for React, whose entry imports react-dom/client", () => {
    expect(createFarmClientOptimizeDepsConfig([], REACT_RENDERER)?.include).not.toContain(
      REACT_RENDERER.client,
    );
  });
});
