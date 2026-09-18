import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import nitro, { runNitroFromBuildApp } from "./vite-plugin-nitro";

const ENV_NAMES = {
  rsc: { build: { outDir: ".nitro/vite/dist/rsc" } },
  ssr: { build: { outDir: ".nitro/vite/dist/ssr" } },
  client: { build: { outDir: ".nitro/vite/dist/client" } },
} as const;

function resolveConfig(plugin: any, envs = ENV_NAMES): void {
  plugin.configResolved({ root: process.cwd(), environments: envs } as any);
}

afterEach(() => {
  delete (globalThis as any).__FARM_NITRO_SERVER_BUNDLE;
  delete (globalThis as any).__FARM_NITRO_PATHS;
  delete (globalThis as any).__FARM_NITRO_PLUGIN_RAN;
});

describe("vite-plugin-nitro (standalone nitro() plugin)", () => {
  it("does not register the buggy buildEnd Nitro trigger", () => {
    // buildEnd runs before its own environment's prepareOutDir/writeBundle. On a
    // rebuild that left previous outputs on disk, it would run Nitro against
    // stale artifacts and set __FARM_NITRO_PLUGIN_RAN. The hook is removed so Nitro
    // can no longer be driven against stale outputs; Nitro runs after the
    // environments write, via runNitroFromBuildApp() (or buildRscNitro()).
    const plugin = nitro() as any;

    expect(plugin.name).toBe("vite-plugin-nitro");
    expect(plugin.apply).toBe("build");
    expect(plugin.buildEnd).toBeUndefined();
  });

  it("preserves the config hook that forces per-environment outDirs", () => {
    const plugin = nitro() as any;

    expect(typeof plugin.config).toBe("function");

    const result = plugin.config();
    expect(result.environments).toEqual({
      rsc: { build: { outDir: path.join(".nitro/vite/dist", "rsc") } },
      ssr: { build: { outDir: path.join(".nitro/vite/dist", "ssr") } },
      client: { build: { outDir: path.join(".nitro/vite/dist", "client") } },
    });
  });

  it("preserves configResolved and writeBundle that feed runNitroFromBuildApp", () => {
    const plugin = nitro({
      server: { environmentName: "rsc" },
      config: { preset: "vercel" },
    }) as any;

    expect(typeof plugin.configResolved).toBe("function");
    expect(typeof plugin.writeBundle).toBe("function");
  });

  it("writeBundle captures the server bundle and resolved paths for runNitroFromBuildApp", () => {
    const plugin = nitro({
      server: { environmentName: "rsc" },
      config: { preset: "vercel" },
    }) as any;
    resolveConfig(plugin);

    const bundle = {
      "rsc/index.js": { type: "chunk", isEntry: true, fileName: "rsc/index.js", name: "index" },
    };
    plugin.writeBundle.call({ environment: { name: "rsc" } }, {}, bundle);

    expect((globalThis as any).__FARM_NITRO_SERVER_BUNDLE).toBe(bundle);
    const paths = (globalThis as any).__FARM_NITRO_PATHS;
    expect(paths).toBeDefined();
    expect(paths.root).toBe(path.resolve(process.cwd()));
    expect(paths.rscOutDir).toBe(".nitro/vite/dist/rsc");
    expect(paths.ssrOutDir).toBe(".nitro/vite/dist/ssr");
    expect(paths.clientOutDir).toBe(".nitro/vite/dist/client");
    expect(paths.serverEntryName).toBe("index");
    expect(paths.preset).toBe("vercel");
  });

  it("writeBundle ignores non-server environments", () => {
    const plugin = nitro({ server: { environmentName: "rsc" } }) as any;
    resolveConfig(plugin);

    plugin.writeBundle.call(
      { environment: { name: "client" } },
      {},
      { "client/index.js": { type: "chunk", isEntry: true, fileName: "client/index.js" } },
    );

    expect((globalThis as any).__FARM_NITRO_SERVER_BUNDLE).toBeUndefined();
    expect((globalThis as any).__FARM_NITRO_PATHS).toBeUndefined();
  });

  it("never sets the __FARM_NITRO_PLUGIN_RAN suppression flag", () => {
    const plugin = nitro({ server: { environmentName: "rsc" } }) as any;
    resolveConfig(plugin);

    plugin.writeBundle.call(
      { environment: { name: "rsc" } },
      {},
      { e: { type: "chunk", isEntry: true, fileName: "rsc/index.js", name: "index" } },
    );

    // Nothing in the plugin sets __FARM_NITRO_PLUGIN_RAN, so nothing suppresses
    // a later Nitro run driven from runNitroFromBuildApp()/buildRscNitro().
    expect((globalThis as any).__FARM_NITRO_PLUGIN_RAN).toBeUndefined();
  });

  it("runNitroFromBuildApp is a no-op until writeBundle has captured paths", async () => {
    delete (globalThis as any).__FARM_NITRO_PATHS;
    delete (globalThis as any).__FARM_NITRO_SERVER_BUNDLE;

    await expect(runNitroFromBuildApp()).resolves.toBeUndefined();
  });
});
