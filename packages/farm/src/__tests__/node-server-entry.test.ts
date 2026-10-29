// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  createFarmBunServerEntry,
  createFarmNodeServerEntry,
  FARM_DESKTOP_ENV_MODULE_SOURCE,
  FARM_NODE_ENV_MODULE_SOURCE,
} from "../nitro/node-server-entry";
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
