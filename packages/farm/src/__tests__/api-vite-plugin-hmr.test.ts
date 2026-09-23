// @vitest-environment node

import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
      tempDirs.delete(dir);
    }),
  );
});

async function createHMRHarness(options: { withRootPost?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-api-hmr-"));
  tempDirs.add(root);
  const routeDir = path.join(root, "src", "api", "users");
  const routeFile = path.join(routeDir, "route.ts");
  const rootRoutesFile = path.join(root, "src", "routes.ts");
  await mkdir(routeDir, { recursive: true });
  await writeFile(routeFile, "export {};\n");
  if (options.withRootPost) await writeFile(rootRoutesFile, "export {};\n");

  let routeModule: Record<string, unknown> = {
    GET: async () => new Response("users"),
  };
  const rootPostEndpoint = {
    __path: "/api/users",
    __method: "POST",
    handler: async () => new Response("root-post"),
  };
  const ssrLoadModule = vi.fn(async (filePath: string) =>
    filePath === routeFile ? routeModule : { users: rootPostEndpoint },
  );
  const plugin = farmApiPlugin() as any;
  const server: any = {
    config: { root },
    ssrLoadModule,
    moduleGraph: { invalidateModule: vi.fn() },
    middlewares: { use() {} },
    watcher: { on() {} },
  };

  await plugin.configureServer(server);
  await server.__farmApi__.waitForDiscovery();

  return {
    plugin,
    rootPostEndpoint,
    routeFile,
    server,
    ssrLoadModule,
    failNextLoad(error: Error) {
      ssrLoadModule.mockRejectedValueOnce(error);
    },
    setRouteModule(next: Record<string, unknown>) {
      routeModule = next;
    },
  };
}

describe("standalone API route HMR", () => {
  it("removes a cached route after its last method export is deleted", async () => {
    const harness = await createHMRHarness();
    expect(harness.server.__farmApi__.getRoutes().has("/api/users")).toBe(true);
    harness.setRouteModule({});

    await harness.plugin.handleHotUpdate({
      file: harness.routeFile,
      modules: [],
      server: harness.server,
    });

    expect(harness.server.__farmApi__.getRoutes().has("/api/users")).toBe(false);
    expect(harness.server.__farmApi__.getHandler()).toBeNull();
  });

  it("removes a cached route when its file disappears", async () => {
    const harness = await createHMRHarness();
    await unlink(harness.routeFile);

    await harness.plugin.handleHotUpdate({
      file: harness.routeFile,
      modules: [],
      server: harness.server,
    });

    expect(harness.server.__farmApi__.getRoutes().has("/api/users")).toBe(false);
    expect(harness.server.__farmApi__.getHandler()).toBeNull();
    expect(harness.ssrLoadModule).toHaveBeenCalledTimes(1);
  });

  it("keeps the last-good route when the updated module fails to load", async () => {
    const harness = await createHMRHarness();
    harness.failNextLoad(new Error("syntax error"));

    await harness.plugin.handleHotUpdate({
      file: harness.routeFile,
      modules: [],
      server: harness.server,
    });

    expect(harness.server.__farmApi__.getRoutes().has("/api/users")).toBe(true);
    expect(harness.server.__farmApi__.getHandler()).not.toBeNull();
  });

  it("preserves handlers from another source when the last file export is deleted", async () => {
    const harness = await createHMRHarness({ withRootPost: true });
    harness.setRouteModule({});

    await harness.plugin.handleHotUpdate({
      file: harness.routeFile,
      modules: [],
      server: harness.server,
    });

    const route = harness.server.__farmApi__.getRoutes().get("/api/users");
    expect(route?.methods).toEqual(["POST"]);
    expect(route?.endpoints.POST).toBe(harness.rootPostEndpoint);
    expect(harness.server.__farmApi__.getHandler()).not.toBeNull();
  });

  it("preserves handlers from another source when the route file disappears", async () => {
    const harness = await createHMRHarness({ withRootPost: true });
    await unlink(harness.routeFile);

    await harness.plugin.handleHotUpdate({
      file: harness.routeFile,
      modules: [],
      server: harness.server,
    });

    const route = harness.server.__farmApi__.getRoutes().get("/api/users");
    expect(route?.methods).toEqual(["POST"]);
    expect(route?.endpoints.POST).toBe(harness.rootPostEndpoint);
    expect(harness.server.__farmApi__.getHandler()).not.toBeNull();
  });
});
