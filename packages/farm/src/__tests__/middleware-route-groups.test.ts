/** @vitest-environment node */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { MiddlewareManager } from "../middleware/manager";
import { createProductionMiddlewareRunner } from "../middleware/production-runtime";
import { discoverMiddlewareRoutes } from "../nitro/universal-build";

describe("middleware route groups", () => {
  it("keeps route-group directory names out of development and production paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-middleware-groups-"));
    const appDir = path.join(root, "src", "app");
    const groupDir = path.join(appDir, "(marketing)");
    const pricingDir = path.join(groupDir, "pricing");
    await fs.mkdir(pricingDir, { recursive: true });
    await fs.writeFile(path.join(groupDir, "middleware.ts"), "export {};\n");
    await fs.writeFile(path.join(pricingDir, "middleware.ts"), "export {};\n");

    try {
      const viteServer = {
        environments: {
          ssr: {
            runner: {
              import: vi.fn().mockResolvedValue({
                default: async (_ctx: unknown, next: () => Promise<void>) => next(),
              }),
            },
          },
        },
      };
      const manager = new MiddlewareManager(appDir, viteServer as never);
      await manager.discover();

      expect(manager.getMiddlewares().map((middleware) => middleware.path)).toEqual([
        "/",
        "/pricing",
      ]);

      const productionRoutes = await discoverMiddlewareRoutes(appDir);
      expect(productionRoutes.map((middleware) => middleware.path)).toEqual(["/", "/pricing"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runs the root middleware and every route group's middleware that share a URL path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-middleware-groups-"));
    const appDir = path.join(root, "src", "app");
    const files = {
      root: path.join(appDir, "middleware.ts"),
      app: path.join(appDir, "(app)", "middleware.ts"),
      site: path.join(appDir, "(site)", "middleware.ts"),
    };
    for (const filePath of Object.values(files)) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "export {};\n");
    }
    const calls: string[] = [];
    const moduleFor = (filePath: string) => {
      const name = Object.entries(files).find(([, file]) => file === filePath)![0];
      return {
        default: async (_ctx: unknown, next: () => Promise<void>) => {
          calls.push(name);
          await next();
        },
      };
    };

    try {
      const viteServer = {
        environments: {
          ssr: { runner: { import: async (filePath: string) => moduleFor(filePath) } },
        },
      };
      const manager = new MiddlewareManager(appDir, viteServer as never);
      await manager.discover();
      expect(manager.getMiddlewares().map((middleware) => middleware.filePath)).toEqual([
        files.root,
        files.app,
        files.site,
      ]);

      const req = new IncomingMessage(new Socket());
      req.url = "/admin";
      req.method = "GET";
      req.headers = { host: "localhost" };
      await manager.execute(req, new ServerResponse(req));
      expect(calls).toEqual(["root", "app", "site"]);

      const productionRoutes = await discoverMiddlewareRoutes(appDir);
      expect(productionRoutes).toEqual([
        { path: "/", filePath: files.root },
        { path: "/", filePath: files.app },
        { path: "/", filePath: files.site },
      ]);

      calls.length = 0;
      const runner = createProductionMiddlewareRunner({
        modules: productionRoutes.map((route) => ({ ...route, module: moduleFor(route.filePath) })),
      });
      await runner(new Request("http://localhost/admin"));
      expect(calls).toEqual(["root", "app", "site"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
