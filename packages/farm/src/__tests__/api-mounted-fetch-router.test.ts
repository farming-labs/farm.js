// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { createServer } from "../server/create-server";
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

async function linkPackage(root: string, name: string, target: string): Promise<void> {
  const link = path.join(root, "node_modules", ...name.split("/"));
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(await fs.realpath(target), link, "junction");
}

/**
 * The recipe from the API routes docs: a Hono app and an Elysia app, each mounted on a catch-all
 * route through its Web `fetch` handler, the same contract as a plain route export.
 */
async function createMountedRouterFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mounted-fetch-router-"));
  temporaryRoots.add(root);
  await linkPackage(root, "@farm.js/core", packageRoot);
  for (const name of ["hono", "elysia"]) {
    await linkPackage(root, name, path.join(packageRoot, "node_modules", name));
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await writeModule(
    root,
    "src/app/api/hono/[...path]/route.ts",
    `import { Hono } from "hono";

const app = new Hono().basePath("/api/hono");

app.get("/hello/:name", (c) => {
  c.header("x-router", "hono");
  return c.json({ hello: c.req.param("name"), x: c.req.query("x") ?? null });
});
app.post("/echo", async (c) => c.json({ got: await c.req.json() }, 201));
app.notFound((c) => c.json({ notFound: "hono" }, 404));

const handle = (request: Request) => app.fetch(request);
export { handle as GET, handle as POST };
`,
  );
  await writeModule(
    root,
    "src/app/api/elysia/[...path]/route.ts",
    `import { Elysia } from "elysia";

const app = new Elysia({ prefix: "/api/elysia" })
  .get("/hello/:name", ({ params, query, set }) => {
    set.headers["x-router"] = "elysia";
    return { hello: params.name, x: query.x ?? null };
  })
  .post("/echo", ({ body, set }) => {
    set.status = 201;
    return { got: body };
  })
  .onError(({ code, set }) => {
    if (code !== "NOT_FOUND") return;
    set.status = 404;
    return { notFound: "elysia" };
  });

const handle = (request: Request) => app.handle(request);
export { handle as GET, handle as POST };
`,
  );
  return root;
}

/** The contract both the development server and the production server must answer. */
async function expectMountedRouterResponses(origin: string): Promise<void> {
  for (const router of ["hono", "elysia"]) {
    const base = `${origin}/api/${router}`;

    const hello = await fetch(`${base}/hello/farm?x=1`);
    expect(hello.status, router).toBe(200);
    expect(hello.headers.get("x-router")).toBe(router);
    await expect(hello.json()).resolves.toEqual({ hello: "farm", x: "1" });

    const echo = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(echo.status, router).toBe(201);
    await expect(echo.json()).resolves.toEqual({ got: { a: 1 } });

    // The mounted app answers paths it does not define, not Farm.
    const missing = await fetch(`${base}/missing`);
    expect(missing.status, router).toBe(404);
    await expect(missing.json()).resolves.toEqual({ notFound: router });

    // Farm answers HEAD from the GET export.
    const head = await fetch(`${base}/hello/farm`, { method: "HEAD" });
    expect(head.status, router).toBe(200);
    expect(head.headers.get("x-router")).toBe(router);
    await expect(head.text()).resolves.toBe("");

    // A method the route file does not export never reaches the mounted app.
    const put = await fetch(`${base}/echo`, { method: "PUT" });
    expect(put.status, router).toBe(405);
  }
}

describe("a Hono or Elysia app mounted on a catch-all API route", () => {
  it("answers through the development server", async () => {
    const root = await createMountedRouterFixture();
    const server = await createServer({ root, renderer: false, images: { provider: "none" } });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    await expectMountedRouterResponses(`http://localhost:${address.port}`);
  }, 60_000);

  it("answers the same from a production server", async () => {
    const root = await createMountedRouterFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "node-server" });

    const output = path.join(root, ".farm", ".output");
    const port = await getAvailablePort();
    const processOutput: string[] = [];
    const productionServer = spawn(process.execPath, [path.join(output, "server", "index.mjs")], {
      cwd: path.join(output, "server"),
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

      await expectMountedRouterResponses(origin);
    } finally {
      if (productionServer.exitCode === null) productionServer.kill();
      await exited;
    }
  }, 180_000);
});
