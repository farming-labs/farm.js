import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./nitro-build.js", () => ({
  buildRscNitro: vi.fn().mockResolvedValue(undefined),
  waitForRscOutputs: vi.fn().mockResolvedValue(undefined),
}));

import { buildRscNitro, waitForRscOutputs } from "./nitro-build.js";
import nitroPlugin from "./vite-plugin-nitro";

const buildRscNitroMock = vi.mocked(buildRscNitro);
const waitForRscOutputsMock = vi.mocked(waitForRscOutputs);

describe("vite-plugin-nitro post-app build with custom build.assetsDir", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-nitro-gate-"));
    buildRscNitroMock.mockClear();
    waitForRscOutputsMock.mockClear();
    delete (globalThis as any).__FARM_NITRO_PLUGIN_RAN;
    delete (globalThis as any).__FARM_NITRO_PATHS;
    delete (globalThis as any).__FARM_NITRO_SERVER_BUNDLE;
    delete (globalThis as any).__FARM_NITRO_BUILD_PROMISE;
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function writeDist(assetsDirName: string): string {
    const distDir = path.join(fixtureRoot, ".nitro", "vite", "dist");
    mkdirSync(path.join(distDir, "rsc"), { recursive: true });
    mkdirSync(path.join(distDir, "ssr"), { recursive: true });
    mkdirSync(path.join(distDir, "client", assetsDirName), { recursive: true });
    writeFileSync(path.join(distDir, "rsc", "index.js"), "export default { fetch() {} };");
    writeFileSync(path.join(distDir, "ssr", "index.js"), "export function render() {}");
    writeFileSync(path.join(distDir, "client", assetsDirName, "style.css"), "body{}");
    return distDir;
  }

  it("captures the resolved client assetsDir and forwards it after every environment is written", async () => {
    writeDist("_assets");
    const plugin = nitroPlugin({ config: { preset: "node-server" } }) as any;

    plugin.config();
    plugin.configResolved({
      root: fixtureRoot,
      environments: {
        rsc: { build: { outDir: ".nitro/vite/dist/rsc" } },
        ssr: { build: { outDir: ".nitro/vite/dist/ssr" } },
        client: { build: { outDir: ".nitro/vite/dist/client", assetsDir: "_assets" } },
      },
    });

    plugin.writeBundle.call(
      { environment: { name: "rsc" } },
      {},
      { e: { type: "chunk", isEntry: true, fileName: "index.js", name: "index" } },
    );
    const { runNitroFromBuildApp } = await import("./vite-plugin-nitro");
    await runNitroFromBuildApp();

    expect(buildRscNitroMock).toHaveBeenCalledTimes(1);
    expect(waitForRscOutputsMock).toHaveBeenCalledTimes(1);
    const args = buildRscNitroMock.mock.calls[0][0];
    expect(args.assetsDir).toBe("_assets");
    expect(args.preset).toBe("node-server");
    expect(args.root).toBe(path.resolve(fixtureRoot));
    expect(args.publicDir).toBe(path.resolve(fixtureRoot, ".nitro/vite/dist", "client"));
    expect(args.ssrPath).toBe(path.resolve(fixtureRoot, ".nitro/vite/dist", "ssr", "index.js"));
    expect((globalThis as any).__FARM_NITRO_PLUGIN_RAN).toBeUndefined();
  }, 30_000);
});

describe("runNitroFromBuildApp forwards captured assetsDir", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "farm-nitro-buildapp-"));
    buildRscNitroMock.mockClear();
    waitForRscOutputsMock.mockClear();
    delete (globalThis as any).__FARM_NITRO_PLUGIN_RAN;
    delete (globalThis as any).__FARM_NITRO_BUILD_PROMISE;
    (globalThis as any).__FARM_NITRO_PATHS = {
      root: fixtureRoot,
      rscOutDir: ".nitro/vite/dist/rsc",
      ssrOutDir: ".nitro/vite/dist/ssr",
      clientOutDir: ".nitro/vite/dist/client",
      serverEntryName: "index",
      preset: "node-server",
      clientAssetsDir: "_assets",
    };
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
    delete (globalThis as any).__FARM_NITRO_PATHS;
  });

  it("forwards the captured clientAssetsDir to buildRscNitro", async () => {
    const { runNitroFromBuildApp } = await import("./vite-plugin-nitro");
    await runNitroFromBuildApp();

    expect(buildRscNitroMock).toHaveBeenCalledTimes(1);
    const args = buildRscNitroMock.mock.calls[0][0];
    expect(args.assetsDir).toBe("_assets");
    expect(args.root).toBe(fixtureRoot);
    expect(args.preset).toBe("node-server");
  }, 30_000);
});
