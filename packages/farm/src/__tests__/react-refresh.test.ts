// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Plugin, ResolvedConfig, UserConfig } from "vite";
import { createFarmReactRefreshPlugins } from "../react-refresh";

function applies(plugin: Plugin, config: UserConfig, command: "serve" | "build") {
  if (typeof plugin.apply !== "function")
    return plugin.apply === undefined || plugin.apply === command;
  return plugin.apply(config, { command, mode: "development" });
}

describe("Farm React Fast Refresh plugins", () => {
  it("serves Fast Refresh in development only", async () => {
    const plugins = await createFarmReactRefreshPlugins();
    const reactRefresh = plugins.find((plugin) => plugin.name === "vite:react-refresh")!;
    expect(reactRefresh).toBeDefined();
    expect(applies(reactRefresh, { plugins }, "serve")).toBe(true);
    expect(applies(reactRefresh, { plugins }, "build")).toBe(false);
  });

  it("leaves Fast Refresh to plugin-react an app registers itself", async () => {
    const plugins = await createFarmReactRefreshPlugins();
    const appReact: Plugin = { name: "vite:react-refresh" };
    for (const plugin of plugins.filter((entry) => entry.name.startsWith("vite:"))) {
      expect(applies(plugin, { plugins: [[appReact], ...plugins] }, "serve")).toBe(false);
    }
    // The preamble still installs, so the app's own plugin-react gets its runtime hook.
    const preamble = plugins.find((plugin) => plugin.name === "farm:react-refresh-preamble")!;
    expect(applies(preamble, { plugins: [appReact, ...plugins] }, "serve")).toBe(true);
  });

  it("imports the preamble ahead of the browser client entry", async () => {
    const plugins = await createFarmReactRefreshPlugins();
    const preamble = plugins.find((plugin) => plugin.name === "farm:react-refresh-preamble")!;
    const resolved = {
      command: "serve",
      isProduction: false,
      server: { hmr: true },
      plugins,
    } as unknown as ResolvedConfig;
    (preamble.configResolved as (config: ResolvedConfig) => void)(resolved);
    const transform = preamble.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => { code: string } | undefined;
    const client = { environment: { config: { consumer: "client" } } };
    const server = { environment: { config: { consumer: "server" } } };
    const entry = "import React from 'react'";

    expect(transform.call(client, entry, "/@farm/client.js")?.code).toBe(
      `import "/@farm/react-refresh-preamble";\n${entry}`,
    );
    expect(transform.call(server, entry, "/@farm/client.js")).toBeUndefined();
    expect(transform.call(client, entry, "/src/app/page.tsx")).toBeUndefined();
    const load = preamble.load as (id: string) => string | undefined;
    expect(load("/@farm/react-refresh-preamble")).toContain(
      "RefreshRuntime.injectIntoGlobalHook(window)",
    );
  });

  it("keeps the preamble empty when Fast Refresh is off", async () => {
    const plugins = await createFarmReactRefreshPlugins();
    const preamble = plugins.find((plugin) => plugin.name === "farm:react-refresh-preamble")!;
    (preamble.configResolved as (config: ResolvedConfig) => void)({
      command: "serve",
      isProduction: false,
      server: { hmr: false },
      plugins,
    } as unknown as ResolvedConfig);
    expect(
      (preamble.load as (id: string) => string | undefined)("/@farm/react-refresh-preamble"),
    ).toBe("");
  });
});
