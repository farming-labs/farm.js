// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all([...tempDirs].map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.clear();
});

describe("standalone API collision handling during HMR", () => {
  it("preserves composed endpoints and rolls back a conflicting reload", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-api-collision-hmr-"));
    tempDirs.add(root);
    const routeDir = path.join(root, "src", "api", "health");
    const routeFile = path.join(routeDir, "route.ts");
    const rootRoutesFile = path.join(root, "src", "routes.ts");
    await mkdir(routeDir, { recursive: true });
    await writeFile(routeFile, "export {};\n");
    await writeFile(rootRoutesFile, "export {};\n");

    let fileModule: Record<string, unknown> = {
      GET: async () => new Response("file-get"),
    };
    const rootPost = async () => new Response("root-post");
    const rootEndpoint = {
      __path: "/api/health",
      __method: "POST",
      handler: rootPost,
    };
    const server: any = {
      config: { root },
      ssrLoadModule: vi.fn(async (filePath: string) =>
        filePath === routeFile
          ? fileModule
          : {
              health: rootEndpoint,
            },
      ),
      moduleGraph: { invalidateModule: vi.fn() },
      middlewares: { use() {} },
      watcher: { on() {} },
    };
    const plugin = farmApiPlugin() as any;

    await plugin.configureServer(server);
    await server.__farmApi__.waitForDiscovery();
    expect(server.__farmApi__.getRoutes().get("/api/health")?.methods.sort()).toEqual([
      "GET",
      "POST",
    ]);

    fileModule = { PUT: async () => new Response("file-put") };
    await plugin.handleHotUpdate({ file: routeFile, modules: [], server });
    expect(server.__farmApi__.getRoutes().get("/api/health")?.methods.sort()).toEqual([
      "POST",
      "PUT",
    ]);

    fileModule = { POST: async () => new Response("file-post") };
    await expect(plugin.handleHotUpdate({ file: routeFile, modules: [], server })).rejects.toThrow(
      `Duplicate API route for POST /api/health`,
    );
    expect(server.__farmApi__.getRoutes().get("/api/health")?.methods.sort()).toEqual([
      "POST",
      "PUT",
    ]);
    expect(server.__farmApi__.getRoutes().get("/api/health")?.endpoints.POST).toBe(rootEndpoint);
  });
});
