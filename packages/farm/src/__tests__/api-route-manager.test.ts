import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { APIRouteManager } from "../api/route-manager";

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
