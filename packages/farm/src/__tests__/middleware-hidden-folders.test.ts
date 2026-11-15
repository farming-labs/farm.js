/** @vitest-environment node */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { MiddlewareManager } from "../middleware/manager";
import { appendMiddlewareRoutePath } from "../middleware/path";
import { discoverMiddlewareRoutes } from "../nitro/universal-build";
import { RouteManager } from "../routing/route-manager";

async function write(root: string, file: string, source = "export {};\n") {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), source);
}

describe("middleware in private and intercepting folders", () => {
  it("guards the URL an intercepting folder intercepts", () => {
    expect(appendMiddlewareRoutePath("/feed", "(.)photo")).toBe("/feed/photo");
    expect(appendMiddlewareRoutePath("/feed/list", "(..)photo")).toBe("/feed/photo");
    expect(appendMiddlewareRoutePath("/a/b/c", "(..)(..)photo")).toBe("/a/photo");
    expect(appendMiddlewareRoutePath("/feed", "(...)photo")).toBe("/photo");
    expect(appendMiddlewareRoutePath("/feed", "(group)")).toBe("/feed");
  });

  it("discovers middleware for every folder that routes pages, in dev and production", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-middleware-hidden-"));
    const app = path.join(root, "src", "app");
    try {
      await write(root, "package.json", '{"type":"module","private":true}');
      for (const page of [
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "src/app/_private/page.tsx",
        "src/app/feed/layout.tsx",
        "src/app/feed/page.tsx",
        "src/app/feed/photo/[id]/page.tsx",
        "src/app/feed/@modal/default.tsx",
        "src/app/feed/@modal/(.)photo/[id]/page.tsx",
      ]) {
        await write(root, page, "export default function Page() { return null; }\n");
      }
      await write(root, "src/app/_private/middleware.ts");
      await write(root, "src/app/feed/@modal/(.)photo/middleware.ts");

      // Page routing: the private page and the intercepted page are both served.
      const config = await resolveConfig({ root }, "development");
      const routes = new RouteManager(config as never);
      await routes.discoverRoutes();
      expect(routes.getRoutes().has("/_private")).toBe(true);
      expect(routes.getRoutes().has("/feed/photo/[id]")).toBe(true);

      const manager = new MiddlewareManager(app, {
        environments: { ssr: { runner: { import: vi.fn().mockResolvedValue({ default() {} }) } } },
      } as never);
      await manager.discover();
      const devPaths = manager.getMiddlewares().map((middleware) => middleware.path);
      expect(devPaths).toEqual(expect.arrayContaining(["/_private", "/feed/photo"]));

      const productionPaths = (await discoverMiddlewareRoutes(app)).map((route) => route.path);
      expect(productionPaths).toEqual(expect.arrayContaining(["/_private", "/feed/photo"]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
