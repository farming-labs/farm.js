// @vitest-environment node

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
import { startProductionServer } from "./production-server";

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
  framework: "hono" | "elysia" | "express" | "koa" | "fastify" | "nest";
  /**
   * `manual` exports `app.fetch` by hand; the others use `mountFetchHandler`, or
   * `mountNodeHandler` for the Node.js frameworks.
   */
  style: "manual" | "helper" | "strip";
};

const MOUNTS: Mount[] = [
  { id: "hono", framework: "hono", style: "manual" },
  { id: "elysia", framework: "elysia", style: "manual" },
  { id: "hono-helper", framework: "hono", style: "helper" },
  { id: "hono-strip", framework: "hono", style: "strip" },
  { id: "elysia-strip", framework: "elysia", style: "strip" },
  { id: "express", framework: "express", style: "helper" },
  { id: "express-strip", framework: "express", style: "strip" },
  { id: "koa-strip", framework: "koa", style: "strip" },
  { id: "fastify-strip", framework: "fastify", style: "strip" },
  { id: "nest", framework: "nest", style: "helper" },
];

const NODE_FRAMEWORKS = new Set<Mount["framework"]>(["express", "koa", "fastify", "nest"]);

/** Each app defines the same routes; `base` is the path it is served below, if it sees one. */
function appSource(framework: Mount["framework"], id: string, base: string): string {
  const name = JSON.stringify(id);
  switch (framework) {
    case "hono":
      return `import { Hono } from "hono";

const app = new Hono()${base ? `.basePath(${JSON.stringify(base)})` : ""};

app.get("/hello/:name", (c) => {
  c.header("x-router", ${name});
  return c.json({ hello: c.req.param("name"), x: c.req.query("x") ?? null });
});
app.get("/where/*", (c) => c.json({ pathname: new URL(c.req.url).pathname }));
app.post("/echo", async (c) => c.json({ got: await c.req.json() }, 201));
app.notFound((c) => c.json({ notFound: ${name} }, 404));
`;
    case "elysia":
      return `import { Elysia } from "elysia";

const app = new Elysia(${base ? `{ prefix: ${JSON.stringify(base)} }` : ""})
  .get("/hello/:name", ({ params, query, set }) => {
    set.headers["x-router"] = ${name};
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
    return { notFound: ${name} };
  });
`;
    case "express":
      return `import express from "express";

const router = express.Router();
router.use(express.json());
router.get("/hello/:name", (req, res) => {
  res.set("x-router", ${name});
  res.json({ hello: req.params.name, x: req.query.x ?? null });
});
router.get("/where/*rest", (req, res) => res.json({ pathname: req.originalUrl.split("?")[0] }));
router.post("/echo", (req, res) => res.status(201).json({ got: req.body }));
// Holds the response open until /release is called, so a test can see the first event arrive
// before the response ends.
let release = () => {};
router.get("/stream", async (_req, res) => {
  const released = new Promise((resolve) => (release = resolve));
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.write("data: one\\n\\n");
  await released;
  res.end("data: two\\n\\n");
});
router.post("/release", (_req, res) => {
  release();
  res.status(204).end();
});
router.use((_req, res) => res.status(404).json({ notFound: ${name} }));

const app = express();
app.use(${JSON.stringify(base || "/")}, router);
`;
    case "koa":
      return `import Koa from "koa";

const koa = new Koa();
koa.use(async (ctx) => {
  const path = ctx.path.slice(${JSON.stringify(base)}.length);
  const read = ctx.method === "GET" || ctx.method === "HEAD";
  if (read && path.startsWith("/hello/")) {
    ctx.set("x-router", ${name});
    ctx.body = { hello: decodeURIComponent(path.slice("/hello/".length)), x: ctx.query.x ?? null };
  } else if (read && path.startsWith("/where/")) {
    ctx.body = { pathname: ctx.path };
  } else if (ctx.method === "POST" && path === "/echo") {
    let raw = "";
    for await (const chunk of ctx.req) raw += chunk;
    ctx.status = 201;
    ctx.body = { got: JSON.parse(raw) };
  } else {
    ctx.status = 404;
    ctx.body = { notFound: ${name} };
  }
});
const app = koa.callback();
`;
    case "fastify":
      return `import Fastify from "fastify";

const fastify = Fastify();
fastify.register(
  async (scope) => {
    scope.get("/hello/:name", async (request, reply) => {
      reply.header("x-router", ${name});
      const query = request.query as { x?: string };
      return { hello: (request.params as { name: string }).name, x: query.x ?? null };
    });
    scope.get("/where/*", async (request) => ({ pathname: request.url.split("?")[0] }));
    scope.post("/echo", async (request, reply) => {
      reply.code(201);
      return { got: request.body };
    });
    scope.setNotFoundHandler(async (_request, reply) => {
      reply.code(404);
      return { notFound: ${name} };
    });
  },
  { prefix: ${JSON.stringify(base)} },
);
const ready = fastify.ready();
const app = async (req, res) => {
  await ready;
  fastify.server.emit("request", req, res);
};
`;
    case "nest":
      return `import "reflect-metadata";
import { All, Body, Controller, Get, Header, HttpCode, Module, Param, Post, Query, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller()
class AppController {
  @Get("hello/:name")
  @Header("x-router", ${name})
  hello(@Param("name") name: string, @Query("x") x?: string) {
    return { hello: name, x: x ?? null };
  }

  @Get("where/*rest")
  where(@Req() req: { originalUrl: string }) {
    return { pathname: req.originalUrl.split("?")[0] };
  }

  @Post("echo")
  @HttpCode(201)
  echo(@Body() body: unknown) {
    return { got: body };
  }

  @All("*rest")
  notFound(@Res() res: { status(code: number): { json(body: unknown): void } }) {
    res.status(404).json({ notFound: ${name} });
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

const app = NestFactory.create(AppModule, { logger: false }).then(async (nest) => {
  ${base ? `nest.setGlobalPrefix(${JSON.stringify(base.slice(1))});` : ""}
  await nest.init();
  return nest.getHttpAdapter().getInstance();
});
`;
  }
}

function mountRouteSource({ id, framework, style }: Mount): string {
  // Without stripMountPath the app sees the full request path, so it repeats the route's URL.
  const base = style === "strip" ? "" : `/api/${id}`;
  const app = appSource(framework, id, base);
  if (style === "manual") {
    const call = framework === "hono" ? "app.fetch(request)" : "app.handle(request)";
    return `${app}
const handle = (request: Request) => ${call};
export { handle as GET, handle as POST };
`;
  }
  const helper = NODE_FRAMEWORKS.has(framework)
    ? { name: "mountNodeHandler", from: "@farm.js/core/api/node" }
    : { name: "mountFetchHandler", from: "@farm.js/core/api" };
  return `import { ${helper.name} } from "${helper.from}";
${app}
export const { GET, POST } = ${helper.name}(app${style === "strip" ? ", { stripMountPath: true }" : ""});
`;
}

const FIXTURE_PACKAGES = [
  "hono",
  "elysia",
  "express",
  "koa",
  "fastify",
  "@nestjs/common",
  "@nestjs/core",
  "@nestjs/platform-express",
  "reflect-metadata",
  "rxjs",
];

/**
 * The recipes from the API routes docs: Hono and Elysia apps mounted through their Web `fetch`
 * handlers, by hand and with `mountFetchHandler`, and Express, Koa, Fastify and Nest apps
 * mounted with `mountNodeHandler`.
 */
async function createMountedRouterFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-mounted-router-"));
  temporaryRoots.add(root);
  await linkPackage(root, "@farm.js/core", packageRoot);
  for (const name of FIXTURE_PACKAGES) {
    await linkPackage(root, name, path.join(packageRoot, "node_modules", name));
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  // Nest's decorators are TypeScript's legacy decorators.
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
  );
  for (const mount of MOUNTS) {
    await writeModule(root, `src/app/api/${mount.id}/[...path]/route.ts`, mountRouteSource(mount));
  }
  return root;
}

/** The contract both the development server and the production server must answer. */
async function expectMountedRouterResponses(origin: string): Promise<void> {
  for (const { id, framework, style } of MOUNTS) {
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

    if (framework === "express") {
      // The first event arrives while the app still holds the response open.
      const stream = await fetch(`${base}/stream`);
      expect(stream.headers.get("content-type"), id).toBe("text/event-stream");
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let received = "";
      while (!received.includes("data: one\n\n")) {
        const chunk = await reader.read();
        expect(chunk.done, id).toBe(false);
        received += decoder.decode(chunk.value, { stream: true });
      }
      expect(received, id).toBe("data: one\n\n");
      expect((await fetch(`${base}/release`, { method: "POST" })).status, id).toBe(204);
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        received += decoder.decode(chunk.value, { stream: true });
      }
      expect(received, id).toBe("data: one\n\ndata: two\n\n");
    }
  }
}

describe("Hono, Elysia, Express, Koa, Fastify and Nest apps mounted on catch-all API routes", () => {
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

    for (const id of [
      "hono-strip",
      "elysia-strip",
      "express-strip",
      "koa-strip",
      "fastify-strip",
    ]) {
      const hello = await fetch(`${origin}/${id}/hello/farm`);
      expect(hello.status, id).toBe(200);
      await expect(hello.json()).resolves.toEqual({ hello: "farm", x: null });
    }
  }, 60_000);

  it("answers the same from a production server", async () => {
    const root = await createMountedRouterFixture();
    const config = await resolveConfig({ root, renderer: false }, "production");
    await build(config, { root, preset: "node-server" });

    const productionServer = await startProductionServer(
      path.join(root, ".farm", ".output", "server"),
      { env: { NODE_PATH: "" } },
    );
    try {
      await expectMountedRouterResponses(productionServer.origin);
    } finally {
      await productionServer.stop();
    }
  }, 180_000);
});
