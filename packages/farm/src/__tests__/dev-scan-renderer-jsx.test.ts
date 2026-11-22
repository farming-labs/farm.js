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
 * Vite's dependency scan compiles JSX on its own, from `optimizeDeps.rolldownOptions.transform`
 * or the app tsconfig's `jsxImportSource`, and otherwise as React. Preact's and Solid's Vite
 * plugins set the option; a custom renderer's plugin usually sets only its transforms', so in an
 * app whose tsconfig names no source the scan compiled routes as React. Without React installed
 * the scan failed and skipped pre-bundling, and the first visit to the dev server reloaded once
 * the renderer's JSX runtime was found.
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
  jsxImportSource: "plain-renderer",
};

const runtime = `export const Fragment = Symbol.for("plain.fragment");
export function Suspense(props) { return props.children; }
export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
`;

const jsxRuntime = `export { Fragment } from "./server.js";
export function jsx(type, props) { return { type, props }; }
export { jsx as jsxs, jsx as jsxDEV };
`;

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-dev-scan-renderer-jsx-"));
  roots.push(root);
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "src/app/page.jsx": "export default function Page() {\n  return <main>home</main>;\n}\n",
    "node_modules/plain-renderer/package.json": JSON.stringify({
      name: "plain-renderer",
      type: "module",
      exports: {
        "./server": "./server.js",
        "./client": "./client.js",
        "./vite": "./vite.js",
        "./jsx-runtime": "./jsx-runtime.js",
        "./jsx-dev-runtime": "./jsx-runtime.js",
      },
    }),
    "node_modules/plain-renderer/server.js": `${runtime}export const name = "plain";
export function renderToString() { return ""; }
`,
    "node_modules/plain-renderer/client.js": `${runtime}export function createRoot() { return { render() {}, unmount() {} }; }
export function hydrateRoot() { return createRoot(); }
`,
    "node_modules/plain-renderer/vite.js":
      "export function createFarmRendererPlugin() { return []; }\n",
    "node_modules/plain-renderer/jsx-runtime.js": jsxRuntime,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

describe("the development dependency scan", () => {
  it("compiles route JSX for the renderer's jsxImportSource", async () => {
    const root = await createApp();
    const server = await createServer({ root, renderer, images: { provider: "none" } });
    servers.push(server);

    const optimizer = server.environments.client.depsOptimizer;
    if (!optimizer) throw new Error("The client environment has no dependency optimizer.");
    await optimizer.init();
    await optimizer.scanProcessing;

    expect(Object.keys(optimizer.metadata.discovered)).toContain("plain-renderer/jsx-dev-runtime");
  }, 60_000);

  it("leaves React's default to the app's tsconfig", () => {
    // Naming React would override a tsconfig `jsxImportSource` such as Emotion's.
    expect(createFarmClientOptimizeDepsConfig([], REACT_RENDERER)?.rolldownOptions).toBeUndefined();
  });
});
