// @vitest-environment node

import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { getFarmAppDirectories } from "../layers";
import { MiddlewareManager } from "../middleware/manager";
import { discoverMiddlewareRoutes } from "../nitro/universal-build";
import type { MiddlewareFunction } from "../middleware/types";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createProject(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "farm-middleware-sort-")));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "src", "app"), { recursive: true });
  return root;
}

function createLayer(projectRoot: string, name: string): string {
  const root = path.join(projectRoot, "layers", name);
  mkdirSync(path.join(root, "src", "app"), { recursive: true });
  return root;
}

function writeMiddlewareFile(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "export {};\n");
  return filePath;
}

function createViteServer(handlersByFile: Record<string, MiddlewareFunction>): {
  ssrLoadModule: (file: string) => Promise<Record<string, unknown>>;
} {
  const fallback: MiddlewareFunction = async (_ctx, next) => next();
  return {
    async ssrLoadModule(file: string) {
      return { default: handlersByFile[file] ?? fallback };
    },
  };
}

function createMockRequest(url: string, method = "GET"): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = { host: "localhost:3000" };
  return req;
}

function createMockResponse(): ServerResponse & { recordedHeaders: Record<string, string> } {
  const req = createMockRequest("/");
  const res = new ServerResponse(req) as ServerResponse & {
    recordedHeaders: Record<string, string>;
  };
  const recordedHeaders: Record<string, string> = {};
  (res as any).recordedHeaders = recordedHeaders;
  res.setHeader = ((name: string, value: string) => {
    recordedHeaders[String(name).toLowerCase()] = String(value);
    return res;
  }) as any;
  res.getHeader = ((name: string) => recordedHeaders[String(name).toLowerCase()]) as any;
  res.writeHead = (() => res) as any;
  res.end = (() => res) as any;
  return res;
}

describe("middleware sort bug: root middleware must run before nested middleware", () => {
  it("layer-nested-only + project-root: dev and prod discover the SAME cascade order", async () => {
    const root = createProject();
    const baseRoot = createLayer(root, "base");
    const layerAdminFile = writeMiddlewareFile(baseRoot, "src/app/admin/middleware.ts");
    const projectRootFile = writeMiddlewareFile(root, "src/app/middleware.ts");

    const config = await resolveConfig({ root, extends: ["./layers/base"] }, "development");
    const appDirs = getFarmAppDirectories(config);

    let adminSawParent: "root" | "none" | undefined;
    const rootHandler: MiddlewareFunction = async (ctx, next) => {
      ctx.data.set("rootRan", true);
      await next();
    };
    const adminHandler: MiddlewareFunction = async (ctx, next) => {
      adminSawParent = ctx.data.has("rootRan") ? "root" : "none";
      await next();
    };
    const vite = createViteServer({
      [projectRootFile]: rootHandler,
      [layerAdminFile]: adminHandler,
    });

    const manager = new MiddlewareManager(appDirs, vite as never);
    await manager.discover();

    const devOrder = manager.getMiddlewares().map((m) => m.path);
    const prodOrder = (await discoverMiddlewareRoutes(appDirs)).map((m) => m.path);

    const req = createMockRequest("/admin/anything");
    const res = createMockResponse();
    await manager.execute(req, res);

    expect({ devOrder, prodOrder, adminSawParent }).toEqual({
      devOrder: ["/", "/admin"],
      prodOrder: ["/", "/admin"],
      adminSawParent: "root",
    });
  });

  it("end-to-end: under trigger shape, a nested guard does not short-circuit when root seeds the session first", async () => {
    const root = createProject();
    const baseRoot = createLayer(root, "base");
    const layerAdminFile = writeMiddlewareFile(baseRoot, "src/app/admin/middleware.ts");
    const projectRootFile = writeMiddlewareFile(root, "src/app/middleware.ts");

    const config = await resolveConfig({ root, extends: ["./layers/base"] }, "development");
    const appDirs = getFarmAppDirectories(config);

    const executionOrder: string[] = [];
    const rootHandler: MiddlewareFunction = async (ctx, next) => {
      executionOrder.push("root");
      ctx.data.set("rootRan", true);
      await next();
    };
    const adminGuard: MiddlewareFunction = async (ctx, next) => {
      executionOrder.push("admin");
      if (!ctx.data.has("rootRan")) {
        return Response.redirect(new URL("/login", ctx.url), 303);
      }
      await next();
    };
    const vite = createViteServer({
      [projectRootFile]: rootHandler,
      [layerAdminFile]: adminGuard,
    });

    const manager = new MiddlewareManager(appDirs, vite as never);
    await manager.discover();

    const req = createMockRequest("/admin/anything");
    const res = createMockResponse();
    const executeResult = await manager.execute(req, res);

    expect({
      executionOrder,
      executeResult,
      statusCode: res.statusCode,
      location: res.recordedHeaders["location"] ?? null,
    }).toEqual({
      executionOrder: ["root", "admin"],
      executeResult: false,
      statusCode: 200,
      location: null,
    });
  });

  it("single-appDir projects keep the long-standing root-first discovery (regression guard)", async () => {
    const root = createProject();
    const projectRootFile = writeMiddlewareFile(root, "src/app/middleware.ts");
    const projectAdminFile = writeMiddlewareFile(root, "src/app/admin/middleware.ts");

    const config = await resolveConfig({ root }, "development");
    const appDirs = getFarmAppDirectories(config);
    expect(appDirs).toHaveLength(1);

    let adminSawParent: "root" | "none" | undefined;
    const rootHandler: MiddlewareFunction = async (ctx, next) => {
      ctx.data.set("rootRan", true);
      await next();
    };
    const adminHandler: MiddlewareFunction = async (ctx, next) => {
      adminSawParent = ctx.data.has("rootRan") ? "root" : "none";
      await next();
    };
    const vite = createViteServer({
      [projectRootFile]: rootHandler,
      [projectAdminFile]: adminHandler,
    });

    const manager = new MiddlewareManager(appDirs[0], vite as never);
    await manager.discover();

    const devOrder = manager.getMiddlewares().map((m) => m.path);
    const prodOrder = (await discoverMiddlewareRoutes(appDirs[0])).map((m) => m.path);

    const req = createMockRequest("/admin/anything");
    const res = createMockResponse();
    await manager.execute(req, res);

    expect({ devOrder, prodOrder, adminSawParent }).toEqual({
      devOrder: ["/", "/admin"],
      prodOrder: ["/", "/admin"],
      adminSawParent: "root",
    });
  });
});
