// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type ViteDevServer, type RunnableDevEnvironment } from "vite";
import {
  createFarmDevModuleCheck,
  loadFarmDevModule,
  invalidateFailedFarmDevModules,
  invalidateFarmDevDependents,
} from "../dev-module";

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

  it("stops invalidating dependents at a module that accepts the edited module", async () => {
    const { root, server } = await project();
    // Writes below are invalidated by the call under test, not by Vite's watcher.
    await server.watcher.close();
    const page = path.join(root, "page.js");
    const route = path.join(root, "route.js");
    const index = path.join(root, "index.js");
    await writeFile(page, 'export default "before";');
    await writeFile(route, 'export { default } from "./page.js";');
    await writeFile(
      index,
      [
        "export const state = {};",
        'export const load = () => import("./page.js");',
        'if (import.meta.hot) import.meta.hot.accept(["./page.js"], () => {});',
      ].join("\n"),
    );
    const indexBefore = await loadFarmDevModule(server, "/index.js");
    expect((await loadFarmDevModule(server, "/route.js")).default).toBe("before");
    expect((await indexBefore.load()).default).toBe("before");

    await writeFile(page, 'export default "after";');
    const reached = invalidateFarmDevDependents(server, page, new Set([route, index]));

    expect(reached.sort()).toEqual([index, route].sort());
    expect((await loadFarmDevModule(server, "/route.js")).default).toBe("after");
    const indexAfter = await loadFarmDevModule(server, "/index.js");
    expect(indexAfter.state).toBe(indexBefore.state);
    expect((await indexAfter.load()).default).toBe("after");
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

describe("createFarmDevModuleCheck", () => {
  // No watcher: a late event for a file written here would invalidate modules mid-test.
  async function unwatchedProject(files: Record<string, string>) {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-dev-module-check-"));
    for (const [file, code] of Object.entries(files)) await writeFile(path.join(root, file), code);
    const server = await createServer({
      root,
      configFile: false,
      envFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { middlewareMode: true, ws: false, watch: null },
    });
    projects.push({ root, server });
    const modules = (server.environments.ssr as RunnableDevEnvironment).runner.evaluatedModules;
    return { server, modules };
  }

  it("turns false once a full reload of the server graph clears the module", async () => {
    // A renderer and a page that share a UI library, which the runner evaluates itself.
    const { server, modules } = await unwatchedProject({
      "ui.js": "export const instance = {};",
      "renderer.js": 'export { instance } from "/ui.js";',
      "page.js": 'export { instance } from "/ui.js";',
    });
    const renderer = await loadFarmDevModule(server, "/renderer.js");
    const current = createFarmDevModuleCheck(server, renderer);
    expect(current()).toBe(true);
    expect((await loadFarmDevModule(server, "/page.js")).instance).toBe(renderer.instance);

    // What Vite's runner does on a full-reload payload.
    modules.clear();
    expect(current()).toBe(false);
    // Pages now get a new copy of the library, which only the new renderer shares.
    const page = await loadFarmDevModule(server, "/page.js");
    expect(page.instance).not.toBe(renderer.instance);
    expect((await loadFarmDevModule(server, "/renderer.js")).instance).toBe(page.instance);
  });

  it("turns false once the runner invalidates the module", async () => {
    const { server, modules } = await unwatchedProject({
      "renderer.js": "export const instance = {};",
    });
    const current = createFarmDevModuleCheck(
      server,
      await loadFarmDevModule(server, "/renderer.js"),
    );
    modules.invalidateModule(modules.getModuleByUrl("/renderer.js")!);
    expect(current()).toBe(false);
  });

  it("stays true for exports the runner didn't evaluate", async () => {
    const { server } = await unwatchedProject({});
    expect(createFarmDevModuleCheck(server, await import("../dev-module"))()).toBe(true);
  });
});
