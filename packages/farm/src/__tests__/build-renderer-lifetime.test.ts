// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { loadFarmProductionVite } from "../build/production-vite";

const observed = vi.hoisted(() => ({
  calls: [] as Array<{ root: string; ssr?: boolean; signal?: AbortSignal }>,
  fail: false,
}));
vi.mock("../renderer", async (importOriginal) => {
  const original = await importOriginal<typeof import("../renderer")>();
  return {
    ...original,
    loadFarmRendererVitePlugins: async (
      ...args: Parameters<typeof original.loadFarmRendererVitePlugins>
    ) => {
      const [, root, options] = args;
      observed.calls.push({ root, ssr: options?.ssr, signal: options?.buildLifetime });
      expect(options?.buildLifetime?.aborted).toBe(false);
      const plugins = await original.loadFarmRendererVitePlugins(...args);
      return [
        ...plugins,
        {
          name: "test:renderer-lifetime",
          configResolved(config: { command: string }) {
            if (observed.fail && config.command === "build")
              throw new Error("intentional bundle failure");
          },
        },
      ];
    },
  };
});

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const created: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-renderer-lifetime-"));
  created.push(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function Page() { return <main>lifetime</main>; }`,
  );
  const config = await resolveConfig({ root, srcDir: "src", telemetry: false }, "production");
  return { root, config };
}
afterEach(async () => {
  observed.calls.length = 0;
  observed.fail = false;
  await Promise.all(created.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("renderer production build lifetime", () => {
  it("shares one lifetime across the three graphs and disposes after discovery closes", async () => {
    const { root, config } = await fixture();
    const productionVite = await loadFarmProductionVite();
    let closed = false;
    await build(config, {
      root,
      productionVite: {
        ...productionVite,
        async createServer(options) {
          const server = await productionVite.createServer(options);
          const close = server.close.bind(server);
          server.close = async () => {
            expect(observed.calls[0]?.signal?.aborted).toBe(false);
            await close();
            closed = true;
          };
          return server;
        },
      },
    });
    expect(closed).toBe(true);
    expect(observed.calls).toHaveLength(3);
    expect(observed.calls.map((call) => call.ssr).sort()).toEqual([false, true, true]);
    expect(new Set(observed.calls.map((call) => call.signal)).size).toBe(1);
    expect(observed.calls[0]!.signal!.aborted).toBe(true);
  }, 300000);

  it("isolates concurrent builds and disposes both when bundle and close fail", async () => {
    observed.fail = true;
    const fixtures = await Promise.all([fixture(), fixture()]);
    const productionVite = await loadFarmProductionVite();
    const results = await Promise.allSettled(
      fixtures.map(({ root, config }, index) =>
        build(config, {
          root,
          productionVite: {
            ...productionVite,
            async createServer(options) {
              const server = await productionVite.createServer(options);
              const close = server.close.bind(server);
              server.close = async () => {
                await close();
                if (index === 1) throw new Error("intentional close failure");
              };
              return server;
            },
          },
        }),
      ),
    );
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "intentional bundle failure" },
    });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { message: "intentional close failure" },
    });
    const signals = new Set<AbortSignal>();
    for (const { root } of fixtures) {
      const calls = observed.calls.filter((call) => call.root === root);
      expect(calls).toHaveLength(3);
      expect(new Set(calls.map((call) => call.signal)).size).toBe(1);
      expect(calls[0]!.signal!.aborted).toBe(true);
      signals.add(calls[0]!.signal!);
    }
    expect(signals.size).toBe(2);
  }, 300000);
});
