// @vitest-environment node

import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import { createFarmNodeServerEntry } from "../nitro/node-server-entry";
import { resolveFarmServerConfig } from "../server-http";

describe("Farm production Node entry", () => {
  it("configures timeouts, eager startup, draining, and shutdown disposal", async () => {
    const source = createFarmNodeServerEntry({
      nitroEntryFile: "nitro-entry.mjs",
      nodeHandlerModule: "srvx/node",
      server: resolveFarmServerConfig({
        headersTimeout: "12s",
        requestTimeout: "2m",
        keepAliveTimeout: "8s",
        gracefulShutdownTimeout: "40s",
      }),
      websocketAdapterModule: "crossws/adapters/node",
    });

    await expect(transform(source, { loader: "js", format: "esm" })).resolves.toBeDefined();
    expect(source).toContain("server.headersTimeout = farmServerConfig.headersTimeout");
    expect(source).toContain("server.requestTimeout = farmServerConfig.requestTimeout");
    expect(source).toContain("server.keepAliveTimeout = farmServerConfig.keepAliveTimeout");
    expect(source).toContain("startupSignalPromise");
    expect(source).toContain("await Promise.race([");
    expect(source).toContain("() => farmProductionLifecycle.start()");
    expect(source).toContain("Runtime shutdown during startup timed out");
    expect(source).toContain("farmProductionLifecycle.beginDrain(signal)");
    expect(source).toContain('nitroApp.hooks.hook("close"');
    expect(source).toContain("process.env.NITRO_SHUTDOWN_TIMEOUT = String");
    expect(source).toContain('from "./nitro-entry.mjs"');
  });
});
