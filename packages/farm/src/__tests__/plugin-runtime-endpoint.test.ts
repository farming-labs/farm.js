import { describe, expect, it } from "vitest";
import { definePlugin } from "../plugin";
import {
  farmPluginMayAffectRuntimePath,
  normalizeFarmPluginRuntimeEndpointPath,
} from "../plugin-runtime-endpoint";

describe("plugin runtime endpoints", () => {
  it("keeps endpoint-only plugins scoped to their exact paths", () => {
    const plugin = definePlugin({
      name: "health",
      setup() {
        return { ready: true };
      },
      runtime: {
        endpoints: [{ path: "/health/ready/", handler: () => new Response() }],
        close() {},
      },
    });

    expect(farmPluginMayAffectRuntimePath(plugin, "/products")).toBe(false);
    expect(farmPluginMayAffectRuntimePath(plugin, "/health/ready")).toBe(true);
    expect(farmPluginMayAffectRuntimePath(plugin, "/health/ready/")).toBe(true);
  });

  it("keeps plugins with global request hooks on the dynamic path", () => {
    const plugin = definePlugin({
      name: "security",
      runtime: {
        endpoints: [{ path: "/status", handler: () => new Response() }],
        after() {},
      },
    });

    expect(farmPluginMayAffectRuntimePath(plugin, "/products")).toBe(true);
  });

  it("rejects dynamic, unsafe, and ambiguous endpoint paths", () => {
    for (const path of ["status", "/status?full=1", "/status/*", "/../status", "/%2fstatus"]) {
      expect(() => normalizeFarmPluginRuntimeEndpointPath(path)).toThrow();
    }
  });
});
