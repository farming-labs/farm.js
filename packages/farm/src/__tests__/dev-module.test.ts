// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer, type RunnableDevEnvironment } from "vite";
import { loadFarmDevModule, invalidateFailedFarmDevModules } from "../dev-module";

const projects: Array<{ root: string; server: ViteDevServer }> = [];
afterEach(async () => {
  for (const { root, server } of projects.splice(0)) {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-dev-runners-"));
  const server = await createServer({
    root,
    configFile: false,
    envFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, ws: false },
    environments: {
      client: {},
      ssr: { resolve: { noExternal: ["conditional"] } },
      rsc: { resolve: { conditions: ["react-server"], noExternal: ["conditional"] } },
    },
  });
  projects.push({ root, server });
  // Calling the legacy loader is a regression even when it returns the same exports.
  vi.spyOn(server, "ssrLoadModule").mockImplementation(() => {
    throw new Error("legacy loader called");
  });
  return { root: server.config.root, server };
}

describe("development environment module loading", () => {
  it("uses independent SSR and RSC conditions and caches", async () => {
    const { root, server } = await project();
    const pkg = path.join(root, "node_modules/conditional");
    await mkdir(pkg, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "conditional",
        type: "module",
        exports: { "react-server": "./rsc.js", default: "./ssr.js" },
      }),
    );
    await writeFile(path.join(pkg, "rsc.js"), 'export default "rsc";');
    await writeFile(path.join(pkg, "ssr.js"), 'export default "ssr";');
    await writeFile(
      path.join(root, "entry.js"),
      'export { default } from "conditional"; export const state = {};',
    );
    const ssr = await loadFarmDevModule(server, "/entry.js");
    const rsc = await loadFarmDevModule(server, "/entry.js", "rsc");
    expect(ssr.default).toBe("ssr");
    expect(rsc.default).toBe("rsc");
    expect(ssr.state).not.toBe(rsc.state);
    expect(await loadFarmDevModule(server, "/entry.js")).toBe(ssr);
    expect(server.environments.client.moduleGraph.idToModuleMap.size).toBe(0);
  });

  it("reloads an edited dependency through Vite's watcher", async () => {
    const { root, server } = await project();
    const dependency = path.join(root, "message.js");
    await writeFile(dependency, 'export default "before";');
    await writeFile(path.join(root, "entry.js"), 'export { default } from "./message.js";');
    expect((await loadFarmDevModule(server, "/entry.js")).default).toBe("before");
    await writeFile(dependency, 'export default "after";');
    server.watcher.emit("change", dependency);
    await vi.waitFor(async () => {
      expect((await loadFarmDevModule(server, "/entry.js")).default).toBe("after");
    });
  });

  it("recovers nested failed imports without replacing healthy module state", async () => {
    const { root, server } = await project();
    await writeFile(path.join(root, "healthy.js"), "export const state = {};");
    await writeFile(path.join(root, "entry.js"), 'export { default } from "./nested.js";');
    await writeFile(path.join(root, "nested.js"), 'export { default } from "./missing.js";');
    const healthy = await loadFarmDevModule(server, "/healthy.js");
    await expect(loadFarmDevModule(server, "/entry.js")).rejects.toThrow(/missing/);
    await writeFile(path.join(root, "missing.js"), 'export default "recovered";');
    server.watcher.emit("add", path.join(root, "missing.js"));
    invalidateFailedFarmDevModules(server);
    expect((await loadFarmDevModule(server, "/entry.js")).default).toBe("recovered");
    expect(await loadFarmDevModule(server, "/healthy.js")).toBe(healthy);
    const recovered = await loadFarmDevModule(server, "/entry.js");
    invalidateFailedFarmDevModules(server);
    expect(await loadFarmDevModule(server, "/entry.js")).toBe(recovered);
  });

  it("preserves the original evaluation error", async () => {
    const error = new Error("application error");
    const server = {
      environments: {
        ssr: {
          runner: {
            import: async () => {
              throw error;
            },
          },
        },
      },
    };
    await expect(loadFarmDevModule(server as any, "/entry.js")).rejects.toBe(error);
  });

  it("lets Vite close and replace runners on restart", async () => {
    const { root, server } = await project();
    await writeFile(path.join(root, "entry.js"), "export const state = {};");
    const before = await loadFarmDevModule(server, "/entry.js");
    const firstRunner = (server.environments.ssr as RunnableDevEnvironment).runner;
    await server.restart();
    expect(firstRunner.isClosed()).toBe(true);
    const after = await loadFarmDevModule(server, "/entry.js");
    expect(after.state).not.toBe(before.state);
    const runner = (server.environments.ssr as RunnableDevEnvironment).runner;
    await server.close();
    expect(runner.isClosed()).toBe(true);
    await expect(loadFarmDevModule(server, "/entry.js")).rejects.toThrow(/closed/);
  });

  it("reports unsupported environments without falling back to SSR", async () => {
    const { server } = await project();
    const load = vi.spyOn((server.environments.ssr as RunnableDevEnvironment).runner, "import");
    delete server.environments.rsc;
    await expect(loadFarmDevModule(server, "virtual:entry", "rsc")).rejects.toThrow(
      /"rsc".*module runner/,
    );
    server.environments.rsc = { dispatchFetch: vi.fn() } as any;
    await expect(loadFarmDevModule(server, "virtual:entry", "rsc")).rejects.toThrow(
      /request\/response adapter/,
    );
    expect(load).not.toHaveBeenCalled();
    delete server.environments.rsc;
  });

  it("loads modules that import CSS before the server listens", async () => {
    // Farm loads routes files and middleware from configureServer, before httpServer.listen
    // starts the plugin container. vite:css keeps per-config state that its buildStart creates.
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-dev-runners-"));
    const server = await createServer({
      root,
      configFile: false,
      envFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { ws: false },
    });
    projects.push({ root: server.config.root, server });
    await writeFile(path.join(root, "page.css"), "body { margin: 0 }");
    await writeFile(path.join(root, "page.js"), 'import "./page.css"; export const ok = true;');
    expect((await loadFarmDevModule(server, "/page.js")).ok).toBe(true);
  });
});
