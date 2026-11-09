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

type Mount = {
  /** Also the route directory under `src/app/api/` and the app's `x-router` header value. */
  id: string;
  framework: "hono" | "elysia";
  /** `manual` exports `app.fetch` by hand; the others use `mountFetchHandler`. */
  style: "manual" | "helper" | "strip";
};

const MOUNTS: Mount[] = [
  { id: "hono", framework: "hono", style: "manual" },
  { id: "elysia", framework: "elysia", style: "manual" },
  { id: "hono-helper", framework: "hono", style: "helper" },
  { id: "hono-strip", framework: "hono", style: "strip" },
  { id: "elysia-strip", framework: "elysia", style: "strip" },
];

function mountRouteSource({ id, framework, style }: Mount): string {
  // Without stripMountPath the app sees the full request path, so it repeats the route's URL.
  const base = style === "strip" ? "" : `/api/${id}`;
  const app =
    framework === "hono"
      ? `import { Hono } from "hono";

const app = new Hono()${base ? `.basePath(${JSON.stringify(base)})` : ""};

app.get("/hello/:name", (c) => {
  c.header("x-router", ${JSON.stringify(id)});
  return c.json({ hello: c.req.param("name"), x: c.req.query("x") ?? null });
});
app.get("/where/*", (c) => c.json({ pathname: new URL(c.req.url).pathname }));
app.post("/echo", async (c) => c.json({ got: await c.req.json() }, 201));
app.notFound((c) => c.json({ notFound: ${JSON.stringify(id)} }, 404));
`
      : `import { Elysia } from "elysia";

const app = new Elysia(${base ? `{ prefix: ${JSON.stringify(base)} }` : ""})
  .get("/hello/:name", ({ params, query, set }) => {
    set.headers["x-router"] = ${JSON.stringify(id)};
    return { hello: params.name, x: query.x ?? null };
  })
  .get("/where/*", ({ request }) => ({ pathname: new URL(request.url).pathname }))
  .post("/echo", ({ body, set }) => {
    set.status = 201;
    return { got: body };
  })
  .onError(({ code, set }) => {
    if (code !== "NOT_FOUND") return;
    set.status = 404;
    return { notFound: ${JSON.stringify(id)} };
  });
`;
  if (style === "manual") {
    const call = framework === "hono" ? "app.fetch(request)" : "app.handle(request)";
    return `${app}
const handle = (request: Request) => ${call};
export { handle as GET, handle as POST };
`;
  }
  return `import { mountFetchHandler } from "@farm.js/core/api";
${app}
export const { GET, POST } = mountFetchHandler(app${style === "strip" ? ", { stripMountPath: true }" : ""});
`;
}

/**
 * The recipes from the API routes docs: Hono and Elysia apps mounted on catch-all routes through
 * their Web `fetch` handlers, by hand and with `mountFetchHandler`.
 */
async function createMountedRouterFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mounted-fetch-router-"));
  temporaryRoots.add(root);
  await linkPackage(root, "@farm.js/core", packageRoot);
  for (const name of ["hono", "elysia"]) {
    await linkPackage(root, name, path.join(packageRoot, "node_modules", name));
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  for (const mount of MOUNTS) {
    await writeModule(root, `src/app/api/${mount.id}/[...path]/route.ts`, mountRouteSource(mount));
  }
  return root;
}

/** The contract both the development server and the production server must answer. */
async function expectMountedRouterResponses(origin: string): Promise<void> {
  for (const { id, style } of MOUNTS) {
    const base = `${origin}/api/${id}`;

    const hello = await fetch(`${base}/hello/farm?x=1`);
    expect(hello.status, id).toBe(200);
    expect(hello.headers.get("x-router")).toBe(id);
    await expect(hello.json()).resolves.toEqual({ hello: "farm", x: "1" });

    const echo = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(echo.status, id).toBe(201);
    await expect(echo.json()).resolves.toEqual({ got: { a: 1 } });

    // The mounted app answers paths it does not define, not Farm.
    const missing = await fetch(`${base}/missing`);
    expect(missing.status, id).toBe(404);
    await expect(missing.json()).resolves.toEqual({ notFound: id });

    // Farm answers HEAD from the GET export.
    const head = await fetch(`${base}/hello/farm`, { method: "HEAD" });
    expect(head.status, id).toBe(200);
    expect(head.headers.get("x-router")).toBe(id);
    await expect(head.text()).resolves.toBe("");

    // A method the route file does not export never reaches the mounted app.
    const put = await fetch(`${base}/echo`, { method: "PUT" });
    expect(put.status, id).toBe(405);

    // Without stripMountPath the app sees the request path unchanged; with it, only the segments
    // below the catch-all, still encoded as the client sent them.
    const where = await fetch(`${base}/where/a%20b/c`);
    expect(where.status, id).toBe(200);
    await expect(where.json()).resolves.toEqual({
      pathname: style === "strip" ? "/where/a%20b/c" : `/api/${id}/where/a%20b/c`,
    });
  }
}

describe("Hono and Elysia apps mounted on catch-all API routes", () => {
  it("answers through the development server", async () => {
    const root = await createMountedRouterFixture();
    const server = await createServer({ root, renderer: false, images: { provider: "none" } });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");

    await expectMountedRouterResponses(`http://localhost:${address.port}`);
  }, 60_000);

  it("keeps a stripped mount working when api.basePath moves the routes", async () => {
    const root = await createMountedRouterFixture();
    const server = await createServer({
      root,
      renderer: false,
      images: { provider: "none" },
      api: { basePath: "/" },
    });
    devServers.add(server);
    await server.listen(await getAvailablePort());
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing dev server address");
    const origin = `http://localhost:${address.port}`;

    for (const id of ["hono-strip", "elysia-strip"]) {
      const hello = await fetch(`${origin}/${id}/hello/farm`);
      expect(hello.status, id).toBe(200);
      await expect(hello.json()).resolves.toEqual({ hello: "farm", x: null });
    }
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
