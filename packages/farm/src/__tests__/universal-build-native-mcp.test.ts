// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolveFarmMCPConfig } from "../mcp-config";
import { generateNativeMCPPluginSource } from "../nitro/universal-build";

describe("native MCP plugin in the production entry", () => {
  it("recreates the plugin from layered top-level config", () => {
    const mcp = resolveFarmMCPConfig({ allowUnauthenticated: true });
    const { importSource, registerSource, pluginSource } = generateNativeMCPPluginSource(mcp);

    expect(importSource).toContain('from "@farm.js/mcp/internal"');
    expect(importSource).toContain("createFarmMCPPlugin");
    expect(pluginSource).toContain("farmNativeMCPPlugin");

    const authorize = vi.fn(() => ({ subject: "agent" }));
    const farmRuntimeConfigs = [
      {
        mcp: {
          authorize,
          path: "/api/agent",
        },
      },
      {
        mcp: {
          name: "project-api",
        },
      },
    ];
    const createFarmMCPPlugin = vi.fn((config) => ({ name: "farm:api-mcp", config }));
    const plugin = new Function(
      "farmRuntimeConfigs",
      "__farmCreateMCPPlugin",
      `${registerSource}\nreturn farmNativeMCPPlugin;`,
    )(farmRuntimeConfigs, createFarmMCPPlugin) as {
      config: Record<string, unknown>;
    };

    expect(createFarmMCPPlugin).toHaveBeenCalledTimes(1);
    expect(plugin.config).toMatchObject({
      name: "project-api",
      authorize,
      path: "/api/agent",
    });
  });

  it("honors a later disabled layer without creating the plugin", () => {
    const { registerSource } = generateNativeMCPPluginSource(
      resolveFarmMCPConfig({ allowUnauthenticated: true }),
    );
    const createFarmMCPPlugin = vi.fn();
    const plugin = new Function(
      "farmRuntimeConfigs",
      "__farmCreateMCPPlugin",
      `${registerSource}\nreturn farmNativeMCPPlugin;`,
    )([{ mcp: { allowUnauthenticated: true } }, { mcp: false }], createFarmMCPPlugin);

    expect(plugin).toBeNull();
    expect(createFarmMCPPlugin).not.toHaveBeenCalled();
  });

  it("emits nothing when MCP is not enabled", () => {
    for (const mcp of [
      resolveFarmMCPConfig(undefined),
      resolveFarmMCPConfig(false),
      resolveFarmMCPConfig({ enabled: false }),
      undefined,
    ]) {
      expect(generateNativeMCPPluginSource(mcp)).toEqual({
        importSource: "",
        registerSource: "",
        pluginSource: "",
      });
    }
  });
});
