// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { assertFarmRendererServerModule } from "../renderer";
import * as noRendererServer from "../renderer/none/server";
import * as reactServer from "../renderer/react/server";
import { createServer } from "../server/create-server";

/**
 * Farm checked three of a renderer server module's six required exports, one at a time, when
 * the development server or `farm build` loaded it: a renderer without `Fragment` or `Suspense`
 * started and built, then failed on a request, reading `undefined`. Both now check all six and
 * name every missing export in one error.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cleanups: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  // Newest first, so a server stops before its directory is removed.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const renderer = {
  name: "plain",
  vite: "plain-renderer/vite",
  server: "plain-renderer/server",
  client: "plain-renderer/client",
};
const missingMessage =
  "Renderer `plain` server module `plain-renderer/server` does not export `Fragment` and `Suspense`.";

async function createApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-server-exports-"));
  cleanups.push(() =>
    fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  const elements = `export function createElement(type, props, ...children) {
  return { type, props: { ...props, children } };
}
export function isValidElement(value) { return typeof value === "object" && value !== null; }
`;
  const files: Record<string, string> = {
    "package.json": '{"type":"module","private":true}',
    "farm.config.ts": `export default ${JSON.stringify({
      renderer,
      images: { provider: "none" },
      telemetry: false,
    })};\n`,
    "src/app/page.js": "export default function Page() {\n  return null;\n}\n",
    "node_modules/plain-renderer/package.json": JSON.stringify({
      name: "plain-renderer",
      type: "module",
      exports: { "./server": "./server.js", "./client": "./client.js", "./vite": "./vite.js" },
    }),
    // No Fragment and no Suspense.
    "node_modules/plain-renderer/server.js": `${elements}export const name = "plain";
export function renderToString() { return ""; }
`,
    "node_modules/plain-renderer/client.js": `${elements}export const Suspense = Symbol.for("plain.suspense");
export function createRoot() { return { render() {}, unmount() {} }; }
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

describe("a renderer server module's required exports", () => {
  it("names every missing export in one error", () => {
    expect(() => assertFarmRendererServerModule({}, renderer)).toThrow(
      "Renderer `plain` server module `plain-renderer/server` does not export `name`, " +
        "`createElement`, `isValidElement`, `Fragment`, `Suspense`, and `renderToString`. " +
        "Export them by name from that module: https://farmjs.dev/docs/renderers#renderer-modules",
    );
    expect(() =>
      assertFarmRendererServerModule(
        { ...reactServer, renderToString: "not a function" },
        renderer,
      ),
    ).toThrow("does not export `renderToString`. Export it by name");
  });

  it("accepts Farm's own server modules", () => {
    for (const runtime of [reactServer, noRendererServer]) {
      expect(() => assertFarmRendererServerModule(runtime, renderer)).not.toThrow();
    }
  });

  it("fails the development server's start", async () => {
    const root = await createApp();
    await expect(
      createServer({ root, renderer, images: { provider: "none" } } as never),
    ).rejects.toThrow(missingMessage);
  }, 60_000);

  async function buildApp(root: string) {
    const config = await resolveConfig(
      { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
      "production",
    );
    await build(config, { root, preset: "node-server" });
  }

  it("fails the build", async () => {
    await expect(buildApp(await createApp())).rejects.toThrow(missingMessage);
  }, 240_000);
});
