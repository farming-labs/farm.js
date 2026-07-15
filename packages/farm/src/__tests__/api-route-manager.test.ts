import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createEndpoint } from "../api/endpoint";
import { APIRouteManager } from "../api/route-manager";
import { defineRoutes } from "../routes";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("APIRouteManager", () => {
  it("passes through Next-style Response objects with stream bodies", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "stream");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          GET: async () => {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode("part-one\n"));
                controller.enqueue(encoder.encode("part-two\n"));
                controller.close();
              },
            });

            return new Response(stream, {
              status: 202,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          },
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");

    const response = await handler!(new Request("http://example.com/api/stream"));

    expect(response.status).toBe(202);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.body).toBeTruthy();
    await expect(response.text()).resolves.toBe("part-one\npart-two\n");
  });

  it("passes raw request bodies to Next-style route handlers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "echo");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          POST: async (request: Request) =>
            Response.json({
              method: request.method,
              body: await request.json(),
            }),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    const response = await handler!(
      new Request("http://example.com/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      method: "POST",
      body: { message: "hello" },
    });
  });

  it("passes dynamic route params as a Next-style params promise", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "users", "[id]");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          GET: async (_request: Request, context: { params: Promise<{ id: string }> }) => {
            const params = await context.params;
            return Response.json({ id: params.id });
          },
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    const response = await handler!(new Request("http://example.com/api/users/alice%20smith"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "alice smith" });
  });

  it("passes catch-all route params as arrays", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "docs", "[...slug]");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          GET: async (_request: Request, context: { params: Promise<{ slug: string[] }> }) => {
            const params = await context.params;
            return Response.json({ slug: params.slug });
          },
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    const response = await handler!(new Request("http://example.com/api/docs/core/routes"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ slug: ["core", "routes"] });
  });

  it("invokes createEndpoint file routes with ctx, validation, and params", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "projects", "[id]");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          GET: createEndpoint(
            {
              method: "GET",
              query: z.object({ view: z.enum(["summary", "details"]) }),
              middleware: [({ params }) => ({ projectId: params.id })],
            },
            async (ctx) => ({
              id: ctx.params.id,
              middlewareProjectId: ctx.context.projectId,
              view: ctx.query.view,
              hasRequest: ctx.request instanceof Request,
            }),
          ),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    const response = await handler!(
      new Request("http://example.com/api/projects/farm?view=details"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "farm",
      middlewareProjectId: "farm",
      view: "details",
      hasRequest: true,
    });

    const invalidResponse = await handler!(
      new Request("http://example.com/api/projects/farm?view=unknown"),
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "Invalid query parameters",
    });
  });

  it("supports Next-style POST exports created with createEndpoint", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "chat");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          POST: createEndpoint(
            {
              method: "POST",
              body: z.object({
                message: z.string().min(1),
              }),
            },
            async (ctx) =>
              Response.json({
                message: ctx.body.message,
                path: new URL(ctx.request.url).pathname,
              }),
          ),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");
    expect(Array.from(manager.getRoutes().keys())).toEqual(["/api/chat"]);

    const response = await handler!(
      new Request("http://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "hello",
      path: "/api/chat",
    });

    const invalidResponse = await handler!(
      new Request("http://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      }),
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "Invalid request body",
    });
  });

  it("discovers explicit-path createEndpoint routes from root routes files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routesFile = path.join(root, "routes.js");
    fs.writeFileSync(routesFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routesFile);
        return {
          healthCheck: createEndpoint("/api/health", { method: "GET" }, async () => ({
            ok: true,
          })),
          echo: createEndpoint(
            "/api/echo",
            {
              method: "POST",
              body: z.object({ message: z.string().min(1) }),
            },
            async (ctx) => ({ echo: ctx.body.message }),
          ),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");
    expect(Array.from(manager.getRoutes().keys()).sort()).toEqual(["/api/echo", "/api/health"]);

    const healthResponse = await handler!(new Request("http://example.com/api/health"));
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({ ok: true });

    const echoResponse = await handler!(
      new Request("http://example.com/api/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello better-call" }),
      }),
    );

    expect(echoResponse.status).toBe(200);
    await expect(echoResponse.json()).resolves.toEqual({ echo: "hello better-call" });
  });

  it("discovers programmatic API routes outside the /api prefix", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const srcDir = path.join(root, "src");
    const routesFile = path.join(srcDir, "farm.routes.js");
    fs.mkdirSync(path.join(srcDir, "app"), { recursive: true });
    fs.writeFileSync(routesFile, "export {};\n");

    const manager = new APIRouteManager(path.join(srcDir, "app"), {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routesFile);
        return {
          default: defineRoutes(({ api }) => [
            api("/rss.xml", {
              GET: async () =>
                new Response("<rss>farm</rss>", {
                  headers: { "Content-Type": "application/rss+xml" },
                }),
            }),
            api("/api/posts/[id]", {
              GET: async (_request: Request, context: { params: Promise<{ id: string }> }) => {
                const params = await context.params;
                return Response.json({ id: params.id });
              },
            }),
          ]),
        };
      },
    } as any);

    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(manager.isAPIRoute("/rss.xml")).toBe(true);
    expect(Array.from(manager.getRoutes().keys()).sort()).toEqual(["/api/posts/[id]", "/rss.xml"]);
    expect(manager.getRoutes().get("/api/posts/[id]")?.filePath).toContain("?farm-route=api:");

    const rssResponse = await handler!(new Request("http://example.com/rss.xml"));
    expect(rssResponse.status).toBe(200);
    expect(rssResponse.headers.get("Content-Type")).toBe("application/rss+xml");
    await expect(rssResponse.text()).resolves.toBe("<rss>farm</rss>");

    const postResponse = await handler!(new Request("http://example.com/api/posts/hello"));
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({ id: "hello" });
  });

  it("parses DELETE request bodies", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-api-route-"));
    tempDirs.push(root);

    const routeDir = path.join(root, "api", "storage-demo");
    fs.mkdirSync(routeDir, { recursive: true });
    const routeFile = path.join(routeDir, "route.js");
    fs.writeFileSync(routeFile, "export {};\n");

    const manager = new APIRouteManager(root, {
      ssrLoadModule: async (filePath: string) => {
        expect(filePath).toBe(routeFile);
        return {
          DELETE: async (ctx: { body: unknown }) => ({
            method: "DELETE",
            body: ctx.body ?? null,
          }),
          POST: async (ctx: { body: unknown }) => ({
            method: "POST",
            body: ctx.body ?? null,
          }),
        };
      },
    } as any);
    await manager.discoverRoutes();
    const handler = manager.getHandler();

    expect(handler).toBeTypeOf("function");

    const deleteResponse = await handler!(
      new Request("http://example.com/api/storage-demo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "sqlite", clear: true }),
      }),
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      method: "DELETE",
      body: { backend: "sqlite", clear: true },
    });

    const postResponse = await handler!(
      new Request("http://example.com/api/storage-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "local", value: "hello" }),
      }),
    );

    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({
      method: "POST",
      body: { backend: "local", value: "hello" },
    });
  });
});
