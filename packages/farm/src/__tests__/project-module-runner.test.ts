// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmProjectModuleSsrEnvironment } from "../build/project-module-runner";

const servers: ViteDevServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** A server whose `virtual:slow` module loads only when `release` is called. */
async function slowModuleServer(useFarmEnvironment: boolean) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-project-runner-"));
  roots.push(root);
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow: Plugin = {
    name: "slow-module",
    resolveId: (id) => (id === "virtual:slow" ? "\0virtual:slow" : undefined),
    async load(id) {
      if (id !== "\0virtual:slow") return;
      await released;
      return "export const value = 42;";
    },
  };
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    plugins: [slow],
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    ...(useFarmEnvironment
      ? { environments: { ssr: await createFarmProjectModuleSsrEnvironment() } }
      : {}),
  });
  servers.push(server);
  const runner = (server.environments.ssr as { runner: { import(id: string): Promise<any> } })
    .runner;
  return { runner, release };
}

describe("build project module runner", () => {
  it("waits for a module the busy build has not answered within 60 s", async () => {
    const { runner, release } = await slowModuleServer(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const loaded = runner.import("virtual:slow");
    await vi.advanceTimersByTimeAsync(61_000);
    release();
    await expect(loaded).resolves.toMatchObject({ value: 42 });
  });

  it("is what Vite's default runner fails on", async () => {
    const { runner, release } = await slowModuleServer(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const loaded = runner.import("virtual:slow");
    const settled = loaded.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(61_000);
    release();
    expect(String(await settled)).toMatch(/timed out after 60000ms/);
  });
});
