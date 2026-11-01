import { describe, expect, it } from "vitest";

import { agent } from "./index.js";
import agentUnitConfig from "./config.js";

type TestPlugin = {
  configure(config: Record<string, any>, context: { isDev: boolean }): any;
  build: { configure(nitroConfig: Record<string, any>): Promise<any> };
};

const pluginOf = (integration: ReturnType<typeof agent>) =>
  (integration as unknown as { plugins: TestPlugin[] }).plugins[0]!;

describe("agent()", () => {
  it("mounts under /api/agent and hands agent-unit its settings", () => {
    const authorize = () => true;
    const integration = agent({ framework: "mastra", authorize });
    expect(integration.instance).toEqual({ basePath: "/api/agent", framework: "mastra" });
    expect(agentUnitConfig()).toMatchObject({
      basePath: "/api/agent",
      framework: "mastra",
      authorize,
    });
  });

  it("rejects a base path that is not absolute", () => {
    expect(() => agent({ basePath: "api/agents" })).toThrow(/must start with "\/"/);
    expect(agent({ basePath: "/agents/" }).instance.basePath).toBe("/agents");
  });

  it("serves the agents in development only through Vite", () => {
    const plugin = pluginOf(agent());
    const dev = plugin.configure(
      { root: "/app", vite: { plugins: [{ name: "app" }] } },
      { isDev: true },
    );
    expect(dev.vite.plugins.map((entry: { name: string }) => entry.name)).toEqual([
      "farm:agent-dev",
      "app",
    ]);
    expect(plugin.configure({ root: "/app" }, { isDev: false })).toBeUndefined();
  });

  it("adds agent-unit's Nitro module to the production build, reading agents from srcDir", async () => {
    const plugin = pluginOf(agent({ name: "support" }));
    plugin.configure({ root: "/app", srcDir: "app" }, { isDev: false });
    const nitroConfig = await plugin.build.configure({ modules: ["existing"] });
    expect(nitroConfig.modules).toHaveLength(2);
    expect(nitroConfig.modules[0]).toBe("existing");
    expect(nitroConfig.modules[1]).toMatchObject({ name: "agent-unit" });
  });
});
