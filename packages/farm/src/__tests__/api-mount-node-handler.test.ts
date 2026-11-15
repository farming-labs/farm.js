// @vitest-environment node

import express from "express";
import Fastify from "fastify";
import Koa from "koa";
import { afterEach, describe, expect, it } from "vitest";
import { API_ROUTE_METHODS } from "../api";
import { mountNodeHandler, type NodeRequestHandler } from "../api/node";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const at = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

describe("mountNodeHandler", () => {
  it("returns one handler for every API route method", () => {
    const handlers = mountNodeHandler((_req, res) => res.end());
    expect(Object.keys(handlers).sort()).toEqual([...API_ROUTE_METHODS].sort());
  });

  it("serves an Express app: params, query, JSON bodies, headers, cookies and redirects", async () => {
    const app = express();
    app.use(express.json());
    app.get("/api/users/:id", (req, res) => {
      res.set("x-router", "express");
      res.cookie("a", "1");
      res.cookie("b", "2");
      res.json({ id: req.params.id, q: req.query.q, host: req.hostname, secure: req.secure });
    });
    app.post("/api/users", (req, res) => res.status(201).json({ got: req.body }));
    app.get("/api/old", (_req, res) => res.redirect(301, "/api/new"));
    const { GET, POST } = mountNodeHandler(app);

    const user = await GET(at("/api/users/7?q=x"));
    expect(user.status).toBe(200);
    expect(user.headers.get("x-router")).toBe("express");
    expect(user.headers.get("content-type")).toMatch(/^application\/json/);
    expect(user.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(user.headers.has("connection")).toBe(false);
    await expect(user.json()).resolves.toEqual({
      id: "7",
      q: "x",
      host: "localhost",
      secure: false,
    });

    const created = await POST(
      at("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      }),
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ got: { name: "Ada" } });

    const moved = await GET(at("/api/old"));
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/api/new");

    const missing = await GET(at("/api/nothing"));
    expect(missing.status).toBe(404);
  });

  it("reads a request body streamed in several chunks, in order", async () => {
    const app = express();
    app.use(express.text());
    app.post("/upload", (req, res) => res.json({ got: req.body }));
    const { POST } = mountNodeHandler(app);

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const part of ["one,", "two,", "three"]) {
          controller.enqueue(encoder.encode(part));
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        controller.close();
      },
    });
    const response = await POST(
      at("/upload", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    await expect(response.json()).resolves.toEqual({ got: "one,two,three" });
  });

  it("serves a Koa app", async () => {
    const app = new Koa();
    app.use(async (ctx) => {
      if (ctx.method === "POST") {
        let body = "";
        for await (const chunk of ctx.req) body += chunk;
        ctx.status = 202;
        ctx.body = { got: body };
        return;
      }
      ctx.set("x-router", "koa");
      ctx.body = { path: ctx.path, q: ctx.query.q };
    });
    const { GET, POST } = mountNodeHandler(app.callback());

    const hello = await GET(at("/api/koa/hello?q=1"));
    expect(hello.status).toBe(200);
    expect(hello.headers.get("x-router")).toBe("koa");
    await expect(hello.json()).resolves.toEqual({ path: "/api/koa/hello", q: "1" });

    const posted = await POST(at("/api/koa", { method: "POST", body: "raw text" }));
    expect(posted.status).toBe(202);
    await expect(posted.json()).resolves.toEqual({ got: "raw text" });
  });

  it("serves a Fastify app through its server's request event", async () => {
    const app = Fastify();
    app.get("/api/fastify/:id", async (request, reply) => {
      reply.header("x-router", "fastify");
      return { id: (request.params as { id: string }).id };
    });
    app.post("/api/fastify", async (request, reply) => {
      reply.code(201);
      return { got: request.body };
    });
    await app.ready();
    closers.push(() => app.close());
    const { GET, POST } = mountNodeHandler((req, res) => app.server.emit("request", req, res));

    const item = await GET(at("/api/fastify/3"));
    expect(item.status).toBe(200);
    expect(item.headers.get("x-router")).toBe("fastify");
    await expect(item.json()).resolves.toEqual({ id: "3" });

    const created = await POST(
      at("/api/fastify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: 1 }),
      }),
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({ got: { a: 1 } });
  });

  it("streams the response once headers are sent", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const { GET } = mountNodeHandler(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      await released;
      res.end("data: two\n\n");
    });

    const response = await GET(at("/stream"));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("data: one\n\n");

    release();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toBe("data: two\n\n");
  });

  it("keeps raw writeHead headers and answers null-body statuses without a body", async () => {
    const { GET, DELETE } = mountNodeHandler((req, res) => {
      if (req.method === "DELETE") {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.writeHead(200, "Fine", ["x-a", "1", "set-cookie", "c=1", "set-cookie", "d=2"]);
      res.end("ok");
    });

    const ok = await GET(at("/raw"));
    expect(ok.status).toBe(200);
    expect(ok.statusText).toBe("Fine");
    expect(ok.headers.get("x-a")).toBe("1");
    expect(ok.headers.getSetCookie()).toEqual(["c=1", "d=2"]);
    await expect(ok.text()).resolves.toBe("ok");

    const deleted = await DELETE(at("/raw", { method: "DELETE" }));
    expect(deleted.status).toBe(204);
    expect(deleted.body).toBeNull();
  });

  it("strips the mount path from req.url", async () => {
    const app = express();
    app.get("/users/:id", (req, res) => res.json({ url: req.url, original: req.originalUrl }));
    const { GET } = mountNodeHandler(app, { stripMountPath: true });

    const response = await GET(at("/api/express/users/1?x=1"), {
      params: Promise.resolve({ path: ["users", "1"] }),
    });
    await expect(response.json()).resolves.toEqual({
      url: "/users/1?x=1",
      original: "/users/1?x=1",
    });
  });

  it("waits for a handler passed as a promise", async () => {
    const ready = new Promise<NodeRequestHandler>((resolve) =>
      setTimeout(() => resolve((_req, res) => res.end("late")), 10),
    );
    const { GET } = mountNodeHandler(ready);

    await expect((await GET(at("/"))).text()).resolves.toBe("late");
  });

  it("explains what to pass when given an app instead of a listener", async () => {
    expect(() => mountNodeHandler(new Koa() as never)).toThrow(/koa\.callback\(\)/);

    const { GET } = mountNodeHandler(Promise.resolve(Fastify() as never));
    await expect(GET(at("/"))).rejects.toThrow(/fastify\.server\.emit/);
  });

  it("rejects each request when the handler promise rejects", async () => {
    const { GET } = mountNodeHandler(Promise.reject(new Error("failed to start")));

    await expect(GET(at("/"))).rejects.toThrow("failed to start");
    await expect(GET(at("/"))).rejects.toThrow("failed to start");
  });

  it("rejects when the handler throws or fails before responding", async () => {
    const { GET: syncThrow } = mountNodeHandler(() => {
      throw new Error("sync");
    });
    const { GET: asyncThrow } = mountNodeHandler(async () => {
      throw new Error("async");
    });
    const { GET: nextError } = mountNodeHandler((_req, _res, next) => next?.(new Error("next")));

    await expect(syncThrow(at("/"))).rejects.toThrow("sync");
    await expect(asyncThrow(at("/"))).rejects.toThrow("async");
    await expect(nextError(at("/"))).rejects.toThrow("next");
  });

  it("answers 404 when Connect-style middleware calls next() without responding", async () => {
    const { GET } = mountNodeHandler((_req, _res, next) => next?.());

    expect((await GET(at("/"))).status).toBe(404);
  });

  it("destroys the request when the client aborts", async () => {
    const controller = new AbortController();
    let closed!: () => void;
    const reqClosed = new Promise<void>((resolve) => (closed = resolve));
    const { GET } = mountNodeHandler((req) => {
      req.once("close", closed);
      controller.abort();
    });

    const pending = GET(at("/", { signal: controller.signal }));
    await reqClosed;
    await expect(pending).rejects.toThrow();
  });
});
