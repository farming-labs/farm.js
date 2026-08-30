/** @vitest-environment node */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MiddlewareManager } from "../middleware/manager";
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
        ssrLoadModule: vi.fn().mockResolvedValue({
          default: async (_ctx: unknown, next: () => Promise<void>) => next(),
        }),
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
});
