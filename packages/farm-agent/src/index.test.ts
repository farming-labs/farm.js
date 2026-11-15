import { describe, expect, it } from "vitest";
import { mergePluginAPIRoutes } from "@farm.js/core/api/runtime";

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

  it("rejects a base path that is not absolute or not under /api", () => {
    expect(() => agent({ basePath: "api/agents" })).toThrow(/must start with "\/"/);
    expect(() => agent({ basePath: "/agents" })).toThrow(/must be under \/api/);
    expect(agent({ basePath: "/api/agents/" }).instance.basePath).toBe("/api/agents");
  });

  it("serves the agents as API routes, with no Vite middleware of its own", () => {
    const plugin = pluginOf(agent({ basePath: "/api/agents" }));
    expect(
      plugin.configure({ root: "/app", vite: { plugins: [{ name: "app" }] } }, { isDev: true }),
    ).toBeUndefined();
    const routes = mergePluginAPIRoutes([], [plugin as never]);
    expect(routes.map(({ path, methods }) => ({ path, methods }))).toEqual([
      { path: "/api/agents", methods: ["GET", "POST", "DELETE"] },
      { path: "/api/agents/[...path]", methods: ["GET", "POST", "DELETE"] },
    ]);
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
