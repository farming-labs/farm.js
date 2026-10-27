// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  createFarmBunServerEntry,
  createFarmNodeServerEntry,
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
