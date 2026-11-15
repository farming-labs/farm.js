// @vitest-environment node

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  createFarmBunServerEntry,
  createFarmCompileCacheLauncher,
  createFarmNodeServerEntry,
  FARM_DESKTOP_ENV_MODULE_SOURCE,
  FARM_NODE_ENV_MODULE_SOURCE,
  FARM_SERVER_MODULE_FILE,
} from "../nitro/node-server-entry";
import { installFarmCompileCacheLauncher } from "../nitro/universal-build";
import { resolveFarmServerConfig } from "../server-http";

describe("Farm production Node entry", () => {
  it("configures timeouts, eager startup, draining, and shutdown disposal", async () => {
    const source = createFarmNodeServerEntry({
      nitroEntryFile: "nitro-entry.mjs",
      nodeAdapterModule: "srvx/node",
      server: resolveFarmServerConfig({
        headersTimeout: "12s",
        requestTimeout: "2m",
        keepAliveTimeout: "8s",
        gracefulShutdownTimeout: "40s",
      }),
      websocketAdapterModule: "crossws/adapters/node",
    });

    await expect(transform(source, { loader: "js", format: "esm" })).resolves.toBeDefined();
    // NODE_ENV is set before any other module, the app's included, evaluates.
    expect(source.trimStart().startsWith('import "./farm-node-env.mjs";')).toBe(true);
    expect(source).toContain('import "#nitro/virtual/polyfills"');
    expect(source).toContain('from "#nitro/runtime/app"');
    expect(source).toContain('from "#nitro/runtime/runtime-config"');
    expect(source).not.toContain('from "nitro/app"');
    expect(source).not.toContain('from "nitro/runtime-config"');
    expect(source).toContain('from "#nitro/runtime/shutdown"');
    expect(source).not.toContain('from "nitro/runtime"');
    expect(source).toContain("nodeServer.headersTimeout = farmServerConfig.headersTimeout");
    expect(source).toContain("nodeServer.requestTimeout = farmServerConfig.requestTimeout");
    expect(source).toContain("nodeServer.keepAliveTimeout = farmServerConfig.keepAliveTimeout");
    expect(source).toContain("startupSignalPromise");
    expect(source).toContain("await Promise.race([");
    expect(source).toContain("() => farmProductionLifecycle.start()");
    expect(source).toContain("farmProductionLifecycle.forceClose(startupSignal)");
    expect(source).toContain("Forced runtime shutdown during startup timed out");
    expect(source).toContain("farmProductionLifecycle.beginDrain(signal)");
    expect(source).toContain('useNitroHooks().hook("close"');
    expect(source).toContain("process.env.NITRO_SHUTDOWN_TIMEOUT = String");
    expect(source).toContain("setupCloseHooks(server)");
    expect(source).toContain("trapUnhandledErrors()");
    expect(source).toContain("startScheduleRunner({ waitUntil: server.waitUntil })");
    expect(source).toContain("wsAdapter({ resolve: resolveWebsocketHooks })");
    expect(source).toContain("await server.serve()");
    expect(source).toContain("void server.close(true)");
    expect(source).toContain('from "./nitro-entry.mjs"');
  });

  it("gives the Bun entry Farm's startup and shutdown instead of srvx's", async () => {
    const source = createFarmBunServerEntry({
      nitroEntryFile: "nitro-entry.mjs",
      bunAdapterModule: "srvx/bun",
      server: resolveFarmServerConfig({ gracefulShutdownTimeout: "40s" }),
      websocketAdapterModule: "crossws/adapters/bun",
    });

    await expect(transform(source, { loader: "js", format: "esm" })).resolves.toBeDefined();
    expect(source).toContain('import { serve } from "srvx/bun"');
    expect(source).toContain('from "crossws/adapters/bun"');
    expect(source).not.toContain("farm-node-env.mjs");
    expect(source).not.toContain("nodeServer");
    // srvx's own handler would keep an idle server alive for a second and skip Farm's lifecycle.
    expect(source).toContain("gracefulShutdown: false");
    expect(source).toContain("() => farmProductionLifecycle.start()");
    expect(source).toContain("farmProductionLifecycle.beginDrain(signal)");
    expect(source).toContain('useNitroHooks().hook("close"');
    expect(source).toContain("setupCloseHooks(server)");
    expect(source).toContain("void server.close(true)");
    expect(source).toContain("if (shutdownConfig.forceExit) process.exit(process.exitCode || 0)");
    expect(source).toContain("ws.handleUpgrade(request, request.runtime.bun.server)");
    expect(source).toContain('from "./nitro-entry.mjs"');
  });

  it.each(["node", "bun"] as const)(
    "exports start() and guards every request in a desktop entry (%s)",
    async (runtime) => {
      const options = {
        nitroEntryFile: "nitro-entry.mjs",
        server: resolveFarmServerConfig({}),
        websocketAdapterModule: `crossws/adapters/${runtime}`,
      };
      const create = (desktop?: { basePath: string; guardModule: string }) =>
        runtime === "node"
          ? createFarmNodeServerEntry({ ...options, nodeAdapterModule: "srvx/node", desktop })
          : createFarmBunServerEntry({ ...options, bunAdapterModule: "srvx/bun", desktop });
      const web = create();
      const source = create({
        basePath: "/notes",
        guardModule: "@farm.js/core/internal/desktop-guard",
      });

      await expect(transform(source, { loader: "js", format: "esm" })).resolves.toBeDefined();
      // platform() must read "desktop" in every module, so the env module comes first.
      expect(source.trimStart().startsWith('import "./farm-desktop-env.mjs";')).toBe(true);
      expect(source).toContain(
        'import { createFarmDesktopGuard } from "@farm.js/core/internal/desktop-guard"',
      );
      expect(source).toContain("export function start(options = {})");
      expect(source).toContain('basePath: "/notes"');
      expect(source).toContain("farmDesktopGuard(request) ??");
      // Nothing starts on import, and the user's HOST and PORT never apply.
      expect(source).not.toContain("process.env.PORT");
      expect(source).not.toContain("process.env.HOST");
      expect(source).toContain("const port = options.port ?? 0;");
      expect(source).toContain('const host = options.host || "127.0.0.1";');
      expect(source).toContain('stop: () => (shutdownPromise ||= shutdown("stop", false))');
      expect(source).toContain("shutdownConfig.forceExit && exitProcess");
      expect(source).toContain('"farm:ready " + JSON.stringify({ port: server.port })');
      if (runtime === "node") {
        // WebSocket upgrades skip srvx's fetch, so they get their own guard check.
        expect(source).toMatch(/nodeServer\.on\("upgrade"[\s\S]*farmDesktopGuard\(\{/);
      }

      // A web entry carries none of it.
      for (const marker of [
        "farmDesktop",
        "desktop-guard",
        "farm:ready",
        "export function start",
      ]) {
        expect(web).not.toContain(marker);
      }
    },
  );

  it("marks the desktop platform before NODE_ENV defaults apply", () => {
    const env: Record<string, string | undefined> = {};
    new Function("process", FARM_DESKTOP_ENV_MODULE_SOURCE)({ env });
    expect(env).toEqual({ FARM_PLATFORM: "desktop", NODE_ENV: "production" });
  });

  it("sets NODE_ENV to production unless the deployment set one", () => {
    const run = (initial: string | undefined) => {
      const env: Record<string, string | undefined> = { NODE_ENV: initial };
      new Function("process", FARM_NODE_ENV_MODULE_SOURCE)({ env });
      return env.NODE_ENV;
    };
    expect(run(undefined)).toBe("production");
    expect(run("")).toBe("production");
    expect(run("staging")).toBe("staging");
  });
});

describe("Farm production compile-cache launcher", () => {
  const fs = { mkdir, readFile, rename, rm, writeFile } as typeof import("fs/promises");

  it("loads the server dynamically, so the cache is enabled before it compiles", async () => {
    const source = createFarmCompileCacheLauncher(FARM_SERVER_MODULE_FILE);

    await expect(transform(source, { loader: "js", format: "esm" })).resolves.toBeDefined();
    // A static import is compiled before any statement here runs, which writes no cache
    // entries at all. Only a dynamic import can come after enableCompileCache.
    expect(source).toContain('await import("./farm-server.mjs")');
    expect(source).not.toMatch(/^import .*farm-server\.mjs/m);
    expect(source.indexOf("enableCompileCache")).toBeLessThan(
      source.indexOf('import("./farm-server.mjs")'),
    );
  });

  it("leaves a deployment's own NODE_COMPILE_CACHE alone and never throws", () => {
    const source = createFarmCompileCacheLauncher(FARM_SERVER_MODULE_FILE);
    expect(source).toContain("if (!process.env.NODE_COMPILE_CACHE)");
    expect(source).toContain("try {");
    expect(source).toContain("enableCompileCache?.(");
  });

  it("moves Nitro's server aside and keeps index.mjs as the entry hosts invoke", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "farm-launcher-"));
    try {
      await writeFile(path.join(dir, "index.mjs"), "export default { nitro: true };\n");
      await mkdir(path.join(dir, ".compile-cache"), { recursive: true });
      await writeFile(path.join(dir, ".compile-cache", "stale.bin"), "stale");

      expect(await installFarmCompileCacheLauncher(dir, fs)).toBe(true);

      expect(await readFile(path.join(dir, FARM_SERVER_MODULE_FILE), "utf8")).toBe(
        "export default { nitro: true };\n",
      );
      const entry = await readFile(path.join(dir, "index.mjs"), "utf8");
      expect(entry).toContain('await import("./farm-server.mjs")');
      // A cache from the previous build describes code this one replaced.
      await expect(readFile(path.join(dir, ".compile-cache", "stale.bin"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not wrap the launcher in itself when a build reuses the directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "farm-launcher-"));
    try {
      await writeFile(path.join(dir, "index.mjs"), "export default {};\n");
      expect(await installFarmCompileCacheLauncher(dir, fs)).toBe(true);
      const launcher = await readFile(path.join(dir, "index.mjs"), "utf8");

      expect(await installFarmCompileCacheLauncher(dir, fs)).toBe(false);
      expect(await readFile(path.join(dir, "index.mjs"), "utf8")).toBe(launcher);
      expect(await readFile(path.join(dir, FARM_SERVER_MODULE_FILE), "utf8")).toBe(
        "export default {};\n",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports nothing to do when a preset emitted no index.mjs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "farm-launcher-"));
    try {
      expect(await installFarmCompileCacheLauncher(dir, fs)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
