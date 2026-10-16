// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "vite";
import { REACT_RENDERER } from "../renderer";
import { createFarmReactRefreshPlugins } from "../server/react-refresh";

describe("development React Refresh setup", () => {
  it.each(["preact", "solid", "vue", "svelte"])(
    "does not install React hooks for %s",
    async (name) => {
      expect(await createFarmReactRefreshPlugins({ ...REACT_RENDERER, name })).toEqual([]);
    },
  );

  it("preserves an application's existing refresh setup, including nested async plugin arrays", async () => {
    const plugins = await createFarmReactRefreshPlugins(REACT_RENDERER, [
      false,
      Promise.resolve([{ name: "vite:react-refresh" }]),
    ]);
    expect(plugins).toEqual([]);
  });

  it("honors base paths and omits the preamble for SSR, disabled HMR, and production mode", async () => {
    const plugins = await createFarmReactRefreshPlugins(REACT_RENDERER);
    const preamble = plugins.find((plugin) => plugin.name === "farm:react-refresh-preamble")!;
    const configure = preamble.configResolved as (config: ResolvedConfig) => void;
    const load = preamble.load as (id: string) => string | undefined;
    const transform = preamble.transform as (
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ) => { code: string } | null;
    configure({ base: "/app/", isProduction: false, server: { hmr: true } } as ResolvedConfig);
    expect(load("/@farm/react-refresh")).toContain("/app/@react-refresh");
    expect(transform("client", "/@farm/client.js?t=1")?.code).toBe(
      'import "/@farm/react-refresh";\nclient',
    );
    expect(transform("client", "/@farm/client", { ssr: true })).toBeNull();
    expect(transform("other", "/other.js")).toBeNull();
    for (const config of [
      { isProduction: true, server: { hmr: true } },
      { isProduction: false, server: { hmr: false } },
    ]) {
      configure({ base: "/", ...config } as ResolvedConfig);
      expect(load("/@farm/react-refresh")).toBe("");
      expect(transform("client", "/@farm/client")).toBeNull();
    }
  });

  it("leaves isolated boundary updates with Farm instead of registering their metadata exports", async () => {
    const plugins = await createFarmReactRefreshPlugins(REACT_RENDERER);
    const babel = plugins.find((plugin) => plugin.name === "vite:react-babel")!;
    expect(babel.enforce).toBe("post");
    const transform = babel.transform;
    if (typeof transform !== "function") throw new Error("Expected a guarded transform");
    const getModuleInfo = vi.fn(() => ({ meta: { farmIsolatedClientBoundary: true } }));
    expect(
      await transform.call({ getModuleInfo } as never, "invalid JavaScript", "/Island.tsx", {}),
    ).toBeNull();
    expect(getModuleInfo).toHaveBeenCalledWith("/Island.tsx");
  });
});
