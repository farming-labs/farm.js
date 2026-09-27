// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import { createFarmNodeServerEntry } from "../nitro/node-server-entry";
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
});
