// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFarmAgentConfig } from "../agent-config";
import { build } from "../build";
import { resolveConfig } from "../config";
import { resolveFarmImageConfig } from "../image-config";
import {
  isFarmRendererDisabled,
  loadFarmRendererVitePlugins,
  NO_RENDERER,
  REACT_RENDERER,
  resolveFarmRenderer,
} from "../renderer";
import * as noRenderer from "../renderer/none/server";
import { createServer } from "../server/create-server";
import { createFarmClientOptimizeDepsConfig } from "../server/vite-config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const devServers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...devServers].map((server) => server.close()));
  devServers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

/**
 * A backend-only app outside the workspace: only `@farm.js/core` is linked, as in an app that
 * never installed React. (pnpm puts the workspace's hoisted packages on NODE_PATH for the test
 * process, so React stays resolvable here; the assertions below check what the app loads.)
 */
async function createBackendFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-renderer-disabled-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(root, "public/robots-notes.txt", "served from public");
  await writeModule(root, "public/landing.html", "<p>public landing</p>");
  await writeModule(root, "public/guide/index.html", "<p>public guide</p>");
  await writeModule(
    root,
    "src/app/api/route.ts",
    `export function GET() {
  return Response.json({ name: "backend", status: "ok" });
}`,
  );
  await writeModule(
    root,
    "src/app/api/users/[id]/route.ts",
    `export async function POST(request: Request) {
  return Response.json({ received: await request.json() }, { status: 201 });
}`,
  );
  await writeModule(
    root,
    "src/app/api/boom/route.ts",
    `export function GET(): Response {
  throw new Error("route failed");
}`,
  );
  await writeModule(
    root,
    "src/app/middleware.ts",
    `export function middleware(request: Request, context: { headers: Headers }) {
  if (new URL(request.url).pathname === "/blocked") {
    return Response.json({ error: "Blocked" }, { status: 403 });
  }
  context.headers.set("x-backend", "farm");
}`,
  );
  return root;
}

async function expectBackendResponses(origin: string): Promise<void> {
  const root = await fetch(`${origin}/`);
  expect(root.status).toBe(200);
  expect(root.headers.get("x-backend")).toBe("farm");
  await expect(root.json()).resolves.toEqual({ name: "backend", status: "ok" });

  const created = await fetch(`${origin}/users/7`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada" }),
  });
  expect(created.status).toBe(201);
  await expect(created.json()).resolves.toEqual({ received: { name: "Ada" } });

  // The API prefix keeps answering alongside api.basePath "/".
  expect((await fetch(`${origin}/api`)).status).toBe(200);

  // Public files still serve; a dotted miss answers JSON like any other miss.
  const asset = await fetch(`${origin}/robots-notes.txt`);
  expect(asset.status).toBe(200);
  await expect(asset.text()).resolves.toBe("served from public");
  // Public HTML and a public directory's index.html too, before middleware.
  for (const [pathname, body] of [
    ["/landing.html", "<p>public landing</p>"],
    ["/guide/", "<p>public guide</p>"],
    ["/guide", "<p>public guide</p>"],
  ]) {
    const page = await fetch(`${origin}${pathname}`, { redirect: "manual" });
    expect(page.status, pathname).toBe(200);
    expect(page.headers.get("x-backend"), pathname).toBeNull();
    await expect(page.text()).resolves.toBe(body);
  }

  for (const pathname of ["/missing", "/missing/deeper", "/missing.json"]) {
    const miss = await fetch(`${origin}${pathname}`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get("content-type")).toMatch(/^application\/json/);
    await expect(miss.json()).resolves.toEqual({ error: "Not found", pathname });
  }

  const failed = await fetch(`${origin}/boom`);
  expect(failed.status).toBe(500);
  expect(failed.headers.get("content-type")).toMatch(/^application\/json/);

  const blocked = await fetch(`${origin}/blocked`);
  expect(blocked.status).toBe(403);
  await expect(blocked.json()).resolves.toEqual({ error: "Blocked" });
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

describe("renderer: false", () => {
  it("resolves to the no-renderer descriptor, idempotently", () => {
    const resolved = resolveFarmRenderer(false);
    expect(resolved.name).toBe(NO_RENDERER.name);
    expect(isFarmRendererDisabled(resolved)).toBe(true);
    expect(isFarmRendererDisabled(false)).toBe(true);
    // Config resolution runs again over an already-resolved config.
    expect(resolveFarmRenderer(resolved).name).toBe(NO_RENDERER.name);
    expect(isFarmRendererDisabled(resolveFarmRenderer(undefined))).toBe(false);
    expect(isFarmRendererDisabled(REACT_RENDERER)).toBe(false);
  });

  it("loads no Vite plugins and pre-bundles no browser runtime", async () => {
    await expect(loadFarmRendererVitePlugins(NO_RENDERER, packageRoot)).resolves.toEqual([]);
    expect(createFarmClientOptimizeDepsConfig(["src/app/**/*.tsx"], NO_RENDERER)).toEqual({
      noDiscovery: true,
      include: [],
    });
    expect(createFarmClientOptimizeDepsConfig([], REACT_RENDERER)?.include).toContain("react");
  });

  it("ships a server module that answers the renderer contract and refuses to render", () => {
    expect(noRenderer.isValidElement()).toBe(false);
    expect(() => noRenderer.createElement()).toThrow(/renderer: false/);
    expect(() => noRenderer.renderToString()).toThrow(/renderer: false/);
  });

  it("turns off page-only defaults while keeping explicit settings", async () => {
    const config = await resolveConfig({ root: packageRoot, renderer: false });
    expect(config.renderer.name).toBe(NO_RENDERER.name);
    expect(config.images.provider).toBe("none");
    expect(config.agent.jsonLd).toBe(false);
    expect(config.agent.llmsTxt.enabled).toBe(false);
    expect(config.agent.sitemap.enabled).toBe(false);
    expect(config.agent.mcp).toBe(false);

    expect(resolveFarmImageConfig({ provider: "node" }, "none").provider).toBe("node");
    const agent = resolveFarmAgentConfig({ sitemap: true, mcp: true }, { pages: false });
    expect(agent.sitemap.enabled).toBe(true);
    expect(agent.mcp).toBe(true);

    const pages = await resolveConfig({ root: packageRoot });
    expect(pages.images.provider).toBe("auto");
    expect(pages.agent.mcp).toBe(true);
  });

  it("serves API routes and JSON misses in development without React", async () => {
    const root = await createBackendFixture();

    const server = await createServer({ root, renderer: false, api: { basePath: "/" } });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    const origin = `http://localhost:${address.port}`;
    await expectBackendResponses(origin);

    // There is no page to open the DevTools overlay on, so the launcher serves the panel itself.
    const devtools = await fetch(`${origin}/__farm/devtools`, { redirect: "manual" });
    expect(devtools.status).toBe(200);
    expect(devtools.headers.get("content-type")).toMatch(/^text\/html/);
    await devtools.body?.cancel();

    const loaded = [...server.moduleGraph.idToModuleMap.keys()];
    expect(loaded.filter((id) => /[\\/]react(?:-dom)?[\\/]/.test(id))).toEqual([]);
  }, 60_000);

  it("builds a production server with no client bundle or React, and the same responses", async () => {
    const root = await createBackendFixture();

    const config = await resolveConfig(
      { root, renderer: false, api: { basePath: "/" } },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const publicFiles = await listFiles(path.join(output, "public"));
    // Only the app's own public files: no browser client, manifest, or SSR assets.
    expect(
      publicFiles.map((file) => path.relative(output, file).split(path.sep).join("/")).sort(),
    ).toEqual(["public/guide/index.html", "public/landing.html", "public/robots-notes.txt"]);
    const serverFiles = await listFiles(path.join(output, "server"));
    expect(serverFiles.some((file) => file.split(path.sep).includes("react"))).toBe(false);
    for (const file of serverFiles.filter((name) => /\.m?js$/.test(name))) {
      const source = await fs.readFile(file, "utf8");
      expect(source, path.relative(output, file)).not.toMatch(
        /["']react(?:-dom)?(?:\/[^"']*)?["']/,
      );
    }

    const port = await getAvailablePort();
    const processOutput: string[] = [];
    const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
      cwd: path.join(output, "server"),
      // No NODE_PATH: the server must not find React (or anything) outside its own output.
      env: { ...process.env, NODE_PATH: "", HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    productionServer.stdout.on("data", (chunk) => processOutput.push(String(chunk)));
    productionServer.stderr.on("data", (chunk) => processOutput.push(String(chunk)));
    const exited = new Promise<void>((resolve) => productionServer.once("exit", () => resolve()));

    try {
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 200 && !ready; attempt++) {
        if (productionServer.exitCode !== null) break;
        ready = await fetch(`${origin}/_farm/health/ready`).then(
          (response) => response.ok,
          () => false,
        );
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(ready, processOutput.join("")).toBe(true);

      await expectBackendResponses(origin);
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 180_000);

  it("refuses to build pages it would never serve", async () => {
    const root = await createBackendFixture();
    await writeModule(root, "src/app/page.tsx", "export default function Page() { return null; }");

    const config = await resolveConfig({ root, renderer: false }, "production");
    await expect(build(config, { root, preset: "node-server" })).rejects.toThrow(
      /renderer: false.*\n {2}- src\/app\/page\.tsx/s,
    );
  }, 120_000);
});
